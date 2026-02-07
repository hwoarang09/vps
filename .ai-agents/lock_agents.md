# Lock System - AI Context

## 상태: Checkpoint 시스템으로 전환 (2026-02-06 최종 설계)

---

## 1. 현재 분석 완료

### step() 실제 순서
```
FabContext.step():
  1. Collision Check
  2. Lock (lockMgr.updateAll)  ← 현재 stub
  3. Movement
     ├─ transferMgr.processTransferQueue()  ← NEXT_EDGE 채움
     └─ for each vehicle:
          └─ edge 전환 시 → shiftAndRefillNextEdges()  ← NEXT_EDGE shift
  4. AutoRouting
     └─ transferMgr.assignCommand()  ← pathBuffer + NEXT_EDGE 채움
  5. Render
```

### NEXT_EDGE 수정하는 곳 (현재 3군데)
| 파일 | 함수 | 언제 |
|------|------|------|
| `TransferMgr.ts:285` | `fillNextEdgesFromPathBuffer()` | 경로 설정 시 |
| `TransferMgr.ts:326` | `fillNextEdgesFromLoopMap()` | LOOP 모드 |
| `edgeTransition.ts:305` | `shiftAndRefillNextEdges()` | edge 전환 성공 시 |

### VehicleDataArray 관련 필드
| 필드 | 오프셋 | 용도 |
|------|--------|------|
| `CURRENT_EDGE` | 9 | 현재 edge index (1-based) |
| `NEXT_EDGE_0~4` | 10~14 | 다음 edge들 |
| `NEXT_EDGE_STATE` | 15 | EMPTY/PENDING/READY |
| `EDGE_RATIO` | 7 | edge 진행률 (0.0~1.0) |
| `STOP_REASON` | 18 | 정지 사유 bitmask (LOCKED = 1<<3) |

---

## 2. 새 설계 방향 (합의됨)

### 핵심 원칙
**NEXT_EDGE를 수정하는 놈은 LockMgr 한 놈만!**

### 역할 분리
| 컴포넌트 | 현재 | 변경 후 |
|----------|------|---------|
| AutoMgr | pathBuffer + NEXT_EDGE | **pathBuffer만** |
| TransferMgr | NEXT_EDGE 채움/shift | **pathBuffer shift만** (또는 제거) |
| LockMgr | stub | **pathBuffer 읽고 → lock 체크 → NEXT_EDGE 설정** |

### 새 step() 흐름
```
1. Collision
2. Lock (lockMgr.updateAll)
   - pathBuffer에서 경로 읽기
   - merge node 찾기
   - lock 요청/체크
   - lock 없으면: merge 직전까지만 NEXT_EDGE 채움
   - lock 있으면: merge 통과하는 NEXT_EDGE 채움
3. Movement
   - NEXT_EDGE 따라 이동 (읽기만)
   - edge 전환 시 → lockMgr.onEdgeTransition() 호출
4. AutoRouting
   - pathBuffer만 갱신 (NEXT_EDGE 안 건드림)
```

### 장점
- lock 없이 merge에 진입하는 버그가 구조적으로 불가능
- NEXT_EDGE 수정 책임이 한 곳에 집중

---

## 3. 변경 필요한 파일

| 파일 | 변경 내용 |
|------|-----------|
| `LockMgr.ts` | processLock() 구현 - pathBuffer 읽고 NEXT_EDGE 설정 |
| `TransferMgr.ts` | fillNextEdgesFromPathBuffer() 제거 또는 비활성화 |
| `edgeTransition.ts` | shiftAndRefillNextEdges()에서 NEXT_EDGE 채우는 부분 제거 |
| `AutoMgr.ts` | assignCommand() 호출 시 NEXT_EDGE 채우는 부분 제거 |

---

## 4. Lock과 Movement 통신 메커니즘

### 핵심 필드
| 필드 | 오프셋 | 역할 | 누가 씀/읽음 |
|------|--------|------|-------------|
| `MOVING_STATUS` | 8 | 상위 상태 (PAUSED면 Movement 스킵) | Movement가 체크 |
| `VELOCITY` | 6 | **실제 속도** (m/s) | Movement가 읽고 계산 |
| `STOP_REASON` | 18 | 정지 이유 bitmask | Lock/Collision이 씀, 디버깅용 |

### STOP_REASON 비트마스크
```typescript
export const StopReason = {
  NONE: 0,
  OBS_LIDAR: 1,
  OBS_CAMERA: 1 << 1,
  E_STOP: 1 << 2,
  LOCKED: 1 << 3,              // Lock 대기
  DESTINATION_REACHED: 1 << 4,
  PATH_BLOCKED: 1 << 5,
  LOAD_ON: 1 << 6,
  LOAD_OFF: 1 << 7,
  NOT_INITIALIZED: 1 << 8,
  SENSORED: 1 << 9,            // 센서 충돌
  IDLE: 1 << 10,               // 명령 대기
} as const;
```

### Lock이 Movement를 멈추는 방법
**Lock 요청 → 대기지점까지 이동 → TARGET_RATIO 도달 → 멈춤**

1. **processLock()** (step 2):
   - Lock grant 못 받으면:
     - TARGET_RATIO = waitPoint (예: 0.7)
     - NEXT_EDGE를 waitPoint까지만 채움

2. **Movement** (step 3):
   - TARGET_RATIO까지 정상 이동
   - TARGET_RATIO 도달하면:
     - MOVING_STATUS = STOPPED
     - velocity = 0
     - STOP_REASON |= LOCKED

3. **다음 프레임**:
   - shouldSkipUpdate() → STOPPED → Movement 스킵
   - processLock()에서 grant 재확인
     - grant 받으면: MOVING_STATUS = MOVING으로 변경

---

## 5. Barcode 시스템 (절대 좌표)

### Barcode의 의미
- **절대 좌표**: 맵 전체에서의 누적 거리
- **단위**: mm (millimeter)
- **정의**: node.map 파일에 각 node마다 정의됨

