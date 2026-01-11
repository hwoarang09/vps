# Vehicle Memory Architecture

차량 데이터를 메모리에 저장하는 구조를 정의합니다. SharedArrayBuffer 기반으로 Main Thread와 Worker Thread 간 Zero-Copy 통신을 지원합니다.

## 개념 (왜 이렇게 설계했나)

### Float32Array 기반 구조화 데이터

차량 데이터를 **구조체 대신 Float32Array**로 저장합니다.

```typescript
// ❌ 나쁜 예: 객체 배열 (GC 발생, SharedArrayBuffer 불가)
interface Vehicle {
  x: number;
  y: number;
  rotation: number;
  ...
}
const vehicles: Vehicle[] = [];

// ✅ 좋은 예: Float32Array (Zero-GC, SharedArrayBuffer 가능)
const data = new Float32Array(vehicleCount * 22);
// vehicle 0: data[0~21]
// vehicle 1: data[22~43]
// vehicle 2: data[44~65]
```

**이유:**
- SharedArrayBuffer 지원 (Main-Worker 간 Zero-Copy)
- GC 압력 제거 (객체 생성 없음)
- 메모리 레이아웃 명확 (고정된 offset)
- 캐시 친화적 (연속된 메모리)

### 데이터 분리: Movement / Sensor / Logic

차량 데이터를 **3가지 용도로 분리**합니다.

```
VehicleDataArray (22 floats per vehicle)
├── MovementData (0~13)   ← 위치, 속도, edge 정보
├── SensorData (14~16)    ← 충돌 감지 센서
└── LogicData (17~21)     ← 상태, 경로, 목적지

SensorPointArray (36 floats per vehicle)
└── 3 zones × 6 points × 2 coords  ← 충돌 감지용 좌표
```

**이유:**
- 역할 명확화 (Movement는 매 프레임, Logic은 가끔)
- 캐시 최적화 (자주 쓰는 데이터를 앞에 배치)
- 확장성 (새 데이터 추가 시 기존 코드 영향 최소화)

### Multi-Worker 메모리 영역 분리

여러 Worker가 SharedArrayBuffer를 공유할 때, **영역을 나눠서 접근**합니다.

```
SharedArrayBuffer (전체)
┌────────────────┬────────────────┬────────────────┐
│ FAB 0 영역     │ FAB 1 영역     │ FAB 2 영역     │
│ [0~87999]      │ [88000~175999] │ [176000~...]   │
│ Worker 0 담당  │ Worker 0 담당  │ Worker 1 담당  │
└────────────────┴────────────────┴────────────────┘
```

**이유:**
- 영역이 겹치지 않으므로 Atomics 불필요 (성능 향상)
- Worker 간 메모리 충돌 방지
- 각 Worker는 할당된 영역만 접근 (버그 방지)

---

## 메모리 레이아웃 상세

### 1. VehicleDataArray (22 floats per vehicle)

차량 1대당 **22개 float** (88 bytes)로 표현됩니다.

```typescript
// constants.ts
export const VEHICLE_DATA_SIZE = 22;

// 차량 0의 데이터: data[0~21]
// 차량 1의 데이터: data[22~43]
// 차량 i의 데이터: data[i * 22 ~ i * 22 + 21]
```

#### MovementData (0~13): 이동 관련 데이터

| Index | 이름 | 설명 | 단위 |
|-------|------|------|------|
| 0 | X | 차량 X 좌표 | meter |
| 1 | Y | 차량 Y 좌표 | meter |
| 2 | Z | 차량 Z 좌표 | meter |
| 3 | ROTATION | 차량 회전각 | degree |
| 4 | VELOCITY | 현재 속도 | m/s |
| 5 | ACCELERATION | 가속도 | m/s² |
| 6 | DECELERATION | 감속도 | m/s² |
| 7 | EDGE_RATIO | 현재 edge 내 위치 | 0.0~1.0 |
| 8 | MOVING_STATUS | 이동 상태 | enum (STOPPED/MOVING/PAUSED) - 상세 ↓ |
| 9 | CURRENT_EDGE | 현재 edge index | int |
| 10 | NEXT_EDGE | 다음 edge index | int |
| 11 | NEXT_EDGE_STATE | 다음 edge 준비 상태 | enum (EMPTY/PENDING/READY) - 상세 ↓ |
| 12 | TARGET_RATIO | 목표 edge_ratio | 0.0~1.0 |
| 13 | OFFSET | 예약 (offset 관련) | - |

**자주 사용되는 데이터:**
- 매 프레임: X, Y, Z, ROTATION, VELOCITY, EDGE_RATIO
- edge 이동 시: CURRENT_EDGE, NEXT_EDGE, EDGE_RATIO

