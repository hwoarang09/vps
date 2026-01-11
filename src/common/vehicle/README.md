# Vehicle Common Logic

차량 시뮬레이션의 핵심 비즈니스 로직을 담당하는 모듈입니다. 메모리 모드(`arrayMode`, `shmMode`, `rapierMode`)에 독립적으로 동작하는 순수 로직입니다.

## 불변조건 (Invariants)

### 메모리 모드 독립성
- **양방향 지원**: 모든 함수는 `arrayMode`와 `shmMode` 양쪽을 지원해야 함
- **상태 동기화**: `memory/`의 구조 변경 시 모든 모드가 동기화되어야 함
- **인터페이스 일관성**: 외부 API(함수 시그니처)는 모드와 무관하게 동일해야 함

### 로직 의존성
- **이동 = 물리 + 충돌**: `movement/`는 `physics/`와 `collision/` 결과를 반영해야 함
- **초기화 순서**: `initialize/` → `store/` → 나머지 로직 순서 보장
- **상태 불일치 방지**: 위치, 속도, 방향은 항상 일관성을 유지해야 함

### 데이터 무결성
- **Vehicle ID 범위**: 0 <= vehicleId < maxVehicles
- **Edge Index 유효성**: 모든 edgeIdx는 edges 배열 범위 내
- **진행도 범위**: 0.0 <= progress <= 1.0

## 폴더 구조

```
src/common/vehicle/
├── memory/                     # 메모리 구조 정의
│   ├── VehicleDataArrayBase.ts # Vehicle 데이터 배열 (22 floats)
│   ├── SensorPointArrayBase.ts # Sensor 데이터 배열 (36 floats)
│   └── EdgeVehicleQueue.ts     # Edge별 Vehicle 큐 관리
│
├── initialize/                 # 차량 초기화
│   ├── constants.ts            # 상수 및 TransferMode 정의
│   └── ...                     # 초기화 로직
│
├── movement/                   # 위치/속도 업데이트
│   └── ...                     # 이동 로직
│
├── physics/                    # 속력 계산
│   └── ...                     # 물리 로직
│
├── collision/                  # 충돌 감지
│   └── ...                     # 충돌 로직
│
├── logic/                      # 상태 머신 및 의사결정
│   ├── LockMgr.ts              # 교차로 잠금 관리
│   ├── TransferMgr.ts          # 차량 이송 관리
│   ├── AutoMgr.ts              # 자동 경로 생성
│   └── Dijkstra.ts             # 최단 경로 계산
│
├── store/                      # 데이터 관리 레이어
│   └── ...                     # 각 모드별 Store 인터페이스
│
└── helpers/                    # 유틸리티 함수
    └── ...                     # 공통 헬퍼 함수
```

## 핵심 모듈

### 1. `memory/` - 메모리 구조

#### `VehicleDataArrayBase.ts`
차량의 모든 상태를 저장하는 Float32Array 기반 배열입니다.

**메모리 레이아웃 (22 floats per vehicle)**
```
Index | Field           | Type    | Description
------|-----------------|---------|----------------------------------
0-2   | position        | Vec3    | (x, y, z)
3-6   | rotation        | Quat    | (x, y, z, w)
7     | speed           | float   | 현재 속력 (m/s)
8     | targetSpeed     | float   | 목표 속력 (m/s)
9     | edgeIdx         | int     | 현재 edge index
10    | progress        | float   | Edge 내 진행도 (0.0 ~ 1.0)
11    | state           | int     | 차량 상태 (0:idle, 1:moving, ...)
12    | pathIdx         | int     | 경로 인덱스
13    | frontVehId      | int     | 앞차 ID (-1 = 없음)
14    | backVehId       | int     | 뒷차 ID (-1 = 없음)
15-17 | color           | Vec3    | RGB (0.0 ~ 1.0)
18-21 | reserved        | float   | 예약 필드 (확장용)
```

