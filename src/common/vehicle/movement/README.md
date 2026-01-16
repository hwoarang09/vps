# Vehicle Movement System - 차량 이동 시스템

차량의 물리적 이동, Edge 전환, 충돌 감지, Merge Node 제어를 통합 처리하는 핵심 시스템입니다.

## 개념 (왜 이렇게 설계했나)

### 문제: 복잡한 차량 이동 로직

차량 시뮬레이션의 이동 로직은 여러 시스템이 얽혀있습니다.

```
요구사항:
┌─────────────────────────────────────────────────────────────────┐
│ 1. 물리 기반 이동                                                │
│    → 가속/감속, 최대 속도, 커브 속도 제한                        │
│                                                                  │
│ 2. Edge 전환                                                     │
│    → Edge 끝 도달 → 다음 Edge로 자연스럽게 이동                  │
│    → Overflow 거리 보존 (momentum)                               │
│                                                                  │
│ 3. 충돌 감지 및 회피                                             │
│    → 센서로 앞차 감지 → 감속/정지                                │
│                                                                  │
│ 4. Merge Node 제어                                               │
│    → LockMgr 연동, 신호등 대기                                   │
│                                                                  │
│ 5. TransferMgr 연동                                              │
│    → MQTT 명령, Loop, Random, Auto Route                         │
│                                                                  │
│ 6. Zero-GC 성능                                                  │
│    → 60fps에서 수백 대 차량 처리                                 │
│    → 매 프레임 GC 없이 동작                                      │
└─────────────────────────────────────────────────────────────────┘
```

### 해결: Movement System (통합 이동 엔진)

```
Movement System 아키텍처:
┌─────────────────────────────────────────────────────────────────┐
│                    updateMovement()                              │
│                    (메인 루프)                                    │
│                                                                  │
│  ┌───────────────────────────────────────────────────────┐      │
│  │ 1. Transfer Queue 처리                                │      │
│  │    transferMgr.processTransferQueue()                 │      │
│  │    → Edge 끝 도달한 차량의 다음 Edge 결정             │      │
│  └───────────────────────────────────────────────────────┘      │
│                           ↓                                      │
│  ┌───────────────────────────────────────────────────────┐      │
│  │ 2. 차량별 이동 처리 (for loop)                        │      │
│  │                                                        │      │
│  │  ┌─────────────────────────────────────────────────┐  │      │
│  │  │ a. shouldSkipUpdate                             │  │      │
│  │  │    PAUSED/STOPPED 체크                          │  │      │
│  │  └─────────────────────────────────────────────────┘  │      │
│  │                     ↓                                  │      │
│  │  ┌─────────────────────────────────────────────────┐  │      │
│  │  │ b. calculateHitZone                             │  │      │
│  │  │    센서 충돌 감지 (앞차 거리)                   │  │      │
│  │  └─────────────────────────────────────────────────┘  │      │
│  │                     ↓                                  │      │
│  │  ┌─────────────────────────────────────────────────┐  │      │
│  │  │ c. checkAndProcessSensorStop                    │  │      │
│  │  │    HIT_ZONE == 2 → 즉시 정지                    │  │      │
│  │  └─────────────────────────────────────────────────┘  │      │
│  │                     ↓                                  │      │
│  │  ┌─────────────────────────────────────────────────┐  │      │
│  │  │ d. calculateNextSpeed                           │  │      │
│  │  │    velocity + accel - decel                     │  │      │
│  │  │    커브에서 속도 제한 적용                       │  │      │
│  │  └─────────────────────────────────────────────────┘  │      │
│  │                     ↓                                  │      │
│  │  ┌─────────────────────────────────────────────────┐  │      │
│  │  │ e. checkAndTriggerTransfer                      │  │      │
│  │  │    ratio >= 1 → transferQueue에 추가            │  │      │
│  │  └─────────────────────────────────────────────────┘  │      │
│  │                     ↓                                  │      │
│  │  ┌─────────────────────────────────────────────────┐  │      │
│  │  │ f. processEdgeTransitionLogic                   │  │      │
│  │  │    Edge 전환 처리 (handleEdgeTransition)        │  │      │
│  │  │    Overflow 거리 보존                           │  │      │
│  │  └─────────────────────────────────────────────────┘  │      │
│  │                     ↓                                  │      │
│  │  ┌─────────────────────────────────────────────────┐  │      │
│  │  │ g. processSameEdgeLogic                         │  │      │
│  │  │    targetRatio 도달 → 정지                      │  │      │
│  │  └─────────────────────────────────────────────────┘  │      │
│  │                     ↓                                  │      │
│  │  ┌─────────────────────────────────────────────────┐  │      │
│  │  │ h. checkAndReleaseMergeLock                     │  │      │
│  │  │    Edge 전환 시 이전 Merge Lock 해제            │  │      │
│  │  └─────────────────────────────────────────────────┘  │      │
│  │                     ↓                                  │      │
│  │  ┌─────────────────────────────────────────────────┐  │      │
│  │  │ i. interpolatePositionTo                        │  │      │
│  │  │    Edge와 ratio로 3D 좌표 계산                  │  │      │
│  │  └─────────────────────────────────────────────────┘  │      │
│  │                     ↓                                  │      │
│  │  ┌─────────────────────────────────────────────────┐  │      │
│  │  │ j. checkAndProcessMergeWait                     │  │      │
│  │  │    Merge Node 대기 처리 (LockMgr)              │  │      │
│  │  └─────────────────────────────────────────────────┘  │      │
│  │                     ↓                                  │      │
│  │  ┌─────────────────────────────────────────────────┐  │      │
│  │  │ k. updateSensorPoints                           │  │      │
│  │  │    센서 포인트 위치 업데이트                     │  │      │
│  │  └─────────────────────────────────────────────────┘  │      │
│  │                                                        │      │
│  └───────────────────────────────────────────────────────┘      │
│                                                                  │
│  SharedMemory 업데이트:                                          │
│  - VELOCITY, EDGE_RATIO, CURRENT_EDGE                           │
│  - X, Y, Z, ROTATION                                            │
│  - MOVING_STATUS, STOP_REASON                                   │
└─────────────────────────────────────────────────────────────────┘
```