##### MOVING_STATUS 상세 (왜 3개인가?)

```typescript
export const MovingStatus = {
  STOPPED: 0,  // 시뮬레이션이 자동으로 정지 (충돌, 센서, 목적지 도착)
  MOVING: 1,   // 정상 주행
  PAUSED: 2,   // UI에서 수동 일시정지 (Individual Control Panel)
} as const;
```

**3가지 상태 비교표:**

| 상태 | 누가 설정 | velocity | 위치 업데이트 | 자동 해제 | 해제 방법 |
|------|----------|----------|--------------|----------|-----------|
| **STOPPED** | 시뮬레이션 자동 | 0으로 설정 | **계속 수행** | ✅ 조건 해제 시 | 자동 (충돌 해소, 센서 클리어) |
| **MOVING** | 시뮬레이션 자동 | 정상 | 정상 | - | - |
| **PAUSED** | **사용자 수동** (UI) | 0 | **완전 스킵** | ❌ | **수동 Resume 버튼만** |

**핵심 차이점:**

1. **STOPPED vs PAUSED - 위치 업데이트**
   ```typescript
   // movementUpdate.ts - shouldSkipUpdate()

   if (status === MovingStatus.PAUSED) {
     return true;  // ← PAUSED: 위치 업데이트 완전 스킵
   }

   if (status === MovingStatus.STOPPED) {
     data[ptr + MovementData.VELOCITY] = 0;  // velocity만 0
     return true;  // ← STOPPED: velocity만 0, 위치는 계속 업데이트
   }
   ```

2. **STOPPED - 자동 제어**
   - 시뮬레이션 로직이 자동으로 설정/해제
   - 충돌 발생 → STOPPED
   - 충돌 해소 → 자동으로 MOVING
   - StopReason에 이유가 기록됨 (SENSORED, LOCKED, ...)

3. **PAUSED - 수동 제어**
   - 사용자가 IndividualControlPanel에서 "Pause" 버튼 클릭
   - 차량이 **완전히 멈춤** (시간이 정지된 것처럼)
   - "Resume" 버튼으로만 해제
   - StopReason에 `INDIVIDUAL_CONTROL` 비트 설정

**사용 시나리오:**

```typescript
// 시나리오 1: 충돌로 인한 자동 정지 (STOPPED)
// collisionCommon.ts
if (hitZone === HitZone.STOP) {
  data[ptr + MovementData.MOVING_STATUS] = MovingStatus.STOPPED;
  data[ptr + LogicData.STOP_REASON] |= StopReason.SENSORED;
  // → 앞차가 사라지면 자동으로 MOVING 전환
}

// 시나리오 2: 사용자 수동 일시정지 (PAUSED)
// IndividualControlPanel.tsx
handlePause() {
  vehicleDataArray.setMovingStatus(vehicleIndex, MovingStatus.PAUSED);
  vehicleDataArray.setStopReason(vehicleIndex, reason | StopReason.INDIVIDUAL_CONTROL);
  // → Resume 버튼 누르기 전까지 완전히 멈춤
}

// 시나리오 3: Resume 버튼으로 재개
handleResume() {
  vehicleDataArray.setMovingStatus(vehicleIndex, MovingStatus.MOVING);
  vehicleDataArray.setStopReason(vehicleIndex, reason & ~(StopReason.INDIVIDUAL_CONTROL));
  // → PAUSED에서 MOVING으로 전환
}
```

**왜 2개가 아니라 3개인가?**
- STOPPED만으로는 "시뮬레이션 자동 정지"와 "사용자 수동 정지"를 구분 불가
- PAUSED가 없으면 사용자가 일시정지한 차량이 충돌 해소 시 자동으로 움직임 (의도하지 않은 동작)
- **사용자 의도 보존**: PAUSED는 사용자가 명시적으로 Resume할 때까지 절대 자동으로 풀리지 않음

##### NEXT_EDGE_STATE 상세 (왜 3개인가?)

```typescript
export const NextEdgeState = {
  EMPTY: 0,    // 다음 edge 없음 (초기 상태 또는 목적지 도착)
  PENDING: 1,  // edge 끝 도달, TransferMgr 처리 대기 중
  READY: 2,    // 다음 edge 결정 완료, 이동 준비됨
} as const;
```

**3가지 상태 비교표:**