**주요 메서드**
```typescript
class VehicleDataArrayBase {
  // 메모리 설정
  setBuffer(buffer: SharedArrayBuffer, region?: MemoryRegion): void

  // 위치/회전
  getPosition(vehId: number): [number, number, number]
  setPosition(vehId: number, x: number, y: number, z: number): void
  getRotation(vehId: number): [number, number, number, number]
  setRotation(vehId: number, x: number, y: number, z: number, w: number): void

  // 속도/이동
  getSpeed(vehId: number): number
  setSpeed(vehId: number, speed: number): void
  getEdgeIdx(vehId: number): number
  getProgress(vehId: number): number
  setProgress(vehId: number, progress: number): void

  // 연결 관계
  getFrontVehId(vehId: number): number
  setFrontVehId(vehId: number, frontId: number): void

  // 색상
  getColor(vehId: number): [number, number, number]
  setColor(vehId: number, r: number, g: number, b: number): void
}
```

#### `SensorPointArrayBase.ts`
센서 포인트(차량 주변 4개 모서리) 데이터를 저장합니다.

**메모리 레이아웃 (36 floats per vehicle)**
```
Index | Field           | Description
------|-----------------|----------------------------------
0-2   | frontLeft       | (x, y, z)
3-5   | frontRight      | (x, y, z)
6-8   | backLeft        | (x, y, z)
9-11  | backRight       | (x, y, z)
... (총 36 floats, 세부 스펙은 구현 참조)
```

#### `EdgeVehicleQueue.ts`
각 Edge마다 진입한 차량들의 순서를 관리합니다.

```typescript
class EdgeVehicleQueue {
  // Edge에 차량 추가 (꼬리에 추가)
  enqueue(edgeIdx: number, vehId: number): void

  // Edge에서 차량 제거
  dequeue(edgeIdx: number): number | null

  // Edge의 선두 차량 조회
  getHead(edgeIdx: number): number | null

  // Edge 내 모든 차량 ID 배열
  getVehicles(edgeIdx: number): number[]
}
```

---

### 2. `initialize/` - 차량 초기화

차량 생성 시 필요한 초기값 설정 로직입니다.

```typescript
// 초기화 순서
1. Edge에 차량 배치 위치 계산
2. VehicleDataArrayBase에 초기값 설정
3. EdgeVehicleQueue에 추가
4. 경로(path) 할당
```

**TransferMode (constants.ts)**
```typescript
export enum TransferMode {
  DISABLED = 0,    // 이송 비활성화
  ENABLED = 1,     // 수동 이송 (MQTT 명령)
  AUTO = 2         // 자동 이송 (AutoMgr)
}
```

---

### 3. `movement/` - 이동 로직

차량의 위치와 속도를 업데이트합니다.

```typescript
// 이동 업데이트 흐름
updateMovement(context: Context, delta: number): void {
  for each vehicle:
    1. progress += (speed * delta) / edgeLength
    2. if (progress >= 1.0):
         - 다음 Edge로 전환
         - EdgeVehicleQueue 업데이트
    3. position = interpolateAlongEdge(progress)
    4. rotation = calculateRotation(direction)
}
```

---

### 4. `physics/` - 물리 계산

속력(speed) 계산 및 가속/감속 처리입니다.

```typescript
// 물리 업데이트 흐름
updatePhysics(context: Context, delta: number): void {
  for each vehicle:
    1. Calculate target speed based on:
       - Edge type (linear/curve)
       - Front vehicle distance
       - Intersection lock state
    2. Accelerate or decelerate:
       if (speed < targetSpeed):
         speed += acceleration * delta
       else if (speed > targetSpeed):
         speed -= deceleration * delta
    3. Clamp speed to [0, maxSpeed]
}
```

**속력 결정 요소**
- Edge 유형 (직선: linearMaxSpeed, 곡선: curveMaxSpeed)
- 앞차와의 거리 (안전거리 미만 시 감속)
- 교차로 잠금 상태 (LockMgr)

---

### 5. `collision/` - 충돌 감지

차량 간 충돌 및 안전거리 체크입니다.

```typescript
// 충돌 감지 흐름
checkCollisions(context: Context): void {
  for each vehicle:
    1. Get front vehicle (from frontVehId)
    2. Calculate distance to front
    3. if (distance < safeDistance):
         - Set targetSpeed = min(frontSpeed, brakeSpeed)
         - Trigger brake state
    4. Check sensor-based collision (optional)
}
```

---