### 핵심 설계 원칙

| 원칙 | 설명 |
|------|------|
| **Zero-GC 디자인** | Scratchpad 재사용, 객체 생성 없음 |
| **상태 머신** | MOVING → STOPPED → MOVING 전환 |
| **물리 기반** | 가속/감속, 최대 속도, 커브 제한 |
| **센서 우선** | 충돌 감지 시 즉시 감속/정지 |
| **Merge 대기** | LockMgr 신호등에 따라 대기 |

---

## 시스템 아키텍처

### 1. Zero-GC Scratchpads

매 프레임 객체 생성을 방지하기 위해 재사용 가능한 Scratchpad를 사용합니다.

```typescript
// Zero-GC Scratchpads (모듈 레벨에서 한 번만 생성)
const SCRATCH_TRANSITION: EdgeTransitionResult = {
  finalEdgeIndex: 0,
  finalRatio: 0,
  activeEdge: null,
};

const SCRATCH_POS: PositionResult = {
  x: 0,
  y: 0,
  z: 0,
  rotation: 0,
};

const SCRATCH_MERGE_POS: PositionResult = {
  x: 0,
  y: 0,
  z: 0,
  rotation: 0,
};

const SCRATCH_ACCEL = {
  accel: 0,
  decel: 0,
};

const SCRATCH_TARGET_CHECK = {
  finalRatio: 0,
  finalVelocity: 0,
  reached: false,
};
```

**사용 패턴:**

```typescript
// ❌ 매 프레임 객체 생성 (GC 발생)
function badExample() {
  for (let i = 0; i < 1000; i++) {
    const result = { x: 0, y: 0, z: 0 };  // 1000개 객체 생성!
    interpolatePosition(edge, ratio, result);
  }
}

// ✅ Scratchpad 재사용 (GC 없음)
function goodExample() {
  const scratchPos = { x: 0, y: 0, z: 0 };  // 한 번만 생성
  for (let i = 0; i < 1000; i++) {
    interpolatePositionTo(edge, ratio, scratchPos);  // 재사용
    // scratchPos.x, scratchPos.y, scratchPos.z 사용
  }
}
```

### 2. 메인 루프 (updateMovement)

```typescript
export function updateMovement(ctx: MovementUpdateContext) {
  const {
    vehicleDataArray,
    sensorPointArray,
    edgeArray,
    actualNumVehicles,
    vehicleLoopMap,
    edgeNameToIndex,
    store,
    lockMgr,
    transferMgr,
    clampedDelta,
    config,
  } = ctx;

  const data = vehicleDataArray.getData();

  // 1. Transfer Queue 처리 (Edge 끝 도달한 차량의 다음 Edge 결정)
  transferMgr.processTransferQueue(
    vehicleDataArray,
    edgeArray,
    vehicleLoopMap,
    edgeNameToIndex,
    store.transferMode
  );

  // 2. 차량별 이동 처리
  for (let i = 0; i < actualNumVehicles; i++) {
    const ptr = i * VEHICLE_DATA_SIZE;

    // 2-a. PAUSED/STOPPED 체크
    if (shouldSkipUpdate(data, ptr)) {
      continue;
    }

    // 2-b ~ 2-k: 이동 로직 처리
    // ...
  }
}
```

### 3. 상태 체크 (shouldSkipUpdate)

```typescript
function shouldSkipUpdate(data: Float32Array, ptr: number): boolean {
  const status = data[ptr + MovementData.MOVING_STATUS];

  if (status === MovingStatus.PAUSED) {
    return true;  // 일시정지 → 스킵
  }

  if (status === MovingStatus.STOPPED) {
    data[ptr + MovementData.VELOCITY] = 0;
    return true;  // 정지 → 속도 0, 스킵
  }

  if (status !== MovingStatus.MOVING) {
    data[ptr + MovementData.VELOCITY] = 0;
    return true;  // 알 수 없는 상태 → 스킵
  }

  return false;  // MOVING 상태 → 처리
}
```

**MovingStatus 상태 전환:**

```
차량 상태 전환:
┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│  MOVING (주행 중)                                                │
│    ↓                                                             │
│    ├─ targetRatio 도달 → STOPPED                                │
│    ├─ HIT_ZONE == 2 (충돌) → velocity = 0 (상태는 MOVING 유지)  │
│    ├─ MQTT 명령 → STOPPED → MOVING                              │
│    └─ 사용자가 PAUSED → PAUSED                                   │
│                                                                  │
│  STOPPED (정지)                                                  │
│    ↓                                                             │
│    ├─ MQTT 명령 (assignCommand) → MOVING                        │
│    └─ AutoMgr 경로 배정 → MOVING                                │
│                                                                  │
│  PAUSED (일시정지)                                               │
│    ↓                                                             │
│    └─ 사용자가 재개 → MOVING                                     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 충돌 감지 시스템

### 1. HIT_ZONE 계산

센서가 감지한 앞차와의 거리를 3단계로 분류합니다.

```typescript
function calculateHitZone(
  data: Float32Array,
  ptr: number,
  deceleration: number
): number {
  const rawHit = Math.trunc(data[ptr + SensorData.HIT_ZONE]);
  let hitZone = -1;

  if (rawHit === 2) {
    hitZone = 2;  // 충돌 직전 → 즉시 정지
  } else if (deceleration !== 0) {
    hitZone = rawHit;  // 0 또는 1 (감속 필요)
  }

  return hitZone;
}
```

**HIT_ZONE 단계:**

```
센서 감지 거리:
┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│  HIT_ZONE = -1 (안전)                                            │
│  ●─────────────────────────────────────────────────────►        │
│  차량                                  (충분한 거리)             │
│                                                                  │
│  HIT_ZONE = 0 (경계)                                             │
│  ●─────────────────────────────►  ●                             │
│  차량                       앞차 (감속 시작)                     │
│                                                                  │
│  HIT_ZONE = 1 (경고)                                             │
│  ●───────────────────►  ●                                       │
│  차량              앞차 (강한 감속)                              │
│                                                                  │
│  HIT_ZONE = 2 (위험)                                             │
│  ●──────►  ●                                                    │
│  차량   앞차 (즉시 정지!)                                        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 2. 센서 정지 처리