| 상태 | NEXT_EDGE 값 | 의미 | 차량 동작 | 다음 전환 |
|------|--------------|------|-----------|-----------|
| **EMPTY** | -1 | 다음 edge 미정 | edge 끝 도달 시 대기 | → PENDING |
| **PENDING** | -1 | TransferMgr 처리 대기 | edge 끝에서 대기 | → READY or EMPTY |
| **READY** | 유효한 index | 다음 edge 확정 | edge 끝 도달 시 즉시 이동 | → EMPTY (이동 후) |

**상태 전환 흐름 (Life Cycle):**

```
┌─────────────────────────────────────────────────────────────┐
│                    차량 초기화                               │
│                         ↓                                    │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ EMPTY (다음 edge 없음)                                │  │
│  │ - NEXT_EDGE = -1                                      │  │
│  │ - 차량이 현재 edge에서 주행 중                        │  │
│  └───────────────────────────────────────────────────────┘  │
│                         ↓                                    │
│              edge 끝 도달 (ratio >= 1)                       │
│                         ↓                                    │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ PENDING (TransferMgr 큐 등록)                         │  │
│  │ - transferMgr.enqueueVehicleTransfer(vehIdx)          │  │
│  │ - 다음 프레임에 TransferMgr.update()가 처리           │  │
│  │ - 차량은 edge 끝에서 대기                             │  │
│  └───────────────────────────────────────────────────────┘  │
│                         ↓                                    │
│              TransferMgr.update() 처리                       │
│                    ↙           ↘                             │
│          다음 edge 있음      다음 edge 없음                  │
│                ↓                  ↓                          │
│  ┌──────────────────────┐   ┌─────────────────┐             │
│  │ READY                │   │ EMPTY           │             │
│  │ - NEXT_EDGE = 5      │   │ - NEXT_EDGE=-1  │             │
│  │ - 이동 준비 완료     │   │ - 목적지 도착   │             │
│  └──────────────────────┘   └─────────────────┘             │
│         ↓                                                    │
│  edge 끝 도달 시 즉시 이동                                   │
│         ↓                                                    │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ edgeTransition 실행                                   │  │
│  │ - 차량을 NEXT_EDGE로 이동                             │  │
│  │ - NEXT_EDGE_STATE = EMPTY (리셋)                      │  │
│  │ - NEXT_EDGE = -1 (리셋)                               │  │
│  └───────────────────────────────────────────────────────┘  │
│         ↓                                                    │
│   (다시 EMPTY 상태로 순환)                                   │
└─────────────────────────────────────────────────────────────┘
```

**각 상태의 세부 동작:**

**1. EMPTY - 다음 edge 미정 상태**
```typescript
// 초기 상태
data[ptr + MovementData.NEXT_EDGE] = -1;
data[ptr + MovementData.NEXT_EDGE_STATE] = NextEdgeState.EMPTY;

// edge 주행 중
// ratio: 0.0 → 0.5 → 0.9 → 1.0 (끝 도달)

// ratio >= 1.0이 되면 PENDING으로 전환
if (ratio >= 0 && nextEdgeState === NextEdgeState.EMPTY) {
  data[ptr + MovementData.NEXT_EDGE_STATE] = NextEdgeState.PENDING;
  transferMgr.enqueueVehicleTransfer(vehIdx);  // 큐에 추가
}
```

**2. PENDING - TransferMgr 처리 대기**
```typescript
// TransferMgr.update()에서 처리 (다음 프레임)
// - LOOP 모드: currentEdge.nextEdgeIndices[0] 선택
// - RANDOM 모드: 랜덤 선택
// - MQTT_CONTROL 모드: 명령 큐에서 가져오기
// - AUTO_ROUTE 모드: Dijkstra로 경로 탐색

// 다음 edge 결정됨
if (nextEdgeIndex !== -1) {
  data[ptr + MovementData.NEXT_EDGE] = nextEdgeIndex;
  data[ptr + MovementData.NEXT_EDGE_STATE] = NextEdgeState.READY;
} else {
  // 목적지 도착 (다음 edge 없음)
  data[ptr + MovementData.NEXT_EDGE_STATE] = NextEdgeState.EMPTY;
}
```

**3. READY - 다음 edge 확정, 이동 준비**
```typescript
// edge 끝에 도달하면 즉시 이동
if (nextState === NextEdgeState.READY && nextEdgeIndex !== -1) {
  // edgeTransition 실행

  // 1. 차량을 다음 edge로 이동
  ctx.store.moveVehicleToEdge(vehicleIndex, nextEdgeIndex, newRatio);

  // 2. 상태 리셋
  data[ptr + MovementData.NEXT_EDGE_STATE] = NextEdgeState.EMPTY;
  data[ptr + MovementData.NEXT_EDGE] = -1;

  // 3. 새 edge에서 다시 EMPTY 상태로 시작
}
```