### node.map 예시
```
node_name, barcode, editor_x, editor_y, editor_z
NODE0001,  470,     2.325,    0.47,     3.8      ← 470mm = 0.47m
NODE0002,  53690,   2.325,    53.691,   3.8      ← 53690mm = 53.69m
NODE0003,  56170,   2.325,    56.171,   3.8      ← 56170mm = 56.17m
```

### Barcode 계산
```
NODE0001: 470mm (시작점)
NODE0002: 470 + 53221 (EDGE0001 길이) = 53691mm ✓
NODE0003: 53690 + 2480 (EDGE0002 길이) = 56170mm ✓
```

### 중요: Barcode는 단조증가 아님!
**합류 시 barcode 감소 가능:**
```
메인 루프:
NODE_A (barcode: 1000) → NODE_B (barcode: 5000) → NODE_C (barcode: 10000)
                            ↑
                            합류
사이드 루프:                  │
NODE_X (barcode: 50000) → NODE_Y (barcode: 52000) → NODE_B (barcode: 5000)
                                                              ↑
                                                    52000→5000 급감!
```

**따라서 Edge 기준 체크가 필수!**

---

## 6. 성능 최적화: Checkpoint 시스템

### 문제점
매 프레임 processLock()에서 복잡한 계산 → 10만대 × 60fps = 600만번!

### 해결책: Barcode + Checkpoint
```typescript
processLock(vehicleId) {
  const currentEdge = data[ptr + MovementData.CURRENT_EDGE];
  const currentBarcode = data[ptr + LogicData.CURRENT_BARCODE];
  const matchEdge = data[ptr + LogicData.MATCH_EDGE];
  const matchBarcode = data[ptr + LogicData.MATCH_BARCODE];

  // 🚀 초고속 체크 (99%의 경우)
  if (currentEdge !== matchEdge) return;         // 다른 edge
  if (currentBarcode < matchBarcode) return;     // 아직 미도달

  // ✅ 체크포인트 도달! (1%의 경우만 실행)
  handleCheckpoint(vehicleId);
}
```

### 새 VehicleDataArray 필드
```typescript
export const LogicData = {
  ...
  CURRENT_BARCODE: _lPtr++,    // 현재 절대 좌표 (mm)
  MATCH_EDGE: _lPtr++,         // 다음 체크할 edge (1-based)
  MATCH_BARCODE: _lPtr++,      // 다음 체크할 절대 좌표 (mm)
  MATCH_TYPE: _lPtr++,         // 체크포인트 종류
}
```

### Checkpoint 타입
```typescript
export const CheckpointType = {
  NONE: 0,
  LOCK_REQUEST: 1,     // Lock 요청 지점 (merge 20m 전)
  LOCK_WAIT: 2,        // Lock 대기 지점 (merge 7m 전)
  MERGE_ENTRY: 3,      // Merge 진입 지점
  DESTINATION: 4,      // 최종 목적지
} as const;
```

### 직선 vs 곡선
**직선 (LINEAR):**
- Barcode 기준 체크
- 길이가 김 (10m, 20m, 60m...)
- 특정 지점에서 lock 요청/대기

**곡선 (CURVE):**
- Ratio 기준 체크 (barcode 안 씀)
- 길이가 짧음 (1~3m)
- ratio >= 0.5 (중간 지점)에서 다음 edge 요청

```typescript
if (edge.vos_rail_type === 'LINEAR') {
  // Barcode 체크
  if (currentEdge == matchEdge && currentBarcode >= matchBarcode) {
    handleCheckpoint();
  }
} else {
  // 곡선: Ratio 체크
  if (edgeRatio >= 0.5) {
    requestNextEdgeLock();
  }
}
```

---

## 7. 멈춤 상태 상세 설계

### Movement가 멈추는 케이스

#### 1️⃣ MOVING_STATUS 체크 (shouldSkipUpdate)
```typescript
if (status === MovingStatus.PAUSED) {
  return true;  // Movement 스킵
}
if (status === MovingStatus.STOPPED) {
  velocity = 0;
  return true;  // Movement 스킵
}
```

#### 2️⃣ 센서 충돌 (processEmergencyStop)
```typescript
// hitZone === 2 (긴급 정지)
velocity = 0;
STOP_REASON |= SENSORED;
// MOVING_STATUS는 MOVING 유지!
```
**의미**: "움직이고 싶지만 물리적으로 막힘" → 장애물 없어지면 즉시 출발

#### 3️⃣ TARGET_RATIO 도달 (processSameEdgeLogic)
```typescript
if (ratio >= targetRatio) {
  MOVING_STATUS = STOPPED;
  velocity = 0;
}
```

### 멈춤 상태 비교

| 상황 | MOVING_STATUS | VELOCITY | STOP_REASON | 의미 |
|------|---------------|----------|-------------|------|
| **시작 전** | STOPPED | 0 | IDLE | 명령 대기 |
| **일반 정지** | STOPPED | 0 | IDLE | 도착, 명령 대기 |
| **Lock 대기** | STOPPED | 0 | LOCKED | Wait point 도착, grant 대기 |
| **센서 충돌** ⭐ | MOVING | 0 | SENSORED | 장애물 감지, 일시 정지 |

### Lock 대기 조건
```typescript
// TARGET_RATIO 도달 + 특수 조건
if (reached && isLockRequested && !isGranted && atWaitPoint) {
  MOVING_STATUS = STOPPED;
  STOP_REASON |= LOCKED;
} else {
  MOVING_STATUS = STOPPED;
  STOP_REASON = IDLE;
}
```

---

## 8. processLock() 상세 설계

### 전체 구조
```typescript
processLock(vehicleId, policy) {
  const currentEdge = data[ptr + MovementData.CURRENT_EDGE];
  const edge = edges[currentEdge - 1];

  if (edge.vos_rail_type === 'LINEAR') {
    // 직선: Barcode 기준 체크
    processLinearEdgeLock(vehicleId);
  } else {
    // 곡선: Ratio 기준 체크
    processCurveEdgeLock(vehicleId);
  }
}
```