```typescript
function checkAndProcessSensorStop(
  hitZone: number,
  data: Float32Array,
  ptr: number
): boolean {
  if (hitZone === 2) {
    // 즉시 정지
    data[ptr + MovementData.VELOCITY] = 0;
    data[ptr + MovementData.DECELERATION] = 0;

    // STOP_REASON에 SENSORED 비트 설정
    const currentReason = data[ptr + LogicData.STOP_REASON];
    data[ptr + LogicData.STOP_REASON] = currentReason | StopReason.SENSORED;
    return true;  // 이동 로직 스킵
  } else {
    // SENSORED 비트 해제
    const currentReason = data[ptr + LogicData.STOP_REASON];
    if ((currentReason & StopReason.SENSORED) !== 0) {
      data[ptr + LogicData.STOP_REASON] = currentReason & ~StopReason.SENSORED;
    }
    return false;  // 계속 진행
  }
}
```

### 3. 가속/감속 계산

```typescript
function calculateAppliedAccelAndDecel(
  acceleration: number,
  deceleration: number,
  currentEdge: Edge,
  hitZone: number,
  curveAcceleration: number,
  target: typeof SCRATCH_ACCEL
) {
  let appliedAccel = acceleration;
  let appliedDecel = 0;

  // 1. 커브에서는 가속도 제한
  if (currentEdge.vos_rail_type !== EdgeType.LINEAR) {
    appliedAccel = curveAcceleration;  // 예: 0.5 m/s²
  }

  // 2. 센서 감지 시 감속 모드
  if (hitZone >= 0) {
    appliedAccel = 0;  // 가속 중단
    appliedDecel = deceleration;  // 감속 시작
  }

  target.accel = appliedAccel;
  target.decel = appliedDecel;
}
```

**시나리오:**

```
직선 구간 (LINEAR):
┌─────────────────────────────────────────────────────────────────┐
│ hitZone = -1 (안전)                                              │
│   appliedAccel = 2.0 m/s²  (설정값)                             │
│   appliedDecel = 0                                               │
│   → 가속                                                         │
│                                                                  │
│ hitZone = 0 (경계)                                               │
│   appliedAccel = 0                                               │
│   appliedDecel = 3.0 m/s²  (설정값)                             │
│   → 감속                                                         │
└─────────────────────────────────────────────────────────────────┘

커브 구간 (CURVE):
┌─────────────────────────────────────────────────────────────────┐
│ hitZone = -1 (안전)                                              │
│   appliedAccel = 0.5 m/s²  (curveAcceleration)                  │
│   appliedDecel = 0                                               │
│   → 커브에서는 천천히 가속                                       │
│                                                                  │
│ hitZone = 0 (경계)                                               │
│   appliedAccel = 0                                               │
│   appliedDecel = 3.0 m/s²                                        │
│   → 감속 (커브에서도 동일)                                       │
└─────────────────────────────────────────────────────────────────┘
```

---

## Edge 전환 시스템

### 1. Transfer Queue Trigger

Edge 끝에 도달하면 TransferMgr의 큐에 추가됩니다.

```typescript
function checkAndTriggerTransfer(
  transferMgr: TransferMgr,
  data: Float32Array,
  ptr: number,
  vehIdx: number,
  ratio: number
) {
  const nextEdgeState = data[ptr + MovementData.NEXT_EDGE_STATE];

  // ratio >= 1 (Edge 끝) AND NEXT_EDGE가 아직 결정 안 됨
  if (ratio >= 1 && nextEdgeState === NextEdgeState.EMPTY) {
    data[ptr + MovementData.NEXT_EDGE_STATE] = NextEdgeState.PENDING;
    transferMgr.enqueueVehicleTransfer(vehIdx);
    // → transferMgr.processTransferQueue에서 다음 Edge 결정
  }
}
```

**NextEdgeState 전환:**