**실제 시나리오 예시:**

```typescript
// 시나리오: 차량이 edge0 → edge1 → edge2로 이동

// === Frame 1 ===
// 차량이 edge0에서 주행 중
CURRENT_EDGE = 0, EDGE_RATIO = 0.5
NEXT_EDGE = -1, NEXT_EDGE_STATE = EMPTY

// === Frame 100 ===
// edge0 끝에 도달
CURRENT_EDGE = 0, EDGE_RATIO = 1.0
NEXT_EDGE = -1, NEXT_EDGE_STATE = PENDING  // ← 전환!
// transferMgr 큐에 등록됨

// === Frame 101 ===
// TransferMgr.update()가 처리
CURRENT_EDGE = 0, EDGE_RATIO = 1.0
NEXT_EDGE = 1, NEXT_EDGE_STATE = READY  // ← edge1로 결정!

// === Frame 102 ===
// edgeTransition 실행 (edge0 → edge1)
CURRENT_EDGE = 1, EDGE_RATIO = 0.05  // ← edge1로 이동 완료
NEXT_EDGE = -1, NEXT_EDGE_STATE = EMPTY  // ← 리셋

// (edge1에서 다시 EMPTY 상태로 주행 시작)
```

**왜 2개가 아니라 3개인가?**

만약 PENDING 없이 EMPTY, READY만 있다면:
```typescript
// ❌ 문제 발생: edge 끝 도달과 동시에 READY로 전환해야 함
if (ratio >= 1.0 && nextEdgeState === EMPTY) {
  // 다음 edge를 바로 결정해야 함 (동일 프레임 내)
  // → TransferMgr가 여러 차량을 한 프레임에 처리 불가
  // → 경로 탐색(Dijkstra)이 무거우면 프레임 드롭
}
```

**PENDING의 역할:**
- edge 끝 도달과 TransferMgr 처리를 **프레임 분리**
- TransferMgr가 **다음 프레임에 여유롭게 처리** (경로 탐색 시간 확보)
- **큐 기반 처리** 가능 (한 프레임에 일정 개수만 처리)
- edge 끝에서 대기하는 상태를 명시적으로 표현

#### SensorData (14~16): 센서 관련 데이터

| Index | 이름 | 설명 |
|-------|------|------|
| 14 | PRESET_IDX | 센서 프리셋 인덱스 (STRAIGHT/CURVE_LEFT/...) |
| 15 | HIT_ZONE | 충돌 감지 존 (NONE/APPROACH/BRAKE/STOP) |
| 16 | COLLISION_TARGET | 충돌 대상 차량 index (-1이면 없음) |

**HitZone 설명:**
```typescript
export const HitZone = {
  NONE: -1,        // 감지 안됨
  APPROACH: 0,     // 접근 구역 (감속 준비)
  BRAKE: 1,        // 제동 구역 (감속)
  STOP: 2,         // 정지 구역 (완전 정지)
} as const;
```

#### LogicData (17~21): 로직 관련 데이터

| Index | 이름 | 설명 |
|-------|------|------|
| 17 | TRAFFIC_STATE | 교차로/Merge 제어 상태 (FREE/WAITING/ACQUIRED) - [Lock Manager 상세](../logic/README.md) |
| 18 | STOP_REASON | 정지 이유 비트마스크 (OBS_LIDAR/E_STOP/LOCKED/...) |
| 19 | JOB_STATE | 작업 상태 (IDLE/MOVE_TO_LOAD/LOADING/...) |
| 20 | DESTINATION_EDGE | 목적지 edge index |
| 21 | PATH_REMAINING | 남은 경로 개수 |

##### STOP_REASON 비트마스크 (왜 비트마스크인가?)

```typescript
export const StopReason = {
  NONE: 0,                         // 0b00000000000 (정지 이유 없음)
  OBS_LIDAR: 1,                    // 0b00000000001 (라이다 장애물)
  OBS_CAMERA: 1 << 1,              // 0b00000000010 (카메라 장애물)
  E_STOP: 1 << 2,                  // 0b00000000100 (비상 정지)
  LOCKED: 1 << 3,                  // 0b00000001000 (Merge 잠금)
  DESTINATION_REACHED: 1 << 4,     // 0b00000010000 (목적지 도착)
  PATH_BLOCKED: 1 << 5,            // 0b00000100000 (경로 막힘)
  LOAD_ON: 1 << 6,                 // 0b00001000000 (적재 중)
  LOAD_OFF: 1 << 7,                // 0b00010000000 (하역 중)
  NOT_INITIALIZED: 1 << 8,         // 0b00100000000 (초기화 안됨)
  INDIVIDUAL_CONTROL: 1 << 9,      // 0b01000000000 (사용자 수동 제어)
  SENSORED: 1 << 10,               // 0b10000000000 (센서 감지)
} as const;
```