### 직선 Edge Lock 처리
```typescript
processLinearEdgeLock(vehicleId) {
  const currentBarcode = data[ptr + LogicData.CURRENT_BARCODE];
  const matchEdge = data[ptr + LogicData.MATCH_EDGE];
  const matchBarcode = data[ptr + LogicData.MATCH_BARCODE];
  const matchType = data[ptr + LogicData.MATCH_TYPE];

  // 🚀 초고속 체크
  if (currentEdge !== matchEdge) return;
  if (currentBarcode < matchBarcode) return;

  // ✅ 체크포인트 도달!
  switch (matchType) {
    case CheckpointType.LOCK_REQUEST:
      handleLockRequest(vehicleId);
      break;
    case CheckpointType.LOCK_WAIT:
      handleLockWait(vehicleId);
      break;
    case CheckpointType.MERGE_ENTRY:
      handleMergeEntry(vehicleId);
      break;
  }
}
```

### Lock 요청 지점
```typescript
handleLockRequest(vehicleId) {
  requestLock(nodeName, vehicleId);

  if (checkGrant(nodeName, vehicleId)) {
    // Lock 받음 → merge 통과
    fillNextEdgesThroughMerge(vehicleId);
    setNextCheckpoint(CheckpointType.MERGE_ENTRY, ...);
  } else {
    // Lock 못 받음 → wait point까지만
    const waitBarcode = calculateWaitPointBarcode();
    fillNextEdgesUntilWaitPoint(vehicleId, waitBarcode);
    data[ptr + MovementData.TARGET_RATIO] = waitRatio;
    setNextCheckpoint(CheckpointType.LOCK_WAIT, waitBarcode);
  }
}
```

### Lock 대기 지점
```typescript
handleLockWait(vehicleId) {
  const velocity = data[ptr + MovementData.VELOCITY];

  // Wait point에서 실제로 멈췄는지 확인
  if (velocity == 0) {
    data[ptr + LogicData.STOP_REASON] |= StopReason.LOCKED;
  }

  // 매 프레임 grant 재확인
  if (checkGrant(nodeName, vehicleId)) {
    // Lock 받음!
    data[ptr + LogicData.STOP_REASON] &= ~StopReason.LOCKED;
    data[ptr + MovementData.MOVING_STATUS] = MovingStatus.MOVING;
    fillNextEdgesThroughMerge(vehicleId);
    setNextCheckpoint(CheckpointType.MERGE_ENTRY, ...);
  }
}
```

### Merge 진입 지점
```typescript
handleMergeEntry(vehicleId) {
  // Lock release
  releaseLock(nodeName, vehicleId);

  // Queue 다음 차량에 grant
  grantNextVehicleInQueue(nodeName);

  // 다음 체크포인트 계산
  calculateNextCheckpoint(vehicleId);
}
```

---

## 9. TODO (다음 단계)

### 9.1 Constants 업데이트
- [ ] `CURRENT_BARCODE`, `MATCH_EDGE`, `MATCH_BARCODE`, `MATCH_TYPE` 필드 추가
- [ ] `CheckpointType` enum 추가
- [ ] `StopReason.SENSORED`, `StopReason.IDLE` 추가

### 9.2 LockMgr 구현
- [ ] `processLock()` 메인 로직
- [ ] `handleLockRequest()` - Lock 요청 지점
- [ ] `handleLockWait()` - Lock 대기 지점
- [ ] `handleMergeEntry()` - Merge 진입 지점
- [ ] Barcode 업데이트 로직 (Movement에서)

### 9.3 다른 파일 수정
- [ ] `TransferMgr.ts`: fillNextEdgesFromPathBuffer() 제거
- [ ] `edgeTransition.ts`: shiftAndRefillNextEdges()에서 NEXT_EDGE 채우는 부분 제거
- [ ] `AutoMgr.ts`: assignCommand() 호출 시 NEXT_EDGE 채우는 부분 제거

### 9.4 TransferMgr 유용한 함수 (재사용)
- `findDistanceToNextMerge()` - merge까지 거리 계산
- `getFullReservedPath()` - pathBuffer에서 전체 경로 조회

---

## 10. 파일 위치

| 파일 | 역할 |
|------|------|
| `src/common/vehicle/logic/LockMgr.ts` | 락 시스템 메인 |
| `src/common/vehicle/logic/TransferMgr.ts` | pathBuffer 관리, 경로 조회 |
| `src/common/vehicle/movement/edgeTransition.ts` | edge 전환 처리 |
| `src/common/vehicle/movement/movementUpdate.ts` | Movement 메인, shouldSkipUpdate |
| `src/common/vehicle/movement/vehiclePhysics.ts` | 센서 충돌, processEmergencyStop |
| `src/common/vehicle/movement/vehicleTransition.ts` | TARGET_RATIO 도달 체크 |
| `src/common/vehicle/initialize/constants.ts` | STOP_REASON, CheckpointType 정의 |
| `src/common/vehicle/logic/AutoMgr.ts` | 자동 경로 설정 (Dijkstra) |
| `src/shmSimulator/core/FabContext.ts` | step() 메인 루프 |
| `public/railConfig/cop/node.map` | Node barcode 정의 |
| `public/railConfig/cop/edge.map` | Edge 정보 |
| `.ai-agents/lock_agents.md` | 이 문서 |

---

## 11. 핵심 개념 요약

### Lock이 Movement를 멈추는 방법
1. **Lock 요청은 멀리서** (merge 20m 전)
2. **Grant 못 받으면 TARGET_RATIO를 wait point로 설정**
3. **Movement가 wait point까지 이동**
4. **Wait point 도달 → MOVING_STATUS = STOPPED, STOP_REASON = LOCKED**

### Barcode 시스템
- **절대 좌표** (mm 단위)
- **Edge 기준 체크 필수** (합류 시 barcode 급증/급감)
- **직선은 barcode, 곡선은 ratio**

### 성능 최적화
- **Checkpoint 시스템**: 매 프레임 단순 비교만
- **도달 시에만 복잡한 로직 실행**

### 멈춤 상태
| 상태 | MOVING_STATUS | VELOCITY | STOP_REASON | 복구 방법 |
|------|---------------|----------|-------------|-----------|
| Lock 대기 | STOPPED | 0 | LOCKED | processLock에서 grant 받으면 MOVING으로 |
| 센서 충돌 | MOVING | 0 | SENSORED | 장애물 없어지면 자동 복구 |
| 일반 정지 | STOPPED | 0 | IDLE | 외부 명령 필요 |