```
Edge 전환 흐름:
┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│  1. EMPTY (다음 Edge 미정)                                       │
│     ratio < 1.0 → 계속 이동                                      │
│     ratio >= 1.0 → PENDING으로 전환 + transferQueue에 추가       │
│                                                                  │
│  2. PENDING (큐에서 대기)                                        │
│     transferMgr.processTransferQueue()에서 처리                 │
│     → NEXT_EDGE 결정 (mode에 따라)                              │
│     → READY로 전환                                               │
│                                                                  │
│  3. READY (다음 Edge 결정 완료)                                  │
│     ratio >= 1.0 → Edge 전환 실행                                │
│     → handleEdgeTransition() 호출                               │
│     → EMPTY로 리셋                                               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 2. Edge 전환 로직 (handleEdgeTransition)

```typescript
export function handleEdgeTransition(params: EdgeTransitionParams): void {
  const {
    vehicleDataArray,
    store,
    vehicleIndex,
    initialEdgeIndex,
    initialRatio,  // 예: 1.23 (overflow)
    edgeArray,
    target,
    preserveTargetRatio = false,
    nextTargetRatio
  } = params;

  let currentEdgeIdx = initialEdgeIndex;
  let currentRatio = initialRatio;
  let currentEdge = edgeArray[currentEdgeIdx];

  const data = vehicleDataArray.getData();
  const ptr = vehicleIndex * VEHICLE_DATA_SIZE;

  // Overflow 처리 루프
  while (currentEdge && currentRatio >= 1) {
    const overflowDist = (currentRatio - 1) * currentEdge.distance;

    const nextState = data[ptr + MovementData.NEXT_EDGE_STATE];
    const nextEdgeIndex = data[ptr + MovementData.NEXT_EDGE];

    // NEXT_EDGE가 준비되지 않았으면 중단
    if (nextState !== NextEdgeState.READY || nextEdgeIndex === -1) {
      currentRatio = 1;  // Edge 끝에서 정지
      break;
    }

    const nextEdge = edgeArray[nextEdgeIndex];
    if (!nextEdge) {
      currentRatio = 1;
      break;
    }

    // 다음 Edge로 전환
    store.moveVehicleToEdge(vehicleIndex, nextEdgeIndex, overflowDist / nextEdge.distance);

    // 센서 프리셋 업데이트 (STRAIGHT, CURVE_LEFT, CURVE_RIGHT 등)
    updateSensorPresetForEdge(vehicleDataArray, vehicleIndex, nextEdge);

    // TrafficState 초기화 (Merge Lock 해제)
    data[ptr + LogicData.TRAFFIC_STATE] = TrafficState.FREE;
    const currentReason = data[ptr + LogicData.STOP_REASON];
    if ((currentReason & StopReason.LOCKED) !== 0) {
      data[ptr + LogicData.STOP_REASON] = currentReason & ~StopReason.LOCKED;
    }

    // NEXT_EDGE 상태 리셋
    data[ptr + MovementData.NEXT_EDGE_STATE] = NextEdgeState.EMPTY;
    data[ptr + MovementData.NEXT_EDGE] = -1;

    // TARGET_RATIO 설정
    if (nextTargetRatio !== undefined) {
      // TransferMgr 예약에서 지정된 값
      data[ptr + MovementData.TARGET_RATIO] = nextTargetRatio;
    } else if (!preserveTargetRatio) {
      // 기본값: 1.0 (끝까지 이동)
      data[ptr + MovementData.TARGET_RATIO] = 1;
    }

    // 다음 반복
    currentEdgeIdx = nextEdgeIndex;
    currentEdge = nextEdge;
    currentRatio = overflowDist / nextEdge.distance;
  }

  // 결과 저장
  target.finalEdgeIndex = currentEdgeIdx;
  target.finalRatio = currentRatio;
  target.activeEdge = currentEdge || null;
}
```

**Overflow 거리 보존:**

```
Edge 전환 시 Overflow 거리 보존:
┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│  Edge A (distance = 10m)                                         │
│  ●────────────────────────────────────────────►●                │
│  0.0                                         1.23 (overflow)     │
│                                                                  │
│  overflowDist = (1.23 - 1.0) * 10m = 2.3m                       │
│                                                                  │
│  Edge B (distance = 20m)                                         │
│  ●──────►                                                        │
│  0.0  2.3m (0.115 ratio)                                        │
│                                                                  │
│  → Edge B로 전환 시 2.3m 위치에서 시작                           │
│  → 속도 보존 (momentum)                                          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 3. 다중 Edge 전환

한 프레임에 여러 Edge를 넘을 수 있습니다.

```
다중 Edge 전환 (고속 주행):
┌─────────────────────────────────────────────────────────────────┐
│ velocity = 10 m/s, deltaTime = 0.1s                              │
│ → 이동 거리 = 1m                                                 │
│                                                                  │
│ Edge A (distance = 0.3m, 짧은 edge)                              │
│ ratio = 0.8 → 1.0 + overflow (0.7m)                             │
│   ↓                                                              │
│ Edge B (distance = 0.5m)                                         │
│ ratio = 0 + 0.7/0.5 = 1.4 → 1.0 + overflow (0.2m)              │
│   ↓                                                              │
│ Edge C (distance = 2m)                                           │
│ ratio = 0 + 0.2/2 = 0.1                                         │
│   ↓                                                              │
│ 최종: Edge C, ratio = 0.1                                        │
│                                                                  │
│ → while 루프로 한 프레임에 A → B → C 전환 완료                  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 위치 보간 시스템 (Position Interpolation)

### 1. interpolatePositionTo (Zero-GC)

Edge와 ratio로부터 3D 좌표를 계산합니다.

```typescript
export function interpolatePositionTo(
  edge: Edge,
  ratio: number,
  target: PositionResult,
  defaultZ: number = 0.15
): void {
  const points = edge.renderingPoints;

  if (!points || points.length === 0) {
    setFallbackPosition(target, edge, defaultZ);
    return;
  }

  // LINEAR EDGES (직선)
  if (edge.vos_rail_type === EdgeType.LINEAR) {
    interpolateLinearPosition(target, points, ratio, defaultZ);
    return;
  }

  // CURVE EDGES (커브)
  const safeRatio = ratio < 0 ? 0 : Math.min(ratio, 1);

  const maxIndex = points.length - 1;
  const floatIndex = safeRatio * maxIndex;
  const index = Math.floor(floatIndex);

  const nextIndex = index < maxIndex ? index + 1 : maxIndex;
  const segmentRatio = floatIndex - index;

  const p1 = points[index];
  const p2 = points[nextIndex];

  // 위치 보간
  target.x = p1.x + (p2.x - p1.x) * segmentRatio;
  target.y = p1.y + (p2.y - p1.y) * segmentRatio;
  target.z = defaultZ;

  // 회전 계산 (안정적인 벡터 사용)
  const { dx, dy, distSq } = calculateStableVector(points, index, nextIndex, p1, p2);

  let rawRotation = 0;
  if (distSq > 0.000001) {
    rawRotation = Math.atan2(dy, dx) * RAD_TO_DEG;
  }

  target.rotation = ((rawRotation % 360) + 360) % 360;
}
```

### 2. 직선 보간 (LINEAR)

```typescript
function interpolateLinearPosition(
  target: PositionResult,
  points: { x: number; y: number }[],
  ratio: number,
  defaultZ: number
): void {
  const pStart = points[0];
  const pEnd = points.at(-1)!;

  // 선형 보간
  target.x = pStart.x + (pEnd.x - pStart.x) * ratio;
  target.y = pStart.y + (pEnd.y - pStart.y) * ratio;
  target.z = defaultZ;

  // 회전 (4방향)
  const dx = pEnd.x - pStart.x;
  const dy = pEnd.y - pStart.y;

  if (Math.abs(dx) >= Math.abs(dy)) {
    target.rotation = dx >= 0 ? 0 : 180;  // 동(0°) 또는 서(180°)
  } else {
    target.rotation = dy >= 0 ? 90 : -90;  // 북(90°) 또는 남(-90°)
  }
}
```

**시각화:**

```
직선 Edge (LINEAR):
┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│  points: [                                                       │
│    { x: 0, y: 0 },     ← pStart                                 │
│    { x: 10, y: 0 }     ← pEnd                                   │
│  ]                                                               │
│                                                                  │
│  ratio = 0.3                                                     │
│  x = 0 + (10 - 0) * 0.3 = 3                                     │
│  y = 0 + (0 - 0) * 0.3 = 0                                      │
│  rotation = 0° (동쪽)                                            │
│                                                                  │
│  ●────────●──────────────────►                                  │
│  (0,0)  (3,0)               (10,0)                              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 3. 커브 보간 (CURVE)