**왜 비트마스크를 사용하는가?**

일반적인 방법 (enum)으로는 **하나의 이유만** 저장 가능:
```typescript
// ❌ 문제: 여러 정지 이유를 동시에 표현 불가
stopReason = StopReason.LOCKED;  // Merge 잠금
// → 여기에 SENSORED도 추가하고 싶은데?
stopReason = StopReason.SENSORED;  // 이전 값 LOCKED가 사라짐!
```

비트마스크를 사용하면 **여러 이유를 동시에** 저장 가능:
```typescript
// ✅ 해결: 비트마스크로 여러 이유 동시 표현
stopReason = StopReason.LOCKED | StopReason.SENSORED;
// → 0b00000001000 | 0b10000000000 = 0b10000001000
// → LOCKED와 SENSORED 둘 다 설정됨!
```

**실제 시나리오 - 왜 동시에 여러 이유가 필요한가?**

```typescript
// 시나리오: 차량이 여러 이유로 정지
// 1. Merge 노드에서 잠금 대기 중 (LOCKED)
// 2. 동시에 앞에 차량 감지됨 (SENSORED)
// 3. 사용자가 수동 일시정지 (INDIVIDUAL_CONTROL)

// 비트마스크로 모두 표현
stopReason = StopReason.LOCKED | StopReason.SENSORED | StopReason.INDIVIDUAL_CONTROL;
// = 0b01000001000 | 0b10000000000 | 0b01000000000
// = 0b11000001000

// 이제 각 이유를 개별 체크 가능
if (stopReason & StopReason.LOCKED) {
  console.log("Merge 잠금 때문에 정지");
}
if (stopReason & StopReason.SENSORED) {
  console.log("센서 감지 때문에 정지");
}
if (stopReason & StopReason.INDIVIDUAL_CONTROL) {
  console.log("사용자 수동 정지");
}
// → 3가지 모두 출력됨!
```

**비트 연산 상세:**

```typescript
// 1. 비트 설정 (OR 연산 |)
stopReason |= StopReason.LOCKED;  // LOCKED 비트 켜기
stopReason |= StopReason.SENSORED;  // SENSORED 비트 켜기 (LOCKED 유지)

// 예:
// 초기: 0b00000000000
// |= LOCKED:     0b00000001000  →  0b00000001000
// |= SENSORED:   0b10000000000  →  0b10000001000

// 2. 비트 체크 (AND 연산 &)
if (stopReason & StopReason.LOCKED) {
  // LOCKED 비트가 켜져있는지 체크
}

// 예:
// stopReason: 0b10000001000
// &  LOCKED:  0b00000001000
// ────────────────────────
//    결과:    0b00000001000  (0이 아님 → true)

// 3. 비트 해제 (AND NOT 연산 &~)
stopReason &= ~StopReason.LOCKED;  // LOCKED 비트만 끄기 (나머지 유지)

// 예:
// stopReason:   0b10000001000
// ~LOCKED:      0b11111110111  (NOT 연산으로 비트 반전)
// &             0b10000000000  (LOCKED만 꺼짐, SENSORED 유지)

// 4. 여러 비트 동시 해제
stopReason &= ~(StopReason.LOCKED | StopReason.INDIVIDUAL_CONTROL);
// LOCKED와 INDIVIDUAL_CONTROL만 끄기

// 5. 비트 전체 초기화
stopReason = StopReason.NONE;  // 0b00000000000 (모두 끄기)
```

**실제 코드 예시:**

```typescript
// IndividualControlPanel.tsx - Resume 버튼
handleResume() {
  const currentReason = vehicleDataArray.getStopReason(vehicleIndex);

  // E_STOP과 INDIVIDUAL_CONTROL 비트만 끄기 (나머지 유지)
  const newReason = currentReason & ~(StopReason.E_STOP | StopReason.INDIVIDUAL_CONTROL);

  vehicleDataArray.setStopReason(vehicleIndex, newReason);

  // 예: 이전 값이 LOCKED | INDIVIDUAL_CONTROL | SENSORED 였다면
  //     → LOCKED | SENSORED 로 변경됨 (INDIVIDUAL_CONTROL만 제거)
}

// collisionCommon.ts - 충돌 감지
if (hitZone === HitZone.STOP) {
  const currentReason = data[ptr + LogicData.STOP_REASON];

  // SENSORED 비트 추가 (기존 이유들 유지)
  data[ptr + LogicData.STOP_REASON] = currentReason | StopReason.SENSORED;
}

// edgeTransition.ts - Merge 잠금 해제
if (nextEdge.vos_rail_type === EdgeType.MERGE) {
  const currentReason = data[ptr + LogicData.STOP_REASON];

  // LOCKED 비트만 제거 (SENSORED 등 다른 이유는 유지)
  data[ptr + LogicData.STOP_REASON] = currentReason & ~StopReason.LOCKED;
}
```