### 6. `logic/` - 고급 로직

#### `LockMgr.ts` - 교차로 잠금 관리

교차로(intersection node)에서 차량의 진입 순서를 제어합니다.

```typescript
class LockMgr {
  // 노드 잠금 요청
  requestLock(nodeIdx: number, vehId: number): boolean

  // 노드 잠금 해제
  releaseLock(nodeIdx: number, vehId: number): void

  // 차량이 노드를 점유 중인지 확인
  isLocked(nodeIdx: number): boolean

  // 노드를 점유한 차량 ID
  getLockedVehicle(nodeIdx: number): number | null
}
```

**동작 원리**
1. 차량이 교차로에 접근하면 `requestLock()` 호출
2. 이미 잠긴 경우 `false` 반환 → 차량 감속
3. 잠금 성공 시 교차로 통과
4. 통과 후 `releaseLock()` 호출

#### `TransferMgr.ts` - 차량 이송 관리

차량을 특정 Edge로 순간이동(teleport)시키는 로직입니다.

```typescript
class TransferMgr {
  // 차량 이송
  transferVehicle(
    vehId: number,
    targetEdgeIdx: number,
    progress?: number
  ): void

  // MQTT 명령 처리
  executeCommand(command: VehicleCommand): void
}
```

**사용 사례**
- Fab 간 차량 이동
- 특정 위치로 강제 이동 (디버깅/테스트)
- Station에서 차량 호출

#### `AutoMgr.ts` - 자동 경로 생성

목적지를 자동으로 설정하고 Dijkstra로 경로를 계산합니다.

```typescript
class AutoMgr {
  // 차량에 랜덤 목적지 할당
  assignRandomDestination(vehId: number): void

  // 목적지 도달 시 새 목적지 재할당
  onDestinationReached(vehId: number): void
}
```

#### `Dijkstra.ts` - 최단 경로 계산

노드 그래프 기반 최단 경로 알고리즘입니다.

```typescript
function dijkstra(
  nodes: Node[],
  edges: Edge[],
  startNodeIdx: number,
  endNodeIdx: number
): number[] | null  // Edge index 배열
```

**성능 최적화**
- 결과 캐싱: 동일한 (start, end) 쌍은 재계산하지 않음
- Priority Queue 사용: O((E + V) log V)
- 주기적 캐시 클리어: 메모리 누수 방지

---

### 7. `store/` - 데이터 관리 레이어

각 메모리 모드별 Store 인터페이스를 제공합니다. 실제 구현은 `src/store/vehicle/`에 있습니다.

---

## 사용 예시

### 차량 초기화

```typescript
import { initializeVehicles } from "@/common/vehicle/initialize";
import { VehicleDataArrayBase } from "@/common/vehicle/memory";

const vehicleData = new VehicleDataArrayBase();
vehicleData.setBuffer(sharedBuffer);

initializeVehicles({
  vehicleData,
  edges,
  numVehicles: 1000,
  startEdgeIdx: 0,
  vehicleConfigs: [{ acceleration: 3, deceleration: 5, maxSpeed: 5 }]
});
```

### 시뮬레이션 스텝

```typescript
import { updatePhysics } from "@/common/vehicle/physics";
import { checkCollisions } from "@/common/vehicle/collision";
import { updateMovement } from "@/common/vehicle/movement";

function simulationStep(delta: number) {
  const context = {
    vehicleData: vehicleData.getData(),
    edges,
    edgeMap,
    lockMgr,
    config
  };

  // 1. 물리 업데이트 (속력 계산)
  updatePhysics(context, delta);

  // 2. 충돌 감지
  checkCollisions(context);

  // 3. 이동 처리 (위치 업데이트)
  updateMovement(context, delta);
}
```

### 교차로 관리

```typescript
import { LockMgr } from "@/common/vehicle/logic/LockMgr";

const lockMgr = new LockMgr();
lockMgr.init(nodes);

// 차량이 교차로 접근 시
const canPass = lockMgr.requestLock(nodeIdx, vehId);
if (!canPass) {
  // 감속 처리
  vehicleData.setTargetSpeed(vehId, 0);
}

// 차량이 교차로 통과 완료 시
lockMgr.releaseLock(nodeIdx, vehId);
```