```typescript
// CURVE EDGES
const safeRatio = ratio < 0 ? 0 : Math.min(ratio, 1);

const maxIndex = points.length - 1;  // 예: 100개 포인트 → maxIndex = 99
const floatIndex = safeRatio * maxIndex;  // 0.3 * 99 = 29.7
const index = Math.floor(floatIndex);  // 29

const nextIndex = index < maxIndex ? index + 1 : maxIndex;  // 30
const segmentRatio = floatIndex - index;  // 0.7

const p1 = points[index];  // points[29]
const p2 = points[nextIndex];  // points[30]

// 선형 보간
target.x = p1.x + (p2.x - p1.x) * segmentRatio;
target.y = p1.y + (p2.y - p1.y) * segmentRatio;
```

**시각화:**

```
커브 Edge (CURVE):
┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│  points: [                                                       │
│    { x: 0, y: 0 },      ← index 0                               │
│    { x: 0.1, y: 0.05 }, ← index 1                               │
│    ...                                                           │
│    { x: 5, y: 5 },      ← index 29 (p1)                         │
│    { x: 5.2, y: 5.3 },  ← index 30 (p2)                         │
│    ...                                                           │
│  ]                                                               │
│                                                                  │
│  ratio = 0.3                                                     │
│  floatIndex = 0.3 * 99 = 29.7                                   │
│  index = 29, nextIndex = 30                                     │
│  segmentRatio = 0.7                                              │
│                                                                  │
│  x = 5 + (5.2 - 5) * 0.7 = 5.14                                 │
│  y = 5 + (5.3 - 5) * 0.7 = 5.21                                 │
│                                                                  │
│          ●────────●                                              │
│         p1       차량                                            │
│        (5,5)   (5.14, 5.21)                                     │
│                  ╲                                               │
│                   ●                                              │
│                   p2                                             │
│                 (5.2, 5.3)                                       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 4. 안정적인 회전 계산

인접 포인트가 너무 가까우면 회전이 불안정하므로, 멀리 있는 포인트를 사용합니다.

```typescript
function calculateStableVector(
  points: { x: number; y: number }[],
  index: number,
  nextIndex: number,
  p1: { x: number; y: number },
  p2: { x: number; y: number }
): { dx: number; dy: number; distSq: number } {
  const MIN_DIST_SQ = 0.01; // 0.1m 최소 거리
  const maxIndex = points.length - 1;

  let dx = p2.x - p1.x;
  let dy = p2.y - p1.y;
  let distSq = dx * dx + dy * dy;

  // 거리가 너무 짧으면 앞쪽 포인트 탐색
  if (distSq < MIN_DIST_SQ) {
    let lookAheadIdx = nextIndex + 1;
    while (lookAheadIdx <= maxIndex && distSq < MIN_DIST_SQ) {
      const pAhead = points[lookAheadIdx];
      dx = pAhead.x - p1.x;
      dy = pAhead.y - p1.y;
      distSq = dx * dx + dy * dy;
      lookAheadIdx++;
    }

    // 여전히 짧으면 뒤쪽 포인트 탐색
    if (distSq < MIN_DIST_SQ && index > 0) {
      let lookBackIdx = index - 1;
      while (lookBackIdx >= 0 && distSq < MIN_DIST_SQ) {
        const pBack = points[lookBackIdx];
        dx = p1.x - pBack.x;
        dy = p1.y - pBack.y;
        distSq = dx * dx + dy * dy;
        lookBackIdx--;
      }
    }
  }

  return { dx, dy, distSq };
}
```

**시나리오:**

```
안정적인 회전 계산:
┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│  ❌ 인접 포인트만 사용:                                          │
│     p1 = (5.0, 5.0)                                             │
│     p2 = (5.001, 5.001)  ← 매우 가까움!                         │
│     dx = 0.001, dy = 0.001                                      │
│     rotation = atan2(0.001, 0.001) = 45°                        │
│     → 노이즈에 민감, 떨림 발생                                   │
│                                                                  │
│  ✅ 멀리 있는 포인트 사용:                                       │
│     p1 = (5.0, 5.0)                                             │
│     lookAhead → p7 = (5.5, 5.7)  ← 충분히 멀리!                 │
│     dx = 0.5, dy = 0.7                                          │
│     rotation = atan2(0.7, 0.5) = 54.5°                          │
│     → 안정적인 회전 값                                           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Merge Node 제어 (LockMgr 연동)

### 0. 왜 interpolatePositionTo를 2번 호출하는가?

**핵심 개념:** Merge 대기 로직에서 차량이 대기 지점을 넘어간 경우, ratio를 대기 지점으로 되돌리고 좌표를 재계산해야 합니다.

#### 시나리오 설명