---

## 12. 최종 설계: Checkpoint 시스템 (2026-02-06)

### 12.1 핵심 아이디어

**AutoMgr에서 pathBuffer 설정 시점 = Checkpoint 리스트 미리 생성**

출발지 → 목적지 경로가 결정되는 순간, 전체 여정의 모든 checkpoint를 한 번에 계산하여 배열로 저장.

```
출발 → NODE_A → NODE_B(merge) → NODE_C → ... → 목적지

이 경로가 정해지면:
checkpoints = [
  {edge: 3, ratio: 0.5, flags: MOVE_PREPARE},           // 곡선 준비
  {edge: 5, ratio: 0.6, flags: LOCK_REQUEST},           // Lock 요청
  {edge: 5, ratio: 0.85, flags: LOCK_WAIT},             // Lock 대기
  {edge: 6, ratio: 0.2, flags: LOCK_RELEASE},           // Lock 해제
  {edge: 12, ratio: 0.7, flags: LOCK_REQUEST},          // 다음 merge
  {edge: 12, ratio: 0.9, flags: LOCK_WAIT},             // Lock 대기
  {edge: 13, ratio: 0.25, flags: LOCK_RELEASE},         // Lock 해제
]
```

### 12.2 Checkpoint 구조

**최소 구조: edge + ratio + flags (type 불필요!)**

```typescript
interface Checkpoint {
  edge: number;   // Edge ID (1-based)
  ratio: number;  // Progress on edge (0.0 ~ 1.0)
  flags: number;  // CheckpointFlags bitmask
}
```

**왜 type이 필요 없는가?**
- Flags가 bitmask이므로 여러 작업을 동시에 표현 가능
- 같은 지점에서 Lock Release + Lock Request 가능

### 12.3 CheckpointFlags (Bitmask)

```typescript
export const CheckpointFlags = {
  NONE: 0,
  LOCK_REQUEST: 1 << 0,  // 0x01 - Request lock at merge point
  LOCK_WAIT: 1 << 1,     // 0x02 - Wait for lock grant
  LOCK_RELEASE: 1 << 2,  // 0x04 - Release lock after passing merge
  MOVE_PREPARE: 1 << 3,  // 0x08 - Prepare next edge (curves)
  MOVE_SLOW: 1 << 4,     // 0x10 - Deceleration zone
} as const;
```

**동시 처리 예시:**
```typescript
// Edge가 짧아서 Release와 Request가 같은 지점!
{edge: 6, ratio: 0.5, flags: LOCK_RELEASE | LOCK_REQUEST}  // 0x05
```

### 12.4 Lock Checkpoint 3단계

**각 Merge마다 3개 checkpoint:**

1. **LOCK_REQUEST** - Merge 전 충분한 거리 (20m 전)
2. **LOCK_WAIT** - Merge 직전 대기 지점 (7m 전)
3. **LOCK_RELEASE** - Merge 통과 후 안전 지점 (다음 edge 20% 지점)

```typescript
// Merge A
{edge: 5, ratio: 0.60, flags: LOCK_REQUEST},   // Request
{edge: 5, ratio: 0.85, flags: LOCK_WAIT},      // Wait
{edge: 6, ratio: 0.20, flags: LOCK_RELEASE},   // Release

// Merge B
{edge: 12, ratio: 0.70, flags: LOCK_REQUEST},
{edge: 12, ratio: 0.90, flags: LOCK_WAIT},
{edge: 13, ratio: 0.25, flags: LOCK_RELEASE},
```

### 12.5 배열 통일: 1-based Standard

**모든 배열을 통일된 방식으로:**

```typescript
array[0] = 길이 또는 메타 정보
array[1] = vehicle 1
array[2] = vehicle 2
...
array[vehicleId] = vehicle vehicleId
```

**이유:**
- Edge, Node가 이미 1-based
- vehicleId도 1부터 시작
- 일관성 & 직관성

### 12.6 Checkpoint 배열 구조

**2D 구조, 고정 크기로 미리 할당:**

```typescript
// Constants
MAX_CHECKPOINTS_PER_VEHICLE = 50;  // Vehicle당 최대 checkpoint 수
CHECKPOINT_FIELDS = 3;  // edge, ratio, flags
CHECKPOINT_SECTION_SIZE = 1 + MAX_CHECKPOINTS_PER_VEHICLE * CHECKPOINT_FIELDS;

// 배열 구조
checkpointArray = Float32Array[
  MAX_CHECKPOINTS_PER_VEHICLE,  // [0] 메타: 최대 크기

  // Vehicle 1 section (offset: 1)
  v1_count,       // 실제 checkpoint 개수
  v1_cp0_edge,    // Checkpoint 0
  v1_cp0_ratio,
  v1_cp0_flags,
  v1_cp1_edge,    // Checkpoint 1
  v1_cp1_ratio,
  v1_cp1_flags,
  ...

  // Vehicle 2 section (offset: 1 + CHECKPOINT_SECTION_SIZE)
  v2_count,
  v2_cp0_edge,
  ...
]
```

**접근 방식:**
```typescript
// Offset 계산
const vehicleOffset = 1 + vehicleId * CHECKPOINT_SECTION_SIZE;
const count = checkpointArray[vehicleOffset];
const cpOffset = vehicleOffset + 1 + cpIdx * CHECKPOINT_FIELDS;

// 읽기
const edge = checkpointArray[cpOffset + 0];
const ratio = checkpointArray[cpOffset + 1];
const flags = checkpointArray[cpOffset + 2];

// 쓰기 (AutoMgr에서)
checkpointArray[vehicleOffset] = totalCheckpoints;  // count
checkpointArray[cpOffset + 0] = edge;
checkpointArray[cpOffset + 1] = ratio;
checkpointArray[cpOffset + 2] = flags;
```

### 12.7 VehicleDataArray 변경

**제거된 필드 (4개):**
- ~~CURRENT_BARCODE~~
- ~~MATCH_EDGE~~
- ~~MATCH_BARCODE~~
- ~~MATCH_TYPE~~