**메모리 효율성:**

```typescript
// ❌ 비트마스크 없이 구현하면?
// 각 이유마다 boolean 필요 (11개 필드 = 44 bytes)
const stopReasons = {
  obsLidar: false,      // 4 bytes
  obsCamera: false,     // 4 bytes
  eStop: false,         // 4 bytes
  locked: false,        // 4 bytes
  // ... 총 11개 = 44 bytes
};

// ✅ 비트마스크 사용
// 1개 int로 11개 boolean 표현 (4 bytes)
stopReason = 0b10000001000;  // 4 bytes로 11개 정보 저장!
```

**왜 이 방식이 필요한가? (실제 사례)**

```
차량 상황:
1. Merge 노드 대기 중 (LOCKED)
2. 앞에 차량 있음 (SENSORED)
3. 사용자가 일시정지 누름 (INDIVIDUAL_CONTROL)

해결 순서:
1. 사용자가 Resume 클릭
   → INDIVIDUAL_CONTROL 비트만 끄기
   → stopReason: LOCKED | SENSORED (여전히 정지)

2. 앞차 사라짐
   → SENSORED 비트 끄기
   → stopReason: LOCKED (여전히 정지)

3. Merge 잠금 해제
   → LOCKED 비트 끄기
   → stopReason: NONE (이제 출발 가능!)
```

각 이유가 **독립적으로 설정/해제**되므로, 비트마스크가 필수적입니다!

---

### 2. SensorPointArray (36 floats per vehicle)

충돌 감지용 센서 포인트를 저장합니다. 차량 1대당 **36개 float** (144 bytes).

```typescript
export const SENSOR_DATA_SIZE = 36;
export const SENSOR_ZONE_COUNT = 3;        // APPROACH, BRAKE, STOP
export const SENSOR_POINT_SIZE = 12;       // 6 points × 2 coords

// 차량 0의 센서 데이터: data[0~35]
//   - APPROACH zone: data[0~11]
//   - BRAKE zone: data[12~23]
//   - STOP zone: data[24~35]
```

#### Zone 구조 (3개 존)

각 zone은 **6개 포인트 × (x, y) = 12 floats**로 구성됩니다.

```
Zone 0: APPROACH (접근 구역)
Zone 1: BRAKE (제동 구역)
Zone 2: STOP (정지 구역)

각 Zone의 6개 포인트:
┌─────────┐
│ SL   SR │  ← 센서 끝 (가장 앞)
│         │
│ FL   FR │  ← 앞 모서리
│         │
│ BL   BR │  ← 뒤 모서리
└─────────┘
```

#### 포인트 인덱스

```typescript
export const SensorPoint = {
  FL_X: 0,  FL_Y: 1,   // Front Left
  FR_X: 2,  FR_Y: 3,   // Front Right
  BL_X: 4,  BL_Y: 5,   // Back Left
  BR_X: 6,  BR_Y: 7,   // Back Right
  SL_X: 8,  SL_Y: 9,   // Sensor Left tip
  SR_X: 10, SR_Y: 11,  // Sensor Right tip
} as const;
```

#### 메모리 레이아웃 예시

```
차량 0, APPROACH zone (data[0~11]):
  [FL_X, FL_Y, FR_X, FR_Y, BL_X, BL_Y, BR_X, BR_Y, SL_X, SL_Y, SR_X, SR_Y]
   ↑                                                      ↑
   앞 모서리                                              센서 끝

차량 0, BRAKE zone (data[12~23]):
  [FL_X, FL_Y, FR_X, FR_Y, BL_X, BL_Y, BR_X, BR_Y, SL_X, SL_Y, SR_X, SR_Y]

차량 0, STOP zone (data[24~35]):
  [FL_X, FL_Y, FR_X, FR_Y, BL_X, BL_Y, BR_X, BR_Y, SL_X, SL_Y, SR_X, SR_Y]
```

---

### 3. EdgeVehicleQueue

Edge별로 차량 목록을 관리하는 자료구조입니다.