```
Merge Node 대기 상황:
┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│ Edge A (distance = 10m)                                          │
│ ●──────────────────────────────────────────►● Merge Node       │
│ 0.0                             8m (wait) 10m                    │
│                                                                  │
│ 차량 VEH0 상태:                                                  │
│ - 현재 위치: ratio=0.75 (7.5m)                                   │
│ - 현재 속도: 2 m/s                                               │
│ - 프레임 델타: 0.5초                                             │
│                                                                  │
│ === Phase 1: 물리 계산 ===                                       │
│ newVelocity = 2 m/s                                              │
│ rawNewRatio = 0.75 + (2 * 0.5) / 10 = 0.75 + 0.1 = 0.85         │
│ → 차량이 8.5m까지 이동하려고 함 (대기 지점 8m을 넘음!)          │
│                                                                  │
│ === Phase 2: Edge 전환 ===                                       │
│ 전환 없음 (ratio < 1.0)                                          │
│ finalRatio = 0.85                                                │
│                                                                  │
│ === Phase 3: 위치 업데이트 (1차) ===                             │
│ ✅ 1차 interpolatePositionTo(ratio=0.85)                         │
│    → 위치 A = (x:8.5, y:5.0, z:0.0)                              │
│    → 차량이 8.5m 위치에 있음                                     │
│                                                                  │
│ === Merge 대기 체크 ===                                          │
│ waitDist = 8m                                                    │
│ currentDist = 0.85 * 10 = 8.5m                                   │
│ currentDist >= waitDist? → YES! (8.5 >= 8.0)                    │
│                                                                  │
│ ⚠️ 문제: 차량이 대기 지점을 0.5m 넘어갔다!                       │
│                                                                  │
│ === 해결: 위치 재조정 ===                                        │
│ target.x = waitDist / distance = 8 / 10 = 0.80                  │
│ finalRatio = 0.80 (8m로 되돌림)                                  │
│                                                                  │
│ ✅ 2차 interpolatePositionTo(ratio=0.80)                         │
│    → 위치 B = (x:8.0, y:5.0, z:0.0)                              │
│    → 차량이 정확히 대기 지점에 멈춤                               │
│                                                                  │
│ finalVelocity = 0 (대기 중)                                      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

#### 코드 흐름

```typescript
// Phase 3: updateVehiclePosition
function updateVehiclePosition(...) {
  // 1차 위치 보간: 속도 계산 후의 위치
  if (activeEdge) {
    interpolatePositionTo(activeEdge, finalRatio, SCRATCH_POS, ...);
    // finalRatio=0.85 → 위치 A (8.5m)
  }

  // Merge 대기 체크
  const shouldWait = checkAndProcessMergeWait(...);

  if (shouldWait) {
    // 차량이 대기 지점을 넘어갔음!
    finalRatio = SCRATCH_MERGE_POS.x;  // 0.85 → 0.80으로 변경

    // 2차 위치 보간: 변경된 ratio로 재계산
    if (activeEdge) {
      interpolatePositionTo(activeEdge, finalRatio, SCRATCH_POS, ...);
      // finalRatio=0.80 → 위치 B (8.0m, 대기 지점)
    }
    finalVelocity = 0;  // 멈춤
  }
}
```

#### 왜 2번 호출이 필요한가?

1. **1차 호출**: 물리 계산 결과를 반영한 위치
   - 차량이 속도와 가속도에 따라 이동한 위치
   - 대기 지점을 고려하지 않음

2. **2차 호출 (조건부)**: 대기 지점으로 보정된 위치
   - 차량이 대기 지점을 넘어간 경우에만 발생
   - ratio를 대기 지점으로 되돌림
   - **ratio가 변경되었으므로 좌표(x, y, z)도 다시 계산 필요**

#### 대기 지점을 넘지 않은 경우

```
차량이 대기 지점 이전에 있는 경우:
- currentDist = 7m
- waitDist = 8m
- currentDist < waitDist → shouldWait = false
- interpolatePositionTo 1번만 호출 (재계산 불필요)
```

#### 핵심 정리

- `shouldWait = true` = 차량이 대기 지점을 **넘어갔음**
- ratio가 변경되면 좌표도 변경되므로 재계산 필수
- 이것은 성능 저하가 아닌 **정확한 시뮬레이션을 위한 필수 로직**

---

### 1. Merge 대기 처리

```typescript
function checkAndProcessMergeWait(
  lockMgr: LockMgr,
  finalEdge: Edge,
  vehIdx: number,
  ratio: number,
  data: Float32Array,
  ptr: number,
  outPos: PositionResult
): boolean {
  return processMergeLogicInline(
    lockMgr,
    finalEdge,
    vehIdx,
    ratio,
    data,
    ptr,
    outPos
  );
}

function processMergeLogicInline(
  lockMgr: LockMgr,
  currentEdge: Edge,
  vehId: number,
  currentRatio: number,
  data: Float32Array,
  ptr: number,
  target: PositionResult
): boolean {
  // 1. Merge Node가 아니면 FREE 상태
  if (!lockMgr.isMergeNode(currentEdge.to_node)) {
    const currentReason = data[ptr + LogicData.STOP_REASON];
    if ((currentReason & StopReason.LOCKED) !== 0) {
      data[ptr + LogicData.STOP_REASON] = currentReason & ~StopReason.LOCKED;
    }
    data[ptr + LogicData.TRAFFIC_STATE] = TrafficState.FREE;
    return false;
  }

  // 2. 처음 진입 시 Lock 요청
  const currentTrafficState = data[ptr + LogicData.TRAFFIC_STATE];
  if (currentTrafficState === TrafficState.FREE) {
    lockMgr.requestLock(currentEdge.to_node, currentEdge.edge_name, vehId);
  }

  // 3. Grant 확인
  const isGranted = lockMgr.checkGrant(currentEdge.to_node, vehId);
  const currentReason = data[ptr + LogicData.STOP_REASON];

  if (isGranted) {
    // 3-a. 진입 허가 (ACQUIRED)
    if ((currentReason & StopReason.LOCKED) !== 0) {
      data[ptr + LogicData.STOP_REASON] = currentReason & ~StopReason.LOCKED;
    }
    data[ptr + LogicData.TRAFFIC_STATE] = TrafficState.ACQUIRED;
    return false;  // 진입 가능
  }

  // 3-b. 대기 (WAITING)
  data[ptr + LogicData.TRAFFIC_STATE] = TrafficState.WAITING;

  const waitDist = lockMgr.getWaitDistance(currentEdge);
  const currentDist = currentRatio * currentEdge.distance;

  // 핵심: 차량이 대기 지점을 넘어갔는지 체크
  if (currentDist >= waitDist) {
    // 차량이 너무 멀리 갔으므로 대기 지점으로 되돌림
    data[ptr + LogicData.STOP_REASON] = currentReason | StopReason.LOCKED;
    // ⚠️ 중요: target.x에 새로운 ratio를 저장
    // 호출자(updateVehiclePosition)가 이 값으로 위치를 재계산함
    target.x = waitDist / currentEdge.distance;  // 새로운 ratio
    return true;  // 위치 재계산 필요!
  }

  // 아직 waitDistance 도달 안 함
  if ((currentReason & StopReason.LOCKED) !== 0) {
    data[ptr + LogicData.STOP_REASON] = currentReason & ~StopReason.LOCKED;
  }

  return false;
}
```

**Merge 대기 시나리오:**

```
Merge Node 진입:
┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│ Edge A (distance = 10m)                                          │
│ ●──────────────────────────────────────►● Merge Node            │
│ 0.0                             7m (wait) 10m                    │
│                                                                  │
│ VEH0 상태: ratio = 0.5 (5m)                                      │
│   1. isMergeNode(to_node) → true                                │
│   2. TRAFFIC_STATE = FREE → requestLock()                       │
│   3. checkGrant() → false (다른 차량 진입 중)                    │
│   4. TRAFFIC_STATE = WAITING                                    │
│   5. currentDist = 5m < waitDist = 7m                           │
│   6. STOP_REASON에 LOCKED 추가 안 함 (아직 멀리 있음)            │
│   7. return false → 계속 진행                                    │
│                                                                  │
│ VEH0 상태: ratio = 0.75 (7.5m)                                   │
│   1. isMergeNode(to_node) → true                                │
│   2. TRAFFIC_STATE = WAITING (이미 요청됨)                       │
│   3. checkGrant() → false                                       │
│   4. currentDist = 7.5m >= waitDist = 7m                        │
│   5. STOP_REASON |= LOCKED                                      │
│   6. target.x = 7/10 = 0.7 (새로운 ratio)                       │
│   7. return true → velocity = 0, ratio = 0.7에서 정지            │
│                                                                  │
│ ●──────────────────────────●──────►● Merge Node                 │
│                           VEH0                                   │
│                         (대기 중)                                │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 2. Merge Lock 해제