**추가된 필드 (1개):**
- `CHECKPOINT_HEAD` (offset 22): 현재 처리 중인 checkpoint 인덱스

**메모리 절약:**
- 26 fields (104 bytes) → 23 fields (92 bytes)

### 12.8 processCheckpoint() 로직

```typescript
processCheckpoint(vehicleId) {
  const vehicleOffset = 1 + vehicleId * CHECKPOINT_SECTION_SIZE;
  const count = checkpointArray[vehicleOffset];
  const head = data[ptr + LogicData.CHECKPOINT_HEAD];

  // 끝 확인
  if (head >= count) return;

  // 다음 checkpoint 읽기
  const cpOffset = vehicleOffset + 1 + head * CHECKPOINT_FIELDS;
  const cpEdge = checkpointArray[cpOffset + 0];
  const cpRatio = checkpointArray[cpOffset + 1];
  const cpFlags = checkpointArray[cpOffset + 2];

  // 🚀 초고속 체크
  const currentEdge = data[ptr + MovementData.CURRENT_EDGE];
  const currentRatio = data[ptr + MovementData.EDGE_RATIO];

  if (currentEdge !== cpEdge) return;
  if (currentRatio < cpRatio) return;

  // ✅ Checkpoint 도달! Flags 처리
  if (cpFlags & CheckpointFlags.LOCK_RELEASE) {
    releaseLock(prevMergeNode, vehicleId);
    grantNextInQueue(prevMergeNode);
  }

  if (cpFlags & CheckpointFlags.LOCK_REQUEST) {
    requestLock(nextMergeNode, vehicleId);
    if (isGranted()) {
      // Grant 받음 → 계속 진행
    } else {
      // 못 받음 → Wait point에서 정지 설정
      setTargetRatio(waitRatio);
    }
  }

  if (cpFlags & CheckpointFlags.LOCK_WAIT) {
    if (!isGranted()) {
      // 아직 grant 안 받음 → 멈춤 유지
      if (velocity === 0) {
        data[ptr + LogicData.STOP_REASON] |= StopReason.LOCKED;
      }
    } else {
      // Grant 받음! → 출발
      data[ptr + LogicData.STOP_REASON] &= ~StopReason.LOCKED;
      data[ptr + MovementData.MOVING_STATUS] = MovingStatus.MOVING;
    }
  }

  if (cpFlags & CheckpointFlags.MOVE_PREPARE) {
    prepareNextEdge(vehicleId);
  }

  // 다음 checkpoint로
  data[ptr + LogicData.CHECKPOINT_HEAD]++;
}
```

### 12.9 AutoMgr 연동

**assignCommand() 시점에 checkpoint 생성:**

```typescript
assignCommand(vehicleId, destination) {
  // 1. Dijkstra로 경로 계산
  const path = dijkstra(current, destination);

  // 2. pathBuffer에 저장
  fillPathBuffer(vehicleId, path);

  // 3. 🆕 Checkpoint 리스트 생성
  const checkpoints: Checkpoint[] = [];

  for (let i = 0; i < path.length; i++) {
    const edge = edges[path[i] - 1];

    // Merge 발견 → Lock checkpoints 추가
    if (isMergeEdge(edge)) {
      const requestRatio = calculateRatioFromDistance(edge, -20000);  // 20m 전
      const waitRatio = calculateRatioFromDistance(edge, -7000);      // 7m 전

      checkpoints.push({edge: edge.id, ratio: requestRatio, flags: CheckpointFlags.LOCK_REQUEST});
      checkpoints.push({edge: edge.id, ratio: waitRatio, flags: CheckpointFlags.LOCK_WAIT});

      // Release는 다음 edge
      const nextEdge = edges[path[i + 1] - 1];
      checkpoints.push({edge: nextEdge.id, ratio: 0.2, flags: CheckpointFlags.LOCK_RELEASE});
    }

    // 곡선 발견 → Move checkpoint 추가
    if (edge.vos_rail_type === 'CURVE') {
      checkpoints.push({edge: edge.id, ratio: 0.5, flags: CheckpointFlags.MOVE_PREPARE});
    }
  }

  // 4. Checkpoint 배열에 저장
  saveCheckpoints(vehicleId, checkpoints);

  // 5. CHECKPOINT_HEAD 초기화
  data[ptr + LogicData.CHECKPOINT_HEAD] = 0;
}
```

### 12.10 완료된 작업

**✅ Constants 업데이트 (2026-02-06):**
- VehicleDataArray: 23 fields (92 bytes)
- LogicData.CHECKPOINT_HEAD 추가
- CheckpointFlags enum 추가
- Checkpoint interface 정의
- StopReason.IDLE 추가

**파일:** `src/common/vehicle/initialize/constants.ts`

**✅ Checkpoint 모듈 구현 (2026-02-07):**
- `src/common/vehicle/logic/checkpoint/` 폴더 생성
- builder.ts, types.ts, utils.ts, index.ts

**핵심 함수:**

| 함수 | 역할 |
|------|------|
| `isStartFromMergeNode(edge)` | edge.from_node가 merge인지 확인 |
| `findRequestPoint(targetPathIdx, ...)` | Request Point 위치 찾기 (5100mm 전) |
| `findWaitPoint(targetPathIdx, ...)` | Wait Point 위치 찾기 (waiting_offset 전) |
| `buildCheckpoints(ctx, opts)` | 전체 경로에 대해 checkpoint 생성 |

**Request Point (LOCK_REQUEST + MOVE_PREPARE):**
- merge에서 5100mm (5.1m) 전
- 역순 탐색하며 거리 누적
- 곡선 만나면 → ratio 0.5 (곡선 중간)
- 직선에서 5100mm 도달 → 해당 위치

**Wait Point (LOCK_WAIT):**
- merge에서 waiting_offset (예: 1890mm) 전
- 역순 탐색하며 거리 누적
- 곡선 만나면 → ratio 0 (곡선의 fn에서 대기)
- 직선에서 waiting_offset 도달 → 해당 위치