```typescript
const MAX_VEHICLES_PER_EDGE = 100;
const EDGE_LIST_SIZE = MAX_VEHICLES_PER_EDGE + 1;  // count + vehicles

// Edge별로 Int32Array 생성
edgeArray[edgeIndex] = [count, veh1, veh2, ..., veh100]
```

#### 구조

```
Edge 0의 데이터: Int32Array(101)
  [3, 5, 12, 8, -1, -1, ..., -1]
   ↑  ↑  ↑   ↑
   │  └──┴───┴─ 차량 인덱스들 (5번, 12번, 8번 차량)
   └─ count (3대)

Edge 1의 데이터: Int32Array(101)
  [2, 0, 7, -1, -1, ..., -1]
   ↑  ↑  ↑
   │  └──┴─ 차량 인덱스들 (0번, 7번 차량)
   └─ count (2대)
```

#### 용도

- **충돌 감지**: edge 내 차량 순서 파악
- **앞차와의 거리 계산**: 앞에 있는 차량 찾기
- **edge 포화도 체크**: count가 MAX_VEHICLES_PER_EDGE에 가까우면 경고

---

## 코드 가이드 (API, 사용법)

### VehicleDataArrayBase

#### 생성 및 SharedBuffer 설정

```typescript
// 1. 생성 (skipAllocation=true: SharedBuffer 사용 예정)
const vehicleData = new VehicleDataArrayBase(maxVehicles, true);

// 2-a. 전체 버퍼 사용 (단일 Worker, 하위호환)
vehicleData.setBuffer(sharedArrayBuffer);

// 2-b. 영역 제한 사용 (멀티 Worker)
vehicleData.setBufferWithRegion(sharedArrayBuffer, {
  offset: 0,
  size: 88000,        // 1000 vehicles × 22 floats × 4 bytes
  maxVehicles: 1000
});
```

#### 데이터 읽기/쓰기 (dict-like 접근)

```typescript
// dict-like 접근 (편리하지만 약간 느림)
const vehicle = vehicleData.get(vehicleIndex);

// 읽기
const x = vehicle.movement.x;
const y = vehicle.movement.y;
const velocity = vehicle.movement.velocity;
const currentEdge = vehicle.movement.currentEdge;

// 쓰기
vehicle.movement.x = 10.5;
vehicle.movement.velocity = 5.0;
```

#### 데이터 직접 접근 (고성능)

```typescript
// Float32Array 직접 접근 (최고 성능)
const data = vehicleData.getData();
const ptr = vehicleIndex * VEHICLE_DATA_SIZE;

// 읽기
const x = data[ptr + MovementData.X];
const y = data[ptr + MovementData.Y];
const velocity = data[ptr + MovementData.VELOCITY];

// 쓰기
data[ptr + MovementData.X] = 10.5;
data[ptr + MovementData.VELOCITY] = 5.0;
```

**성능 비교:**
- dict-like: 편리하지만 getter/setter 오버헤드
- 직접 접근: 최고 성능, Worker 루프에서 권장

---

### SensorPointArrayBase

#### 생성 및 설정

```typescript
// 1. 생성
const sensorData = new SensorPointArrayBase(maxVehicles, true);

// 2. SharedBuffer 설정
sensorData.setBufferWithRegion(sensorBuffer, {
  offset: 0,
  size: 144000,       // 1000 vehicles × 36 floats × 4 bytes
  maxVehicles: 1000
});
```

#### Zone별 포인트 읽기

```typescript
// Zone 0 (APPROACH) 포인트 읽기
const approachPoints = sensorData.getPoints(vehicleIndex, 0);
// Returns: { FL, FR, BL, BR, SL, SR }
// 각 포인트: { x: number, y: number }

console.log(approachPoints.SL.x, approachPoints.SL.y);  // 센서 왼쪽 끝
console.log(approachPoints.SR.x, approachPoints.SR.y);  // 센서 오른쪽 끝
```

#### 직접 접근 (고성능)

```typescript
const data = sensorData.getData();
const zoneOffset = sensorData.getZoneOffset(vehicleIndex, zoneIndex);

// APPROACH zone의 SL (Sensor Left) 포인트
const slX = data[zoneOffset + SensorPoint.SL_X];
const slY = data[zoneOffset + SensorPoint.SL_Y];
```

---

### EdgeVehicleQueue

#### 생성 및 사용

```typescript
const edgeQueue = new EdgeVehicleQueue(maxEdges);

// 차량 추가
edgeQueue.addVehicle(edgeIndex, vehicleIndex);

// 차량 제거
edgeQueue.removeVehicle(edgeIndex, vehicleIndex);

// Edge 내 모든 차량 가져오기
const vehicles = edgeQueue.getVehicles(edgeIndex);
// Returns: [veh1, veh2, veh3, ...]

// Edge 내 차량 수
const count = edgeQueue.getCount(edgeIndex);
```