Edge 전환 시 이전 Merge Lock을 해제합니다.

```typescript
function checkAndReleaseMergeLock(
  lockMgr: LockMgr,
  finalEdgeIndex: number,
  currentEdgeIndex: number,
  currentEdge: Edge,
  vehId: number
) {
  // Edge가 바뀌었는지 확인
  if (finalEdgeIndex === currentEdgeIndex) return;

  const prevToNode = currentEdge.to_node;
  if (lockMgr.isMergeNode(prevToNode)) {
    lockMgr.releaseLock(prevToNode, vehId);
    // → LockMgr이 다음 차량에게 Grant 부여
  }
}
```

---

## Target Ratio 시스템

### 1. Target Ratio 도달 체크

```typescript
function processSameEdgeLogic(
  isSameEdge: boolean,
  rawNewRatio: number,
  targetRatio: number,
  currentVelocity: number,
  data: Float32Array,
  ptr: number,
  out: typeof SCRATCH_TARGET_CHECK
): boolean {
  // Edge 전환했으면 체크 안 함
  if (!isSameEdge) {
    return false;
  }

  checkTargetReached(rawNewRatio, targetRatio, currentVelocity, out);

  if (out.reached) {
    data[ptr + MovementData.MOVING_STATUS] = MovingStatus.STOPPED;
  }

  return true;
}

function checkTargetReached(
  rawNewRatio: number,
  targetRatio: number,
  currentVelocity: number,
  out: typeof SCRATCH_TARGET_CHECK
) {
  if (rawNewRatio >= targetRatio) {
    out.finalRatio = targetRatio;  // 목표 위치에서 정확히 정지
    out.finalVelocity = 0;
    out.reached = true;
  } else {
    out.finalRatio = rawNewRatio;  // 계속 이동
    out.finalVelocity = currentVelocity;
    out.reached = false;
  }
}
```

**시나리오:**

```
Target Ratio 도달:
┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│ Edge A (distance = 10m)                                          │
│ ●──────────────────────────────────────────────────────►        │
│ 0.0                                                  0.8 (target)│
│                                                                  │
│ VEH0: ratio = 0.75, velocity = 1 m/s, deltaTime = 0.1s          │
│   rawNewRatio = 0.75 + (1 * 0.1) / 10 = 0.76                    │
│   targetRatio = 0.8                                              │
│   rawNewRatio < targetRatio → 계속 이동                          │
│                                                                  │
│ VEH0: ratio = 0.76, velocity = 1 m/s, deltaTime = 0.1s          │
│   rawNewRatio = 0.76 + (1 * 0.1) / 10 = 0.77                    │
│   rawNewRatio < targetRatio → 계속 이동                          │
│                                                                  │
│ ...                                                              │
│                                                                  │
│ VEH0: ratio = 0.79, velocity = 1 m/s, deltaTime = 0.1s          │
│   rawNewRatio = 0.79 + (1 * 0.1) / 10 = 0.80                    │
│   rawNewRatio >= targetRatio → 도달!                             │
│   finalRatio = 0.8 (정확히 목표 위치)                            │
│   finalVelocity = 0                                              │
│   MOVING_STATUS = STOPPED                                        │
│                                                                  │
│ ●──────────────────────────────────────────●                    │
│                                           VEH0                   │
│                                         (정지)                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 코드 가이드 (API, 사용법)

### updateMovement 호출

```typescript
// SimulationEngine.ts
import { updateMovement } from "@/common/vehicle/movement/movementUpdate";

function simulationStep(deltaTime: number) {
  for (const context of fabContexts.values()) {
    updateMovement({
      vehicleDataArray: context.vehicleDataArray,
      sensorPointArray: context.sensorPointArray,
      edgeArray: context.edges,
      actualNumVehicles: context.numVehicles,
      vehicleLoopMap: context.vehicleLoopMap,
      edgeNameToIndex: context.edgeNameToIndex,
      store: context,  // moveVehicleToEdge 메서드 필요
      lockMgr: context.lockMgr,
      transferMgr: context.transferMgr,
      clampedDelta: Math.min(deltaTime, 0.1),  // 최대 100ms
      config: {
        vehicleZOffset: 0.15,
        curveMaxSpeed: 1.0,
        curveAcceleration: 0.5,
        maxSpeed: 3.0,
        brakeDistance: 2.0,
        // ... SpeedConfig, SensorPointsConfig
      }
    });
  }
}
```

### Edge 전환 단독 사용

```typescript
import { handleEdgeTransition, EdgeTransitionResult } from "@/common/vehicle/movement/edgeTransition";