**1-based / 0-based 정리:**
- 입력 `edgeIndices`: 1-based edge ID 배열
- 입력 `edgeArray`: 0-based 원본 배열
- 내부에서 `toOneBasedArray()`로 변환하여 1-based 접근
- 출력 `Checkpoint.edge`: 1-based edge ID

**✅ Checkpoint 테스트 완료 (2026-02-07):**
- `builder.test.ts` 단순화 및 검증 로직 정리
- y_short 맵 기반 테스트 (874 edges, 4349 stations, 216 merge nodes)

**테스트 검증 항목:**
1. 모든 checkpoint의 edge가 path에 있는지 (유효성)
2. 경로 내 2번째 edge부터 각 edge에 대해:
   - `MOVE_PREPARE` checkpoint 존재 여부
   - merge node면 `LOCK_REQUEST` checkpoint 존재 여부
   - incomingEdge가 곡선이거나 waiting_offset 있으면 `LOCK_WAIT` 존재 여부

**테스트 결과:**
| 테스트 | 결과 |
|--------|------|
| 단일 경로 검증 | ✅ 통과 |
| 100개 랜덤 경로 | ✅ 97/97 통과 |
| 500개 스트레스 테스트 | ✅ 497/497 통과 |

**✅ Constants 확장 (2026-02-07):**
- VehicleDataArray: **30 fields (120 bytes)**
- 새 필드 추가:
  - `LogicData.CURRENT_CP_EDGE` (27): 현재 checkpoint edge (1-based, 0=none)
  - `LogicData.CURRENT_CP_RATIO` (28): 현재 checkpoint ratio (0.0~1.0)
  - `LogicData.CURRENT_CP_FLAGS` (29): 현재 checkpoint flags (mutable)

**✅ LockMgr.processCheckpoint() 새 설계 구현 (2026-02-07):**
- VehicleDataArray의 CURRENT_CP_* 필드 사용
- 각 flag 개별 처리 후 해당 flag 제거
- flags == 0이면 다음 checkpoint 로드 (loadNextCheckpoint)

**✅ TransferMgr 함수 정리 (2026-02-07):**

| 기존 함수명 | 새 함수명 | 역할 변경 |
|-------------|-----------|-----------|
| `fillNextEdgesFromPathBuffer` | `initNextEdgesForStart` | 경로 시작 시 첫 checkpoint까지만 NEXT_EDGE 채움 |
| `shiftAndRefillNextEdges` | `shiftNextEdges` | edge 전환 시 shift만 (refill 제거) |

**✅ LockMgr.handleMovePrepare() 구현 (2026-02-07):**
- 다음 checkpoint까지 NEXT_EDGE 채우기
- pathBuffer에서 targetEdge까지만 채움
- NEXT_EDGE_STATE 설정

**✅ TransferMgr.saveCheckpoints() 수정 (2026-02-07):**
- 첫 번째 checkpoint를 CURRENT_CP_*에 로드
- CHECKPOINT_HEAD = 1 (다음에 로드할 인덱스)

### 12.11 NEXT_EDGE 관리 흐름

**targetRatio 동작 원리:**
```
NEXT_EDGE가 없으면 → 현재 edge의 targetRatio까지
NEXT_EDGE가 있으면 → 마지막 edge의 targetRatio까지 (중간은 1.0)

예시: curNode + nextN0 + nextN1, targetRatio=0.7
  → curNode: 1.0까지 쭉
  → nextN0: 1.0까지 쭉
  → nextN1: 0.7까지
```

**Lock 제어 방식:**
```
Lock 못 받음:
  → NEXT_EDGE를 wait point edge까지만 채움
  → targetRatio = waitRatio
  → 차량이 wait point에서 멈춤

Lock 받음:
  → NEXT_EDGE 더 채움 (다음 구간까지)
  → targetRatio = 1.0
```

**여러 merge 연속 처리:**
```
1. A wait point까지 → 멈춤, Lock A 요청
2. Lock A 받음 → B wait point까지 NEXT_EDGE 채움
3. B wait point 도달 → 멈춤, Lock B 요청
4. Lock B 받음 → C wait point까지 NEXT_EDGE 채움
5. ...반복 (한 번에 하나의 merge만 처리)
```

### 12.12 디버그 로그 추가 (2026-02-08)

**LockMgr.ts에 devLog 추가:**

| 태그 | 위치 | 확인 내용 |
|------|------|-----------|
| `[processLock] SKIP` | processLock 진입 | checkpointArray/dataArray null 여부 |
| `[processCP] cpEdge=0` | processCheckpoint | CP 비어서 로드 시도 |
| `[processCP] SKIP edge mismatch` | 초고속 체크 | curE !== cpE로 스킵 |
| `[processCP] SKIP ratio` | 초고속 체크 | curR < cpR로 스킵 |
| `[processCP] HIT!` | checkpoint 도달 | 도달한 CP 상세 |
| `[processCP] flags=0` | 플래그 소진 | 다음 CP 로드 시점 |
| `[loadNextCP] END` | loadNextCheckpoint | 모든 CP 소진 |
| `[loadNextCP] head→` | loadNextCheckpoint | 로드된 CP 내용 + 현재 위치 |
| `[MOVE_PREP]` | handleMovePrepare | pathBuffer 상태, targetEdge, 채워진 NEXT_EDGE |

**발견된 이슈 (추정):**
- E0018 stuck: edge 전환 후 ratio>0으로 시작하는데, CP가 ratio=0.000
- processCheckpoint가 해당 CP를 처리 못하는 원인 확인 필요
- 가능성 1: processCheckpoint 호출 자체 안 됨 (init 문제)
- 가능성 2: CP가 이전 edge에 걸려있어 edge mismatch로 skip

### 12.13 버그 수정 기록 (2026-02-08)

#### Bug #1: 곡선 합류 시 LOCK_REQUEST가 곡선 위에 생김 (veh:17 stuck)

**증상:** veh:17이 E_24@0.002에서 LOCK_WAIT BLOCKED 상태로 멈춤. N_20 lock을 veh:5가 영구 보유.