### 차량 이송

```typescript
import { TransferMgr } from "@/common/vehicle/logic/TransferMgr";

const transferMgr = new TransferMgr(vehicleData, edges);

// 차량을 특정 Edge로 이송
transferMgr.transferVehicle(vehId, targetEdgeIdx, 0.5);  // 50% 진행도에 배치
```

## 개발 가이드

### 새로운 필드 추가

1. **메모리 레이아웃 수정** (`VehicleDataArrayBase.ts`)
```typescript
export const OFFSET = {
  // ... 기존 필드
  NEW_FIELD: 21,  // reserved4를 재활용
} as const;

class VehicleDataArrayBase {
  getNewField(vehId: number): number {
    return this.data[vehId * VEHICLE_DATA_SIZE + OFFSET.NEW_FIELD];
  }

  setNewField(vehId: number, value: number): void {
    this.data[vehId * VEHICLE_DATA_SIZE + OFFSET.NEW_FIELD] = value;
  }
}
```

2. **초기화 로직 업데이트** (`initialize/`)
```typescript
// 새 필드의 초기값 설정
vehicleData.setNewField(vehId, defaultValue);
```

3. **모든 모드 동기화**
- `arrayMode`, `shmMode`, `rapierMode` 모두 동일한 레이아웃 사용 확인

### 성능 최적화

#### 조기 종료 (Early Exit)
```typescript
// ❌ 모든 차량을 항상 체크
for (const vehId of allVehicles) {
  checkCollision(vehId);
}

// ✅ 조건에 맞는 차량만 체크
for (const vehId of movingVehicles) {
  if (vehicleData.getSpeed(vehId) === 0) continue;
  checkCollision(vehId);
}
```

#### 벡터 연산 최적화
```typescript
// ❌ 객체 생성 (GC 압박)
const pos = vehicleData.getPosition(vehId);
const newPos = { x: pos.x + dx, y: pos.y + dy, z: pos.z + dz };

// ✅ 직접 계산
const [x, y, z] = vehicleData.getPosition(vehId);
vehicleData.setPosition(vehId, x + dx, y + dy, z + dz);
```

### 디버깅 팁

#### 차량 상태 덤프
```typescript
function dumpVehicleState(vehId: number): void {
  console.log({
    pos: vehicleData.getPosition(vehId),
    rot: vehicleData.getRotation(vehId),
    speed: vehicleData.getSpeed(vehId),
    edgeIdx: vehicleData.getEdgeIdx(vehId),
    progress: vehicleData.getProgress(vehId),
    frontVehId: vehicleData.getFrontVehId(vehId)
  });
}
```

#### 메모리 무결성 체크
```typescript
function validateVehicleData(vehId: number): boolean {
  const progress = vehicleData.getProgress(vehId);
  if (progress < 0 || progress > 1) {
    console.error(`Invalid progress: ${progress}`);
    return false;
  }

  const edgeIdx = vehicleData.getEdgeIdx(vehId);
  if (edgeIdx < 0 || edgeIdx >= edges.length) {
    console.error(`Invalid edgeIdx: ${edgeIdx}`);
    return false;
  }

  return true;
}
```

## 주의사항

### 메모리 모드 호환성
- 모든 함수는 `VehicleDataArrayBase`를 사용해야 함 (모드별 구현체 NO)
- `arrayMode`에서 동작하는 코드는 `shmMode`에서도 동일하게 동작해야 함

### 상태 일관성
- 위치, 속도, 방향은 항상 동기화되어야 함
- Edge 전환 시 `EdgeVehicleQueue` 업데이트 필수
- 차량 제거 시 연결 관계(front/back) 정리 필수

### 반복문 규칙 (CLAUDE.md)
```typescript
// ❌ forEach 금지
vehicles.forEach((veh) => update(veh));

// ✅ for...of 사용
for (const veh of vehicles) {
  update(veh);
}
```

## 관련 문서
- [시스템 전체 아키텍처](../../doc/README.md)
- [shmSimulator 사용법](../shmSimulator/README.md)
- [Three.js 렌더링](../components/three/README.md)
- [Store 모드별 구현](../store/vehicle/README.md)