const result: EdgeTransitionResult = {
  finalEdgeIndex: 0,
  finalRatio: 0,
  activeEdge: null,
};

handleEdgeTransition({
  vehicleDataArray,
  store,
  vehicleIndex: 5,
  initialEdgeIndex: 10,
  initialRatio: 1.23,  // overflow
  edgeArray,
  target: result,
  preserveTargetRatio: false,
  nextTargetRatio: 1.0
});

// result.finalEdgeIndex, result.finalRatio, result.activeEdge 사용
```

### 위치 보간 단독 사용

```typescript
import { interpolatePositionTo, PositionResult } from "@/common/vehicle/movement/positionInterpolator";

const pos: PositionResult = { x: 0, y: 0, z: 0, rotation: 0 };

interpolatePositionTo(edge, 0.5, pos, 0.15);

console.log(`Position: (${pos.x}, ${pos.y}, ${pos.z}), Rotation: ${pos.rotation}°`);
```

---

## 성능 최적화

### 1. Zero-GC 디자인

모든 함수가 Scratchpad 재사용 패턴을 따릅니다.

```typescript
// ✅ Zero-GC: 모듈 레벨 Scratchpad
const SCRATCH_POS: PositionResult = { x: 0, y: 0, z: 0, rotation: 0 };

function updateVehicle(vehId: number) {
  interpolatePositionTo(edge, ratio, SCRATCH_POS);
  // SCRATCH_POS 사용
}

// ❌ 매 프레임 객체 생성
function updateVehicleBad(vehId: number) {
  const pos = { x: 0, y: 0, z: 0, rotation: 0 };  // GC!
  interpolatePositionTo(edge, ratio, pos);
}
```

### 2. Early Exit

불필요한 계산을 스킵합니다.

```typescript
// PAUSED/STOPPED 차량은 즉시 스킵
if (shouldSkipUpdate(data, ptr)) {
  continue;
}

// HIT_ZONE == 2 (충돌) → 즉시 정지, 나머지 로직 스킵
if (checkAndProcessSensorStop(hitZone, data, ptr)) {
  continue;
}

// Edge 전환 없으면 Merge Lock 해제 스킵
if (finalEdgeIndex === currentEdgeIndex) return;
```

### 3. SharedMemory 직접 접근

객체 래퍼 없이 Float32Array를 직접 사용합니다.

```typescript
// ✅ 직접 접근
const data = vehicleDataArray.getData();
const ptr = vehId * VEHICLE_DATA_SIZE;
data[ptr + MovementData.VELOCITY] = newVelocity;

// ❌ 객체 래퍼 (느림)
vehicle.setVelocity(newVelocity);  // 함수 호출 오버헤드
```

### 4. 계산 최소화

필요한 계산만 수행합니다.

```typescript
// Edge 전환했을 때만 위치 재계산
if (activeEdge) {
  interpolatePositionTo(activeEdge, finalRatio, SCRATCH_POS);
  finalX = SCRATCH_POS.x;
  // ...
}

// Merge 대기 시에만 위치 재계산
if (shouldWait) {
  interpolatePositionTo(activeEdge, finalRatio, SCRATCH_POS);
  // ...
}
```

---

## 주의사항

### 1. deltaTime 제한

deltaTime이 너무 크면 다중 Edge 전환 시 무한 루프 위험이 있습니다.

```typescript
// ✅ deltaTime 제한
const clampedDelta = Math.min(deltaTime, 0.1);  // 최대 100ms

// ❌ 제한 없음
// deltaTime = 1초 → 60m 이동 → 수십 개 Edge 전환 → 성능 저하
```

### 2. Scratchpad 오염 방지

Scratchpad는 함수 호출 직후 사용해야 합니다.

```typescript
// ✅ 즉시 사용
interpolatePositionTo(edge, ratio, SCRATCH_POS);
finalX = SCRATCH_POS.x;  // OK

// ❌ 다른 함수 호출 후 사용
interpolatePositionTo(edge, ratio, SCRATCH_POS);
someOtherFunction();  // SCRATCH_POS 오염 가능!
finalX = SCRATCH_POS.x;  // 잘못된 값
```

### 3. Edge 전환 조건

Edge 전환은 `ratio >= 1` AND `NEXT_EDGE_STATE == READY` 조건입니다.

```typescript
// ✅ 올바른 전환
ratio >= 1 && nextEdgeState === NextEdgeState.READY
  → handleEdgeTransition()

// ❌ NEXT_EDGE가 없는데 전환 시도
ratio >= 1 && nextEdgeState === NextEdgeState.EMPTY
  → Edge 끝에서 정지 (전환 안 함)
```

### 4. Merge Lock 타이밍

Merge Lock은 Edge 전환 전에 해제해야 합니다.

```typescript
// ✅ 올바른 순서
1. processEdgeTransitionLogic()  // Edge 전환
2. checkAndReleaseMergeLock()   // 이전 Edge의 Merge Lock 해제
3. checkAndProcessMergeWait()   // 새 Edge의 Merge Lock 요청

// ❌ 잘못된 순서
1. checkAndReleaseMergeLock()   // 현재 Edge Lock 해제 (너무 빠름!)
2. processEdgeTransitionLogic()  // Edge 전환
→ Grant를 받았는데도 Lock 해제됨
```

---

## 관련 문서

- [시스템 아키텍처](../../../../doc/SYSTEM_ARCHITECTURE.md)
- [Vehicle Memory Architecture](../memory/README.md) - MovementData, SensorData 메모리 구조
- [Logic Manager](../logic/README.md) - LockMgr, TransferMgr, AutoMgr 연동
- [Collision Detection](../collision/README.md) - 센서 충돌 감지
- [Physics](../physics/README.md) - calculateNextSpeed 속도 계산