**원인:**
```
경로: ... → E_22(직선) → E_24(곡선) → E_26(target, fn=N_20 merge)

findRequestPoint()가 곡선 E_24를 만나면 → E_24@0.5 반환
→ LOCK_REQUEST + MOVE_PREPARE 모두 E_24@0.5에 배치

그런데 LOCK_WAIT는 곡선 fn에서 대기 → E_24@0.0

정렬 결과: WAIT@0.0 → REQ@0.5
→ 차량이 WAIT를 먼저 만남 (아직 REQ 안 했으니 lock 없음 → PASS)
→ REQ에서 요청하지만 이미 WAIT 지점 지남 → 대기 불가
```

**핵심 개념:**
- MOVE_PREPARE (다음 edge 진행 준비) ≠ LOCK_REQUEST (merge lock 요청)
- 곡선 합류 시 이 둘은 **분리**되어야 함
  - MOVE_PREPARE: 곡선@0.5 (다음 edge 데이터 준비)
  - LOCK_REQUEST: 곡선의 fn 1m 전 (직전 직선 edge에서)

**수정 (builder.ts):**
- `findLockRequestBeforeCurve()` 함수 추가
- 곡선 합류 시: incoming 곡선을 건너뛰고, 직전 직선 edge에서 1m 전 지점에 LOCK_REQUEST 배치
- MOVE_PREPARE와 LOCK_REQUEST를 별도 checkpoint로 생성

```
수정 후:
E_22@0.xxx [REQ] → E_24@0.0 [WAIT] → E_24@0.5 [PREP]
```

---

#### Bug #2: Checkpoint 정렬이 edge 간 순서를 보장 못함 (veh:9 stuck)

**증상:** veh:9가 E_44에서 stuck. nextEdges=[0,0,0,0,0], pathBuf len=10.

**원인:**
- Bug #1 수정 후, LOCK_REQUEST(E_40)가 MOVE_PREPARE(E_42) 뒤에 push됨
- `sortCheckpointsByRatioWithinEdge()`는 같은 edge의 연속 CP만 정렬
- 다른 edge에 있는 CP의 순서는 보장하지 않음
- 결과: head=3에서 E_40@0.500[REQ]를 만나지만 차량은 이미 E_42 → edge mismatch → 영구 skip

**수정 (utils.ts):**
- `sortCheckpointsByPathOrder()` 함수 추가
- 1차 정렬: edge의 경로 내 위치 (path에서 먼저 나오는 edge가 앞)
- 2차 정렬: 같은 edge 내에서 ratio 오름차순
- builder.ts에서 기존 `sortCheckpointsByRatioWithinEdge` → `sortCheckpointsByPathOrder` 교체

---

#### Bug #3: 직선 합류 시 LOCK_WAIT 누락 (veh:36 stuck)

**증상:** veh:36이 E_51@0.004에서 LOCK_WAIT BLOCKED. veh:35가 N_41 lock 영구 보유.

**원인:**
- veh:35의 checkpoint: `E53@0.667[REQ|PREP]→E54` — LOCK_WAIT 없음!
- incoming edge E_52의 `waiting_offset`이 undefined
- 기존 코드: `if (waitingOffset > 0)` → undefined면 WAIT 생성 skip
- WAIT 없이 merge 통과 → auto-release가 lock 보유 전에 도달

**수정 (builder.ts):**
```typescript
const DEFAULT_WAITING_OFFSET = 1.89;
const waitingOffset = incomingEdge.waiting_offset ?? DEFAULT_WAITING_OFFSET;
```
- waiting_offset이 없으면 기본 1.89m 사용
- merge node면 항상 LOCK_WAIT 생성

---

#### Bug #4: Auto-release가 lock 미보유 상태에서도 grantNext 호출

**증상:** 모든 stuck 사례의 공통 원인 — lock 영구 보유

**원인:**
```
1. veh:A가 merge 접근 → requestLock(N_X)
2. lock은 이미 veh:B가 보유 → veh:A 큐에 들어감
3. WAIT 없이/WAIT 지나치고 merge 진입
4. auto-release 발동: releaseEdge 도달
5. releaseLockInternal(N_X, veh:A) → veh:A가 holder 아님 → no-op
6. grantNextInQueue(N_X) → 큐의 다음 차량(veh:A 자신)에 grant!
7. veh:A가 grant 받음 → 이미 지나갔으므로 release 안 함 → 영구 보유
```

**수정 (LockMgr.ts):**
```typescript
// checkAutoRelease에서:
if (holder === vehId) {
  // 정상: lock 보유 중 → release + grantNext
  this.releaseLockInternal(info.nodeName, vehId);
  this.grantNextInQueue(info.nodeName);
} else {
  // 비정상: lock 안 잡고 있음 → 큐에서만 제거
  this.cancelFromQueue(info.nodeName, vehId);
}
```
- `cancelFromQueue()` 메서드 추가: 큐에서 해당 vehId만 제거

---

### 12.14 수정된 파일 요약 (2026-02-08)

| 파일 | 변경 | 관련 버그 |
|------|------|-----------|
| `checkpoint/builder.ts` | `findLockRequestBeforeCurve()` 추가, 곡선 합류 시 REQ/PREP 분리, 기본 waiting_offset | #1, #3 |
| `checkpoint/utils.ts` | `sortCheckpointsByPathOrder()` 추가 | #2 |
| `LockMgr.ts` | `checkAutoRelease()` holder 체크, `cancelFromQueue()` 추가, `pendingReleases` 맵, `eName()` 헬퍼 | #4 |
| `LockMgr.ts` | LOCK_REQUEST: `targetEdge.from_node`으로 merge 판단 (기존 `to_node` 제거) | 전체 |
| `LockMgr.ts` | LOCK_WAIT: `holder !== vehId` 체크로 BLOCKED 판단 | 전체 |
| `LockMgr.ts` | 디버그 로그에 `eName()` 적용 (E_29 형태로 출력) | 가독성 |

### 12.15 핵심 개념 정리

#### Checkpoint 구조 (수정 후)
```
Checkpoint = { edge, ratio, flags, targetEdge }
```
- `targetEdge`: builder가 설정. 이 checkpoint가 "누구를 위한" 건지 표시
  - MOVE_PREPARE의 targetEdge = 다음 이동할 edge
  - LOCK_REQUEST의 targetEdge = merge node에서 나가는 edge
  - LOCK_WAIT의 targetEdge = merge node에서 나가는 edge