#### 앞차 찾기 (충돌 감지용)

```typescript
const vehicles = edgeQueue.getVehicles(currentEdgeIndex);
const myIndex = vehicles.indexOf(vehicleIndex);

if (myIndex > 0) {
  // 앞차가 있음
  const frontVehicle = vehicles[myIndex - 1];
  const frontRatio = vehicleData.get(frontVehicle).movement.edgeRatio;
  const myRatio = vehicleData.get(vehicleIndex).movement.edgeRatio;

  const distance = (frontRatio - myRatio) * edgeLength;
  if (distance < SAFE_DISTANCE) {
    // 감속 필요
  }
}
```

---

## 메모리 사용량 계산

### 차량 1대당 메모리

```typescript
// VehicleDataArray
const vehicleMemory = 22 floats × 4 bytes = 88 bytes

// SensorPointArray
const sensorMemory = 36 floats × 4 bytes = 144 bytes

// 합계
const totalPerVehicle = 88 + 144 = 232 bytes
```

### 예시: 10만 대 차량

```typescript
// VehicleDataArray
100,000 × 88 bytes = 8.8 MB

// SensorPointArray
100,000 × 144 bytes = 14.4 MB

// EdgeVehicleQueue (1000 edges)
1,000 edges × 101 int32 × 4 bytes = 0.4 MB

// 총 메모리
8.8 + 14.4 + 0.4 = 23.6 MB  (매우 경량!)
```

---

## 최적화 팁

### 1. 루프 내에서는 직접 접근

```typescript
// ❌ 느린 예: dict-like 접근
for (let i = 0; i < numVehicles; i++) {
  const veh = vehicleData.get(i);
  veh.movement.x += veh.movement.velocity * delta;
}

// ✅ 빠른 예: 직접 접근
const data = vehicleData.getData();
for (let i = 0; i < numVehicles; i++) {
  const ptr = i * VEHICLE_DATA_SIZE;
  data[ptr + MovementData.X] += data[ptr + MovementData.VELOCITY] * delta;
}
```

### 2. 자주 쓰는 데이터 캐싱

```typescript
// ✅ offset 캐싱
const ptr = vehicleIndex * VEHICLE_DATA_SIZE;
const x = data[ptr + MovementData.X];
const y = data[ptr + MovementData.Y];
const vel = data[ptr + MovementData.VELOCITY];

// ❌ 매번 계산
const x = data[vehicleIndex * VEHICLE_DATA_SIZE + MovementData.X];
const y = data[vehicleIndex * VEHICLE_DATA_SIZE + MovementData.Y];
```

### 3. 비트마스크 활용

```typescript
// StopReason 비트마스크
const reason = data[ptr + LogicData.STOP_REASON];

// 여러 조건 한 번에 체크
if (reason & (StopReason.LOCKED | StopReason.SENSORED)) {
  // LOCKED 또는 SENSORED
}

// 특정 비트만 설정
data[ptr + LogicData.STOP_REASON] |= StopReason.LOCKED;

// 특정 비트만 해제
data[ptr + LogicData.STOP_REASON] &= ~StopReason.LOCKED;
```

---

## 주의사항

### SharedArrayBuffer 동시 접근

Main Thread는 **읽기만**, Worker Thread는 **쓰기만** 해야 합니다.

```typescript
// ✅ Main Thread: 읽기만
const data = vehicleData.getData();
const x = data[ptr + MovementData.X];

// ❌ Main Thread: 쓰기 금지 (Worker 데이터 손상)
data[ptr + MovementData.X] = newX;  // 절대 금지!

// ✅ Worker Thread: 쓰기
data[ptr + MovementData.X] = newX;
```

### 메모리 영역 초과 방지

```typescript
// ✅ 영역 체크
if (vehicleIndex >= 0 && vehicleIndex < maxVehicles) {
  const ptr = vehicleIndex * VEHICLE_DATA_SIZE;
  data[ptr + MovementData.X] = x;
}

// ❌ 체크 없이 접근 (영역 초과 위험)
const ptr = vehicleIndex * VEHICLE_DATA_SIZE;
data[ptr + MovementData.X] = x;
```

---

## 관련 문서

- [시스템 아키텍처](../../../doc/SYSTEM_ARCHITECTURE.md)
- [Worker 시뮬레이션 엔진](../../shmSimulator/README.md)
- [Worker 핵심 컴포넌트](../../shmSimulator/core/README.md)
- [Three.js 렌더링 시스템](../../components/three/README.md)