#### Merge Node 판단
```
targetEdge.from_node = merge node
(기존에 nextEdge.to_node을 사용했던 것은 잘못됨)
```

#### 곡선 합류 vs 직선 합류

| | 곡선 합류 | 직선 합류 |
|---|---|---|
| incoming edge | 곡선 (CURVE) | 직선 (LINEAR) |
| LOCK_REQUEST 위치 | 곡선 fn 1m 전 (직전 직선) | MOVE_PREPARE와 합쳐서 (REQ\|PREP) |
| LOCK_WAIT 위치 | 곡선 fn (ratio 0) | waiting_offset 전 (기본 1.89m) |
| MOVE_PREPARE 위치 | 곡선@0.5 | 5.1m 전 (역순 탐색) |

#### Auto-release 흐름
```
LOCK_REQUEST → pendingReleases에 등록 { nodeName, releaseEdgeIdx=targetEdge }
↓
매 프레임 checkAutoRelease():
  currentEdge === releaseEdgeIdx?
    → holder === vehId → release + grantNext (정상)
    → holder !== vehId → cancelFromQueue (비정상, 큐에서 제거만)
```

### 12.16 다음 작업 (우선순위)

1. **실제 동작 테스트 (진행 중)**
   - [x] 단일 차량 경로 이동 테스트
   - [x] merge 통과 테스트 (곡선/직선)
   - [ ] 여러 차량 lock 경쟁 테스트 (진행 중 - 반복 분석)

2. **FabContext에서 LockMgr.init() 호출 시 pathBuffer 전달**
   - [ ] pathBuffer 파라미터 추가된 init() 호출

3. **LOCK_REQUEST/LOCK_WAIT에서 TARGET_RATIO 설정**
   - [ ] grant 못 받으면 wait point의 ratio로 TARGET_RATIO 설정
   - [ ] grant 받으면 TARGET_RATIO = 1.0

### 12.17 성능 이점

**기존 설계 (매 프레임 복잡한 계산):**
- 10만 대 × 60fps = 600만 번/초
- pathBuffer 탐색, merge 찾기, 거리 계산...

**새 설계 (단순 비교 2개):**
- currentEdge === cpEdge? ✓
- currentRatio >= cpRatio? ✓
- **99%의 경우 여기서 끝!**
- Checkpoint 도달 시에만 복잡한 로직 실행 (1%)

**예상 성능 향상: 100배 이상**

---

## 13. Ratio 정수 변환 (성능 최적화 - 우선순위 낮음)

### 13.1 개요

Checkpoint ratio를 정수로 저장/비교하여 부동소수점 오차 제거 및 성능 향상.

### 13.2 설계

**정밀도: 소수 4자리 (0.0001 단위)**
```
0.8567 → 8567 (정수)
0.1234 → 1234
1.0000 → 10000
```

**범위: 0 ~ 10000**
- 0.0001 = 0.01% 정밀도 (충분함)
- Float32에 정확히 저장 가능

### 13.3 구현 방침

| 항목 | 타입 | 이유 |
|------|------|------|
| `VehicleDataArray.EDGE_RATIO` | **Float (0.0~1.0)** | Movement 계산 자연스러움 |
| `Checkpoint.ratio` | **Int (0~10000)** | 정확한 비교, 오차 제거 |
| 변환 시점 | **비교 시에만** | 오버헤드 최소 |

### 13.4 구현 위치

#### LockMgr.processCheckpoint (비교 시)
```typescript
private processCheckpoint(vehicleId: number): void {
  const cpRatioInt = this.checkpointArray[cpOffset + 1];  // 0~10000 정수

  const currentRatio = data[ptr + MovementData.EDGE_RATIO];  // Float: 0.8567
  const currentRatioInt = Math.round(currentRatio * 10000);  // Int: 8567

  if (currentEdge !== cpEdge) return;
  if (currentRatioInt < cpRatioInt) return;  // 정수 비교!

  // ✅ Checkpoint 도달!
}
```

#### TransferMgr.saveCheckpoints (저장 시)
```typescript
private saveCheckpoints(...) {
  for (let i = 0; i < count; i++) {
    const cpOffset = vehicleOffset + 1 + i * CHECKPOINT_FIELDS;
    this.checkpointBuffer[cpOffset + 0] = checkpoints[i].edge;
    this.checkpointBuffer[cpOffset + 1] = Math.round(checkpoints[i].ratio * 10000);  // 정수 변환
    this.checkpointBuffer[cpOffset + 2] = checkpoints[i].flags;
  }
}
```

#### TransferMgr.buildCheckpoints (생성 시)
```typescript
// ratio는 Float 그대로 전달 (저장 시 변환됨)
checkpoints.push({
  edge: edgeIdx,
  ratio: 0.8567,  // Float
  flags: CheckpointFlags.LOCK_REQUEST,
});
```

### 13.5 Interface 주석 업데이트

```typescript
export interface Checkpoint {
  edge: number;   // Edge ID (1-based)
  ratio: number;  // 0~10000 정수 (소수 4자리를 10000배)
  flags: number;  // CheckpointFlags bitmask
}
```

### 13.6 장점

1. **부동소수점 오차 제거**
   - `0.84999999 < 0.85` 같은 문제 없음
   - 정확한 지점 비교 가능

2. **성능 향상**
   - 정수 비교가 부동소수점보다 빠름
   - CPU 파이프라인 최적화

3. **디버깅 편의성**
   - "ratio 8567 지점" 같은 명확한 표현
   - 로그 가독성 향상

4. **코드 변경 최소**
   - VehicleDataArray는 Float 유지
   - Movement 코드 수정 불필요

### 13.7 적용 시기

**다음 경우에 적용:**
- Checkpoint 시스템 기본 동작 확인 후
- 부동소수점 오차 문제 발견 시
- 성능 프로파일링에서 비교 연산이 병목으로 확인될 때

**현재는 필요 없음:**
- Float 비교로도 99% 정상 동작
- 우선순위: Checkpoint 시스템 실제 동작 테스트

---
