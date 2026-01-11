# Lock Manager (LockMgr) - Merge Node 진입 제어 시스템

Merge Node(합류점)에서 여러 edge에서 오는 차량들의 진입 순서를 제어하는 시스템입니다. 신호등처럼 동작하여 한 번에 한 대의 차량만 진입하도록 허가합니다.

## 개념 (왜 이렇게 설계했나)

### 문제: Merge Node에서 충돌

여러 edge가 하나의 node로 합류하는 지점에서 차량이 동시에 진입하면 충돌이 발생합니다.

```
문제 상황:
┌─────────────────────────────────────────────────────────────────┐
│                     Merge Node (합류점)                          │
│                                                                  │
│       Edge A                                                     │
│   VEH0 ────────►                                                 │
│                    ╲                                             │
│                     ╲    Merge Node                              │
│       Edge B         ╲      ●                                    │
│   VEH1 ─────────────► ╲    ╱                                    │
│                        ╲  ╱                                      │
│       Edge C            ╲╱                                       │
│   VEH2 ─────────────────►                                        │
│                           ╲                                      │
│                            ╲                                     │
│                             ►  Next Edge                         │
│                                                                  │
│  ❌ 문제: VEH0, VEH1, VEH2가 동시에 진입 시도 → 충돌!            │
└─────────────────────────────────────────────────────────────────┘
```

### 해결: Lock Manager (신호등 시스템)

LockMgr이 **진입 허가(Grant)**를 한 번에 한 대에게만 부여합니다.

```
해결 방안:
┌─────────────────────────────────────────────────────────────────┐
│                  LockMgr (신호등 제어)                           │
│                                                                  │
│       Edge A                                                     │
│   VEH0 ────────► 🟢 (GRANTED)                                   │
│                    ╲                                             │
│                     ╲    Merge Node                              │
│       Edge B         ╲      ●                                    │
│   VEH1 ─────────────► 🔴 (WAITING)                              │
│                        ╲  ╱                                      │
│       Edge C            ╲╱                                       │
│   VEH2 ─────────────────► 🔴 (WAITING)                          │
│                           ╲                                      │
│                            ╲                                     │
│                             ►  Next Edge                         │
│                                                                  │
│  ✅ 해결: VEH0만 진입, VEH1/VEH2는 대기                          │
│                                                                  │
│  LockTable:                                                      │
│    MergeNode {                                                   │
│      granted: { edge: "Edge A", veh: 0 }  ← 현재 진입 차량      │
│      edgeQueues: {                                               │
│        "Edge A": [0],           ← VEH0 진입 중                   │
│        "Edge B": [1],           ← VEH1 대기                      │
│        "Edge C": [2]            ← VEH2 대기                      │
│      }                                                           │
│    }                                                             │
└─────────────────────────────────────────────────────────────────┘
```

### 핵심 설계 원칙

| 원칙 | 설명 |
|------|------|
| **한 번에 한 대** | Merge Node당 동시에 1대만 진입 허가 |
| **FIFO 기본** | 먼저 도착한 차량이 먼저 진입 (공정성) |
| **전략 교체 가능** | Round-Robin, Priority 등 다양한 전략 지원 |
| **Zero-GC** | RingBuffer로 O(1) enqueue/dequeue (GC 없음) |

---

## 시스템 아키텍처

### 1. TrafficState (차량의 신호등 상태)

차량이 Merge Node 진입 시 3가지 상태를 가집니다.

```typescript
export const TrafficState = {
  FREE: 0,       // Merge Node 아님 또는 아직 도달 안 함
  WAITING: 1,    // 진입 대기 중 (빨간불)
  ACQUIRED: 2,   // 진입 허가 받음 (녹색불)
} as const;
```

**상태 전환 흐름:**

```
차량 Life Cycle (Merge Node 통과)
┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│  1. 일반 주행 (FREE)                                             │
│     TrafficState = FREE                                          │
│     STOP_REASON에 LOCKED 없음                                    │
│     │                                                            │
│     ├─ Merge Node 접근 (waitDistance 도달)                       │
│     ↓                                                            │
│                                                                  │
│  2. 진입 요청 (requestLock)                                      │
│     lockMgr.requestLock(nodeName, edgeName, vehId)               │
│     edgeQueues[edgeName]에 추가                                  │
│     │                                                            │
│     ├─ Grant 받지 못함 (다른 차량이 진입 중)                      │
│     ↓                                                            │
│                                                                  │
│  3. 대기 (WAITING)                                               │
│     TrafficState = WAITING                                       │
│     STOP_REASON |= LOCKED                                        │
│     차량 정지 (waitDistance 위치)                                │
│     │                                                            │
│     ├─ 앞 차량이 통과 → 내 차례 (checkGrant = true)              │
│     ↓                                                            │
│                                                                  │
│  4. 진입 허가 (ACQUIRED)                                         │
│     TrafficState = ACQUIRED                                      │
│     STOP_REASON &= ~LOCKED (LOCKED 비트 해제)                    │
│     차량 진입 시작                                                │
│     │                                                            │
│     ├─ Merge Node 통과 완료                                      │
│     ↓                                                            │
│                                                                  │
│  5. 락 해제 (releaseLock)                                        │
│     lockMgr.releaseLock(nodeName, vehId)                         │
│     edgeQueues에서 제거                                          │
│     다음 차량에게 Grant 부여                                      │
│     │                                                            │
│     └─ 다시 FREE 상태로 (일반 주행)                              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 2. 데이터 구조

#### MergeLockNode

Merge Node 하나를 관리하는 데이터 구조입니다.

```typescript
export type MergeLockNode = {
  name: string;                              // Merge Node 이름 (to_node)
  requests: LockRequest[];                   // 진입 요청 목록
  edgeQueues: Record<string, RingBuffer<number>>;  // Edge별 대기열
  mergedQueue: number[];                     // 통합 대기열 (미사용)
  granted: Grant;                            // 현재 진입 중인 차량
  strategyState: Record<string, unknown>;    // 전략별 상태 저장
};

export type Grant = {
  edge: string;   // 진입 허가받은 차량이 속한 edge
  veh: number;    // 진입 허가받은 차량 index
} | null;

export type LockRequest = {
  vehId: number;
  edgeName: string;
  requestTime: number;  // 요청 시각 (FIFO 정렬용)
};
```

**시각화:**

```
MergeLockNode (Merge1)
┌────────────────────────────────────────────────────────────────┐
│ name: "Merge1"                                                 │
│                                                                 │
│ granted: { edge: "E001", veh: 5 }  ← VEH5가 현재 진입 중       │
│                                                                 │
│ edgeQueues: {                                                  │
│   "E001": RingBuffer [5, 12, 23]  ← Edge E001에서 대기         │
│            head─┘   │   └─tail                                │
│                     │                                           │
│   "E002": RingBuffer [7, 18]      ← Edge E002에서 대기         │
│            head─┘   └─tail                                     │
│                                                                 │
│   "E003": RingBuffer []            ← Edge E003 대기 없음       │
│            (empty)                                              │
│ }                                                               │
│                                                                 │
│ requests: [                        ← 전체 요청 목록 (정렬용)    │
│   { vehId: 5,  edgeName: "E001", requestTime: 1000 },          │
│   { vehId: 7,  edgeName: "E002", requestTime: 1050 },          │
│   { vehId: 12, edgeName: "E001", requestTime: 1100 },          │
│   { vehId: 18, edgeName: "E002", requestTime: 1150 },          │
│   { vehId: 23, edgeName: "E001", requestTime: 1200 }           │
│ ]                                                               │
└────────────────────────────────────────────────────────────────┘
```

#### LockTable

모든 Merge Node를 관리하는 테이블입니다.

```typescript
export type LockTable = Record<string, MergeLockNode>;

// 예시:
const lockTable = {
  "NODE0001": MergeLockNode { ... },
  "NODE0005": MergeLockNode { ... },
  "NODE0012": MergeLockNode { ... },
};
```

### 3. RingBuffer (O(1) 큐)

일반 배열 대신 **RingBuffer**를 사용하여 enqueue/dequeue를 O(1)로 수행합니다.

```typescript
export class RingBuffer<T> {
  private buffer: (T | undefined)[];
  private head = 0;  // 다음에 읽을 위치
  private tail = 0;  // 다음에 쓸 위치
  private count = 0;

  enqueue(item: T): void;    // O(1)
  dequeue(): T | undefined;  // O(1)
  peek(): T | undefined;     // O(1)
}
```

**일반 배열 vs RingBuffer:**

```
❌ 일반 배열 (Array.shift):
┌─────────────────────────────────────────────────────────────────┐
│ [VEH0, VEH1, VEH2, VEH3]                                        │
│                                                                  │
│ arr.shift()  // VEH0 제거                                       │
│ → [VEH1, VEH2, VEH3]  ← 나머지 요소 이동 (O(N))                 │
│                         ↑↑↑ 복사 비용!                          │
└─────────────────────────────────────────────────────────────────┘

✅ RingBuffer:
┌─────────────────────────────────────────────────────────────────┐
│ [VEH0, VEH1, VEH2, VEH3, undefined, undefined, ...]             │
│   ↑                ↑                                            │
│  head             tail                                          │
│                                                                  │
│ dequeue()  // head만 이동                                        │
│ → [undefined, VEH1, VEH2, VEH3, undefined, ...]                 │
│              ↑              ↑                                    │
│             head           tail                                 │
│   ↑ 요소 이동 없음 (O(1))                                       │
└─────────────────────────────────────────────────────────────────┘
```

---

## 초기화 흐름

### 1. Merge Node 탐색

맵 로딩 시 **incoming edge가 2개 이상인 node**를 Merge Node로 등록합니다.

```typescript
// LockMgr.initFromEdges(edges)
const incomingEdgesByNode = new Map<string, string[]>();

// 1. 모든 edge의 to_node 수집
for (const edge of edges) {
  const toNode = edge.to_node;
  if (!incomingEdgesByNode.has(toNode)) {
    incomingEdgesByNode.set(toNode, []);
  }
  incomingEdgesByNode.get(toNode).push(edge.edge_name);
}

// 2. incoming edge가 2개 이상인 node만 Merge Node로 등록
for (const [nodeName, incomingEdges] of incomingEdgesByNode.entries()) {
  if (incomingEdges.length >= 2) {
    // MergeLockNode 생성
    lockTable[nodeName] = {
      name: nodeName,
      requests: [],
      edgeQueues: {},
      mergedQueue: [],
      granted: null,
      strategyState: {},
    };

    // Edge별 RingBuffer 생성
    for (const edgeName of incomingEdges) {
      lockTable[nodeName].edgeQueues[edgeName] = new RingBuffer<number>();
    }
  }
}
```

**예시:**

```
맵 구조:
   E001 ──►
           ╲
            ╲   NODE0001 (Merge Node)
   E002 ───► ●───► E010
            ╱
           ╱
   E003 ──►

LockTable 생성:
{
  "NODE0001": {
    name: "NODE0001",
    edgeQueues: {
      "E001": RingBuffer [],
      "E002": RingBuffer [],
      "E003": RingBuffer []
    },
    granted: null
  }
}
```

### 2. FabContext 초기화

각 `FabContext`는 독립적인 `LockMgr` 인스턴스를 가집니다.

```typescript
// FabContext.ts
class FabContext {
  private readonly lockMgr: LockMgr;

  constructor(params: FabInitParams) {
    this.lockMgr = new LockMgr();
    this.lockMgr.initFromEdges(this.edges);  // FAB별 맵으로 초기화
  }
}
```

**FAB별 독립성:**

```
Worker 0
└── SimulationEngine
    └── fabContexts
        ├── "fab_0_0" → FabContext
        │   ├── edges: [edge0001, edge0002, ...]
        │   └── lockMgr: LockMgr (독립 인스턴스)
        │       └── lockTable: { "NODE0001": ..., "NODE0005": ... }
        │
        └── "fab_0_1" → FabContext
            ├── edges: [edge1001, edge1002, ...]  ← offset된 edge
            └── lockMgr: LockMgr (독립 인스턴스)
                └── lockTable: { "NODE1001": ..., "NODE1005": ... }
```

---

## 런타임 동작

### 1. 진입 요청 (requestLock)

차량이 Merge Node의 **waitDistance**에 도달하면 진입을 요청합니다.

```typescript
// movementUpdate.ts
function handleMergeLock(
  lockMgr: LockMgr,
  vehId: number,
  currentEdge: Edge,
  currentRatio: number,
  data: Float32Array,
  ptr: number
): boolean {
  // 1. Merge Node 확인
  if (!lockMgr.isMergeNode(currentEdge.to_node)) {
    // Merge Node 아니면 FREE 상태로
    data[ptr + LogicData.TRAFFIC_STATE] = TrafficState.FREE;
    return false;
  }

  // 2. 처음 진입 시 requestLock
  const currentTrafficState = data[ptr + LogicData.TRAFFIC_STATE];
  if (currentTrafficState === TrafficState.FREE) {
    lockMgr.requestLock(currentEdge.to_node, currentEdge.edge_name, vehId);
  }

  // 3. Grant 확인
  const isGranted = lockMgr.checkGrant(currentEdge.to_node, vehId);

  if (isGranted) {
    // 3-a. 진입 허가 (ACQUIRED)
    data[ptr + LogicData.TRAFFIC_STATE] = TrafficState.ACQUIRED;
    data[ptr + LogicData.STOP_REASON] &= ~StopReason.LOCKED;
    return false;  // 진입 가능
  } else {
    // 3-b. 대기 (WAITING)
    data[ptr + LogicData.TRAFFIC_STATE] = TrafficState.WAITING;

    // waitDistance에서 정지
    const waitDist = lockMgr.getWaitDistance(currentEdge);
    const currentDist = currentRatio * currentEdge.distance;

    if (currentDist >= waitDist) {
      data[ptr + LogicData.STOP_REASON] |= StopReason.LOCKED;
      target.x = waitDist / currentEdge.distance;  // 정지 위치
      return true;  // 정지 필요
    }
  }
}
```

**requestLock 내부 동작:**

```typescript
// LockMgr.ts
requestLock(nodeName: string, edgeName: string, vehId: number) {
  const node = this.lockTable[nodeName];
  if (!node) return;

  // 1. 중복 요청 방지
  const existing = node.requests.find((r) => r.vehId === vehId);
  if (existing || node.granted?.veh === vehId) return;

  // 2. 요청 목록에 추가
  node.requests.push({
    vehId,
    edgeName,
    requestTime: Date.now(),
  });

  // 3. Edge별 큐에 추가 (O(1))
  node.edgeQueues[edgeName]?.enqueue(vehId);

  // 4. Grant 시도
  this.tryGrant(nodeName);
}
```

### 2. Grant 부여 (tryGrant)

현재 진입 중인 차량이 없으면 **전략(Strategy)**에 따라 다음 차량을 선택합니다.

```typescript
// LockMgr.ts
tryGrant(nodeName: string) {
  const node = this.lockTable[nodeName];
  if (!node) return;

  // 1. 이미 Grant가 있으면 스킵
  if (node.granted) return;

  // 2. 전략에 따라 다음 차량 선택
  const decision = this.currentStrategy(node);

  if (decision) {
    // 3. Grant 부여
    node.granted = decision;

    // 4. 요청 목록에서 제거
    node.requests = node.requests.filter((r) => r.vehId !== decision.veh);
  }
}
```

### 3. 락 해제 (releaseLock)

차량이 Merge Node를 통과하면 락을 해제하고 다음 차량에게 Grant를 부여합니다.

```typescript
// movementUpdate.ts - edge 이동 시 호출
function releaseMergeLockIfNeeded(
  lockMgr: LockMgr,
  finalEdgeIndex: number,
  currentEdgeIndex: number,
  currentEdge: Edge,
  vehId: number
) {
  if (finalEdgeIndex === currentEdgeIndex) return;

  const prevToNode = currentEdge.to_node;
  if (lockMgr.isMergeNode(prevToNode)) {
    lockMgr.releaseLock(prevToNode, vehId);  // 락 해제
  }
}
```

**releaseLock 내부 동작:**

```typescript
// LockMgr.ts
releaseLock(nodeName: string, vehId: number) {
  const node = this.lockTable[nodeName];
  if (!node) return;

  // 1. Grant 소유자 확인
  if (node.granted?.veh !== vehId) return;

  // 2. Grant 해제
  const grantedEdge = node.granted.edge;
  node.granted = null;

  // 3. 요청 목록에서 제거
  node.requests = node.requests.filter((r) => r.vehId !== vehId);

  // 4. Edge 큐에서 제거 (O(1) dequeue)
  node.edgeQueues[grantedEdge]?.dequeue();

  // 5. 다음 차량에게 Grant 부여
  this.tryGrant(nodeName);
}
```

### 4. waitDistance 계산

Merge Node 진입 전 **대기 위치**를 계산합니다.

```typescript
// LockMgr.ts
getWaitDistance(edge: Edge): number {
  if (edge.vos_rail_type !== EdgeType.LINEAR) {
    return 0;  // 커브는 끝까지 진행
  }

  if (edge.distance >= 3) {
    return edge.distance - 3;  // 끝에서 3m 앞에서 대기
  } else {
    return 0;  // 짧은 edge는 끝까지 진행
  }
}
```

**시각화:**

```
직선 Edge (distance = 10m):
┌────────────────────────────────────────────────────────────────┐
│                                                                 │
│  Edge 시작                                                      │
│    ●────────────────────────────────────● Merge Node           │
│    0m                        7m (대기)  10m                     │
│                               ↑                                 │
│                        waitDistance = 10 - 3 = 7m              │
│                        (Merge Node 3m 앞에서 대기)              │
└────────────────────────────────────────────────────────────────┘

짧은 Edge (distance = 2m):
┌────────────────────────────────────────────────────────────────┐
│                                                                 │
│  Edge 시작                                                      │
│    ●──────● Merge Node                                          │
│    0m     2m                                                    │
│           ↑                                                     │
│    waitDistance = 0 (끝까지 진행)                               │
└────────────────────────────────────────────────────────────────┘
```

---

## 전략 (Strategy) 시스템

### MergeStrategy 인터페이스

```typescript
export type MergeStrategy = (node: MergeLockNode) => Grant | null;
```

전략 함수는 `MergeLockNode`를 받아서 다음에 진입할 차량을 결정합니다.

### FIFO_Strategy (기본 전략)

**먼저 요청한 차량**이 먼저 진입합니다.

```typescript
const FIFO_Strategy: MergeStrategy = (node) => {
  // 1. 이미 Grant가 있으면 null
  if (node.granted) return null;

  // 2. 요청이 없으면 null
  if (node.requests.length === 0) return null;

  // 3. 요청 시간 순으로 정렬
  node.requests.sort((a, b) => a.requestTime - b.requestTime);

  // 4. 가장 먼저 요청한 차량 선택
  const target = node.requests[0];
  return { veh: target.vehId, edge: target.edgeName };
};
```

**시나리오:**

```
시간 순서:
┌────────────────────────────────────────────────────────────────┐
│ T=1000ms: VEH5 (E001) 요청                                     │
│ T=1050ms: VEH7 (E002) 요청                                     │
│ T=1100ms: VEH12 (E001) 요청                                    │
│                                                                 │
│ FIFO_Strategy 선택:                                            │
│ → VEH5 (가장 먼저 요청)                                        │
│                                                                 │
│ VEH5 통과 후:                                                  │
│ → VEH7 (그 다음 요청)                                          │
│                                                                 │
│ VEH7 통과 후:                                                  │
│ → VEH12                                                        │
└────────────────────────────────────────────────────────────────┘
```

### 커스텀 전략 추가

새로운 전략을 추가할 수 있습니다.

```typescript
// Round-Robin 전략 (Edge별 공정)
const RoundRobin_Strategy: MergeStrategy = (node) => {
  if (node.granted) return null;
  if (node.requests.length === 0) return null;

  // 1. strategyState에서 마지막 선택된 edge 가져오기
  const edgeNames = Object.keys(node.edgeQueues);
  const lastEdgeIndex = (node.strategyState.rrIndex as number) ?? -1;

  // 2. 다음 edge부터 순회
  for (let i = 0; i < edgeNames.length; i++) {
    const edgeIndex = (lastEdgeIndex + 1 + i) % edgeNames.length;
    const edgeName = edgeNames[edgeIndex];
    const queue = node.edgeQueues[edgeName];

    // 3. 비어있지 않은 edge 찾기
    if (queue.size > 0) {
      const vehId = queue.peek();
      if (vehId !== undefined) {
        node.strategyState.rrIndex = edgeIndex;  // 상태 업데이트
        return { veh: vehId, edge: edgeName };
      }
    }
  }

  return null;
};

// 전략 설정
lockMgr.setStrategy(RoundRobin_Strategy);
```

**Round-Robin 시나리오:**

```
edgeQueues:
  E001: [VEH5, VEH12, VEH23]
  E002: [VEH7, VEH18]
  E003: [VEH10]

Round-Robin 선택 순서:
1. E001 → VEH5
2. E002 → VEH7   (E001 다음 edge)
3. E003 → VEH10  (E002 다음 edge)
4. E001 → VEH12  (E003 다음 edge, E001로 순환)
5. E002 → VEH18
6. E001 → VEH23

→ Edge별로 공정하게 순환
```

---

## 코드 가이드 (API, 사용법)

### LockMgr 생성 및 초기화

```typescript
// FabContext.ts
import { LockMgr } from "@/common/vehicle/logic/LockMgr";

class FabContext {
  private readonly lockMgr: LockMgr;

  constructor(params: FabInitParams) {
    // 1. LockMgr 생성
    this.lockMgr = new LockMgr();

    // 2. Edge 목록으로 초기화 (Merge Node 자동 탐색)
    this.lockMgr.initFromEdges(this.edges);
  }
}
```

### 런타임 사용

```typescript
// movementUpdate.ts
import { LockMgr } from "@/common/vehicle/logic/LockMgr";
import { TrafficState, StopReason } from "@/common/vehicle/initialize/constants";

function updateVehicle(
  lockMgr: LockMgr,
  vehId: number,
  currentEdge: Edge,
  data: Float32Array,
  ptr: number
) {
  // 1. Merge Node 확인
  if (!lockMgr.isMergeNode(currentEdge.to_node)) {
    // Merge Node 아니면 FREE
    data[ptr + LogicData.TRAFFIC_STATE] = TrafficState.FREE;
    return;
  }

  // 2. 진입 요청 (처음 한 번만)
  const currentState = data[ptr + LogicData.TRAFFIC_STATE];
  if (currentState === TrafficState.FREE) {
    lockMgr.requestLock(currentEdge.to_node, currentEdge.edge_name, vehId);
  }

  // 3. Grant 확인
  const isGranted = lockMgr.checkGrant(currentEdge.to_node, vehId);

  if (isGranted) {
    // 진입 허가
    data[ptr + LogicData.TRAFFIC_STATE] = TrafficState.ACQUIRED;
    data[ptr + LogicData.STOP_REASON] &= ~StopReason.LOCKED;
  } else {
    // 대기
    data[ptr + LogicData.TRAFFIC_STATE] = TrafficState.WAITING;
    data[ptr + LogicData.STOP_REASON] |= StopReason.LOCKED;
  }
}

// Edge 이동 시 락 해제
function onEdgeTransition(
  lockMgr: LockMgr,
  vehId: number,
  prevEdge: Edge
) {
  if (lockMgr.isMergeNode(prevEdge.to_node)) {
    lockMgr.releaseLock(prevEdge.to_node, vehId);
  }
}
```

### 전략 설정

```typescript
// FabContext.ts
import { FIFO_Strategy, RoundRobin_Strategy } from "./strategies";

// 기본 전략 (FIFO)
this.lockMgr.setStrategy(FIFO_Strategy);

// 또는 Round-Robin
this.lockMgr.setStrategy(RoundRobin_Strategy);
```

### 디버깅

```typescript
// LockMgr.ts에서 DEBUG = true로 설정
const DEBUG = true;

// 콘솔 로그 예시:
// [LockMgr NODE0001 VEH5] REQUEST (Edge: E001)
// [LockMgr NODE0001] STATE: Holder=[FREE], Queue={5, 7, 12}
// [LockMgr NODE0001 VEH5] GRANT
// [LockMgr NODE0001] STATE: Holder=[5], Queue={7, 12}
// [LockMgr NODE0001 VEH5] RELEASE
// [LockMgr NODE0001] TryGrant: No one selected
```

---

## 성능 최적화

### 1. RingBuffer (O(1) 큐)

일반 배열의 `shift()`는 O(N)이지만, RingBuffer는 **O(1)**입니다.

```typescript
// ❌ 일반 배열 (O(N))
const queue = [VEH0, VEH1, VEH2, VEH3];
queue.shift();  // O(N) - 모든 요소 이동

// ✅ RingBuffer (O(1))
const queue = new RingBuffer<number>();
queue.enqueue(VEH0);
queue.enqueue(VEH1);
queue.dequeue();  // O(1) - head 포인터만 이동
```

**성능 비교:**

| 연산 | 일반 배열 | RingBuffer |
|------|----------|------------|
| enqueue (push) | O(1) | O(1) |
| dequeue (shift) | **O(N)** | **O(1)** ✅ |
| peek (배열[0]) | O(1) | O(1) |

### 2. Edge별 큐 분리

모든 차량을 하나의 큐에 넣지 않고 **Edge별로 분리**하여 검색 범위를 줄입니다.

```
❌ 단일 큐:
  mergedQueue: [VEH5, VEH7, VEH12, VEH18, VEH23, VEH10, ...]
  → Round-Robin 시 모든 차량 순회 필요 (O(N))

✅ Edge별 큐:
  edgeQueues: {
    "E001": [VEH5, VEH12, VEH23],
    "E002": [VEH7, VEH18],
    "E003": [VEH10]
  }
  → Edge별 head만 확인 (O(1))
```

### 3. Grant 캐싱

현재 진입 중인 차량(`granted`)을 캐싱하여 매 프레임 전략 재실행을 방지합니다.

```typescript
tryGrant(nodeName: string) {
  const node = this.lockTable[nodeName];

  // 이미 Grant가 있으면 즉시 리턴 (전략 실행 안 함)
  if (node.granted) return;

  // Grant가 없을 때만 전략 실행
  const decision = this.currentStrategy(node);
  node.granted = decision;
}
```

---

## 주의사항

### 1. 중복 요청 방지

차량이 여러 번 `requestLock`을 호출해도 큐에 한 번만 추가되어야 합니다.

```typescript
// ✅ 중복 방지
requestLock(nodeName: string, edgeName: string, vehId: number) {
  const node = this.lockTable[nodeName];

  // 이미 요청 목록에 있거나 Grant 받았으면 무시
  const existing = node.requests.find((r) => r.vehId === vehId);
  if (existing || node.granted?.veh === vehId) {
    return;
  }

  // 새로운 요청만 추가
  node.requests.push({ vehId, edgeName, requestTime: Date.now() });
  node.edgeQueues[edgeName]?.enqueue(vehId);
}
```

### 2. 락 해제 누락 방지

차량이 Merge Node를 통과할 때 **반드시** `releaseLock`을 호출해야 합니다.

```typescript
// ✅ edge 이동 시 락 해제
function onEdgeTransition(lockMgr: LockMgr, vehId: number, prevEdge: Edge) {
  if (lockMgr.isMergeNode(prevEdge.to_node)) {
    lockMgr.releaseLock(prevEdge.to_node, vehId);  // 필수!
  }
}

// ❌ 락 해제를 잊으면 → 다음 차량이 영원히 대기
```

### 3. TrafficState 초기화

Merge Node를 벗어나면 `TrafficState`를 **FREE**로 리셋해야 합니다.

```typescript
// ✅ Merge Node 아니면 FREE로
if (!lockMgr.isMergeNode(currentEdge.to_node)) {
  data[ptr + LogicData.TRAFFIC_STATE] = TrafficState.FREE;
  data[ptr + LogicData.STOP_REASON] &= ~StopReason.LOCKED;
}

// ❌ 리셋 안 하면 → 일반 edge에서도 WAITING 상태 유지
```

### 4. FAB별 독립성

각 FAB은 **독립적인 LockMgr**을 가지므로 서로 영향을 주지 않습니다.

```typescript
// ✅ FAB별 독립 인스턴스
fab_0_0의 LockMgr ≠ fab_0_1의 LockMgr

// fab_0_0의 VEH5와 fab_0_1의 VEH5는 다른 차량
// 같은 Merge Node 이름이어도 서로 다른 lockTable
```

---

---

# Transfer Manager (TransferMgr) - 차량 경로 제어 시스템

차량의 이동 경로를 제어하고 edge 전환을 관리하는 시스템입니다. MQTT 명령, Loop, Random, Auto Route 등 다양한 모드를 지원합니다.

## 개념 (왜 이렇게 설계했나)

### 문제: 다양한 경로 제어 요구사항

차량 시뮬레이션에는 여러 가지 경로 제어 방식이 필요합니다.

```
요구사항:
┌─────────────────────────────────────────────────────────────────┐
│ 1. MQTT 명령으로 차량 제어 (외부 시스템)                         │
│    → "VEH0: Edge A로 이동, 그 다음 Edge B, Edge C"              │
│                                                                  │
│ 2. 고정 루프 주행 (테스트용)                                     │
│    → [E001 → E002 → E003 → E001] 반복                           │
│                                                                  │
│ 3. 랜덤 주행 (시뮬레이션)                                        │
│    → 분기점에서 랜덤하게 선택                                    │
│                                                                  │
│ 4. 자동 경로 배정 (실제 운영 시뮬레이션)                          │
│    → 목적지 자동 배정 + 최단 경로 계산                           │
└─────────────────────────────────────────────────────────────────┘
```

### 해결: TransferMgr (통합 경로 제어)

**TransferMgr**이 모든 경로 제어 방식을 통합 관리합니다.

```
TransferMgr 아키텍처:
┌─────────────────────────────────────────────────────────────────┐
│                      TransferMgr                                 │
│                                                                  │
│  ┌───────────────────────────────────────────────────────┐      │
│  │ MQTT Command Queue (VehicleCommand)                  │      │
│  │                                                        │      │
│  │  VEH0: { path: ["E001", "E002", "E003"] }            │      │
│  │  VEH1: { nextEdgeId: "E005", targetRatio: 0.8 }      │      │
│  └───────────────────────────────────────────────────────┘      │
│                           ↓                                      │
│  ┌───────────────────────────────────────────────────────┐      │
│  │ Reservation System                                    │      │
│  │                                                        │      │
│  │  reservedNextEdges: Map<vehId, ReservedEdge[]>       │      │
│  │  reservedPaths: Map<vehId, PathCommand[]>            │      │
│  └───────────────────────────────────────────────────────┘      │
│                           ↓                                      │
│  ┌───────────────────────────────────────────────────────┐      │
│  │ Transfer Queue Processing                             │      │
│  │                                                        │      │
│  │  Mode 선택:                                            │      │
│  │  - MQTT_CONTROL → Reserved Command 사용               │      │
│  │  - LOOP → Loop Sequence 사용                          │      │
│  │  - RANDOM → Random Selection                          │      │
│  │  - AUTO_ROUTE → AutoMgr 연동                          │      │
│  └───────────────────────────────────────────────────────┘      │
│                           ↓                                      │
│              Next Edge 결정 → Vehicle 이동                       │
└─────────────────────────────────────────────────────────────────┘
```

### 핵심 설계 원칙

| 원칙 | 설명 |
|------|------|
| **명령 큐 시스템** | 여러 edge를 미리 예약하여 연속 이동 |
| **모드 독립성** | 각 모드의 로직이 독립적으로 동작 |
| **검증 우선** | Edge 연결성을 사전 검증하여 오류 방지 |
| **상태 동기화** | SharedMemory와 실시간 동기화 |

---

## 시스템 아키텍처

### 1. VehicleCommand (명령 구조)

MQTT를 통해 전달되는 차량 제어 명령입니다.

```typescript
export interface VehicleCommand {
  /** Target position on current edge (0~1) */
  targetRatio?: number;
  /** Next edge ID to transition to */
  nextEdgeId?: string;
  /** Path array for multi-edge reservation */
  path?: Array<{edgeId: string; targetRatio?: number}>;
}
```

**명령 타입:**

```
타입 1: 현재 Edge 내 이동
┌─────────────────────────────────────────────────────────────────┐
│ { targetRatio: 0.8 }                                             │
│                                                                  │
│  Edge A (현재)                                                   │
│  ●────────────────────────────────►●                            │
│  0.0                            0.8 (목표)                       │
│                                                                  │
│  → Edge 내에서만 이동 (edge 전환 없음)                           │
└─────────────────────────────────────────────────────────────────┘

타입 2: 단일 Edge 전환
┌─────────────────────────────────────────────────────────────────┐
│ { nextEdgeId: "E002", targetRatio: 0.5 }                        │
│                                                                  │
│  Edge A (현재)           Edge B (다음)                           │
│  ●───────────────►●───►●──────────►●                           │
│                   1.0    0.0     0.5 (목표)                     │
│                                                                  │
│  → Edge A 끝까지 → Edge B로 전환 → 0.5 위치까지                 │
└─────────────────────────────────────────────────────────────────┘

타입 3: 다중 Edge 경로
┌─────────────────────────────────────────────────────────────────┐
│ { path: [                                                        │
│     { edgeId: "E002" },                                          │
│     { edgeId: "E003" },                                          │
│     { edgeId: "E004", targetRatio: 0.5 }                        │
│   ]                                                              │
│ }                                                                │
│                                                                  │
│  Edge A   Edge B   Edge C   Edge D                               │
│  ●───►●───►●───►●───►●───►●───►●                              │
│        1.0      1.0      1.0  0.5 (목표)                        │
│                                                                  │
│  → A → B → C → D(0.5) 순차 이동                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 2. Reservation System (예약 시스템)

차량이 이동할 Edge들을 미리 예약합니다.

```typescript
export class TransferMgr {
  // 단일 edge 예약 (타입 2)
  private readonly reservedNextEdges: Map<number, ReservedEdge[]> = new Map();

  // 다중 edge 경로 예약 (타입 3)
  private readonly reservedPaths: Map<number, Array<ReservedEdge>> = new Map();
}

interface ReservedEdge {
  edgeId: string;
  targetRatio?: number;
}
```

**예약 시스템 동작:**

```
VEH0의 예약 상태:
┌─────────────────────────────────────────────────────────────────┐
│ reservedPaths: {                                                 │
│   0: [                          ← VEH0의 경로                    │
│     { edgeId: "E002" },         ← 다음 edge                      │
│     { edgeId: "E003" },         ← 그 다음 edge                   │
│     { edgeId: "E004", targetRatio: 0.5 }  ← 최종 목적지          │
│   ]                                                              │
│ }                                                                │
│                                                                  │
│ 이동 시퀀스:                                                     │
│   1. Edge 끝 도달 → processTransferQueue 호출                    │
│   2. reservedPaths[0].shift() → "E002" 꺼내기                   │
│   3. reservedNextEdges[0] = [{ edgeId: "E002", targetRatio: 1 }]│
│   4. nextEdge = "E002" 설정                                      │
│   5. Edge 전환 완료 → reservedNextEdges[0].shift()              │
│   6. 반복...                                                     │
└─────────────────────────────────────────────────────────────────┘
```

### 3. Transfer Queue (전환 대기열)

차량이 edge 끝에 도달하면 **transferQueue**에 추가됩니다.

```typescript
export class TransferMgr {
  private transferQueue: number[] = [];

  // Edge 끝 도달 시 호출 (movementUpdate.ts)
  enqueueVehicleTransfer(vehicleIndex: number) {
    this.transferQueue.push(vehicleIndex);
  }

  // 매 프레임 처리
  processTransferQueue(
    vehicleDataArray: IVehicleDataArray,
    edgeArray: Edge[],
    vehicleLoopMap: Map<number, VehicleLoop>,
    edgeNameToIndex: Map<string, number>,
    mode: TransferMode
  ) {
    for (const vehId of this.transferQueue) {
      const nextEdge = this.determineNextEdge(vehId, mode, ...);
      // SharedMemory 업데이트
      data[ptr + MovementData.NEXT_EDGE] = nextEdge;
      data[ptr + MovementData.NEXT_EDGE_STATE] = NextEdgeState.READY;
    }
    this.transferQueue = [];
  }
}
```

**Transfer Queue 흐름:**

```
프레임 N:
┌─────────────────────────────────────────────────────────────────┐
│ 1. movementUpdate 실행                                           │
│    VEH0: currentRatio = 0.99 → 1.0 (Edge 끝 도달)               │
│    → transferMgr.enqueueVehicleTransfer(0)                      │
│                                                                  │
│    transferQueue: [0]                                           │
│                                                                  │
│ 2. processTransferQueue 실행                                     │
│    VEH0 처리:                                                    │
│    - mode = MQTT_CONTROL                                         │
│    - reservedPaths[0] 확인 → "E002" 발견                        │
│    - data[NEXT_EDGE] = edgeIndex("E002")                        │
│    - data[NEXT_EDGE_STATE] = READY                              │
│                                                                  │
│    transferQueue: [] (비워짐)                                    │
│                                                                  │
│ 3. 다음 프레임에서 VEH0이 E002로 전환                            │
└─────────────────────────────────────────────────────────────────┘
```

---

## 전송 모드 (TransferMode)

4가지 전송 모드를 지원합니다.

```typescript
export const TransferMode = {
  MQTT_CONTROL: 0,  // MQTT 명령으로 제어
  LOOP: 1,          // 고정 루프 반복
  RANDOM: 2,        // 랜덤 선택
  AUTO_ROUTE: 3,    // 자동 경로 배정 (AutoMgr)
} as const;
```

### 1. MQTT_CONTROL (외부 명령)

MQTT를 통해 전달된 명령에 따라 이동합니다.

```typescript
private getNextEdgeFromCommand(
  vehicleIndex: number,
  edgeNameToIndex: Map<string, number>
): number {
  // 1. Path 큐 우선 확인
  const activePathEdge = this.handlePathQueue(vehicleIndex, edgeNameToIndex);
  if (activePathEdge !== null) {
    return activePathEdge;
  }

  // 2. Manual reservation 확인
  const queue = this.reservedNextEdges.get(vehicleIndex);
  if (queue && queue.length > 0) {
    const nextReserved = queue[0];
    const idx = edgeNameToIndex.get(nextReserved.edgeId);
    if (idx !== undefined) {
      return idx;
    }
  }

  // 3. 명령 없으면 -1 (정지)
  return -1;
}
```

**시나리오:**

```
MQTT 명령:
  VEH0: { path: ["E002", "E003", "E004"] }

처리 순서:
┌─────────────────────────────────────────────────────────────────┐
│ 1. assignCommand 호출                                            │
│    reservedPaths[0] = [                                          │
│      { edgeId: "E002" },                                         │
│      { edgeId: "E003" },                                         │
│      { edgeId: "E004" }                                          │
│    ]                                                             │
│    data[TARGET_RATIO] = 1.0  ← 현재 edge 끝까지 이동             │
│                                                                  │
│ 2. Edge 끝 도달 → processTransferQueue                           │
│    - handlePathQueue 호출                                        │
│    - reservedPaths[0].shift() → "E002"                          │
│    - reservedNextEdges[0] = [{ edgeId: "E002", targetRatio: 1 }]│
│    - return edgeIndex("E002")                                   │
│                                                                  │
│ 3. Edge 전환 → "E002"로 이동                                     │
│    - consumeNextEdgeReservation(0)                              │
│    - reservedNextEdges[0].shift() → { targetRatio: 1 }          │
│    - data[TARGET_RATIO] = 1.0                                   │
│                                                                  │
│ 4. 반복 (E003, E004)                                             │
└─────────────────────────────────────────────────────────────────┘
```

### 2. LOOP (고정 루프)

미리 정의된 edge 시퀀스를 반복 주행합니다.

```typescript
export type VehicleLoop = {
  edgeSequence: string[];  // 예: ["E001", "E002", "E003"]
};

export function getNextEdgeInLoop(
  currentEdgeName: string,
  sequence: string[]
): string {
  const idx = sequence.indexOf(currentEdgeName);
  if (idx === -1) return sequence[0];
  return sequence[(idx + 1) % sequence.length];  // 순환
}
```

**시나리오:**

```
Loop 설정:
  VEH0: { edgeSequence: ["E001", "E002", "E003"] }

동작:
┌─────────────────────────────────────────────────────────────────┐
│  E001 ──► E002 ──► E003 ──► E001 ──► E002 ──► ...               │
│   ↑                           │                                  │
│   └───────────────────────────┘  (순환)                         │
│                                                                  │
│  VEH0이 E001 끝 도달:                                            │
│  → getNextEdgeInLoop("E001", ["E001", "E002", "E003"])          │
│  → return "E002"                                                │
│                                                                  │
│  VEH0이 E003 끝 도달:                                            │
│  → getNextEdgeInLoop("E003", ["E001", "E002", "E003"])          │
│  → return "E001"  (순환)                                        │
└─────────────────────────────────────────────────────────────────┘
```

### 3. RANDOM (랜덤 선택)

분기점에서 랜덤하게 다음 edge를 선택합니다.

```typescript
private getNextEdgeRandomly(currentEdge: Edge): number {
  if ((currentEdge.nextEdgeIndices?.length ?? 0) > 0) {
    const randomIndex = Math.floor(
      Math.random() * currentEdge.nextEdgeIndices!.length
    );
    return currentEdge.nextEdgeIndices![randomIndex];
  }
  return -1;
}
```

**시나리오:**

```
분기점:
         ┌──► E002 (확률 33%)
         │
  E001 ──┼──► E003 (확률 33%)
         │
         └──► E004 (확률 33%)

VEH0이 E001 끝 도달:
  nextEdgeIndices = [2, 3, 4]  (E002, E003, E004의 인덱스)
  randomIndex = floor(random() * 3) = 0, 1, or 2
  return nextEdgeIndices[randomIndex]

→ E002, E003, E004 중 하나로 랜덤 이동
```

### 4. AUTO_ROUTE (자동 경로 배정)

**AutoMgr**과 연동하여 자동으로 목적지를 배정합니다. (다음 섹션 참조)

---

## 명령 처리 흐름

### assignCommand (명령 할당)

외부(MQTT)에서 명령을 받아 차량에 할당합니다.

```typescript
assignCommand(
  vehId: number,
  command: VehicleCommand,
  vehicleDataArray: IVehicleDataArray,
  edgeArray: Edge[],
  edgeNameToIndex: Map<string, number>
) {
  const { targetRatio, nextEdgeId, path } = command;

  // 1. Path 명령 처리 (다중 edge)
  if (path && path.length > 0) {
    this.processPathCommand(vehId, path, currentEdge, ...);
  }

  // 2. 단일 edge 이동
  if (!nextEdgeId || nextEdgeId === currentEdge.edge_name) {
    // 2-a. 같은 edge 내 이동
    this.processSameEdgeCommand(vehId, targetRatio, ...);
  } else {
    // 2-b. Edge 전환
    this.processEdgeTransitionCommand(vehId, nextEdgeId, ...);
  }

  // 3. 차량 깨우기 (STOPPED → MOVING)
  this.ensureVehicleAwake(data, ptr, vehId);
}
```

**검증 과정:**

```
명령 검증:
┌─────────────────────────────────────────────────────────────────┐
│ Case 1: 같은 Edge 내 이동                                        │
│   { targetRatio: 0.8 }                                           │
│                                                                  │
│   검증: targetRatio > currentRatio                               │
│   ✅ 0.8 > 0.5 → 유효                                            │
│   ❌ 0.3 < 0.5 → 무시 (뒤로 못 감)                               │
│                                                                  │
│ Case 2: Edge 전환                                                │
│   { nextEdgeId: "E002" }                                         │
│                                                                  │
│   검증: nextEdgeId in currentEdge.nextEdgeIndices                │
│   ✅ "E002" in ["E002", "E003"] → 유효                           │
│   ❌ "E099" not in [...] → 무시 (연결 안 됨)                     │
│                                                                  │
│ Case 3: Path 명령                                                │
│   { path: ["E002", "E003", "E004"] }                            │
│                                                                  │
│   검증: 전체 경로 연결성 확인                                     │
│   - E001 → E002 연결?                                            │
│   - E002 → E003 연결?                                            │
│   - E003 → E004 연결?                                            │
│   ✅ 모두 연결됨 → 유효                                          │
│   ❌ 하나라도 끊김 → 전체 무시                                   │
└─────────────────────────────────────────────────────────────────┘
```

### processPathCommand (경로 검증 및 예약)

다중 edge 경로를 검증하고 예약합니다.

```typescript
private processPathCommand(
  vehId: number,
  path: Array<{ edgeId: string; targetRatio?: number }>,
  currentEdge: Edge,
  edgeArray: Edge[],
  edgeNameToIndex: Map<string, number>,
  data: Float32Array,
  ptr: number
) {
  // 1. 기존 예약 삭제
  this.reservedNextEdges.delete(vehId);

  // 2. 경로 검증 (전체 경로가 연결되어 있는지)
  let prevEdge = currentEdge;
  for (const pathItem of path) {
    const pathEdgeId = pathItem.edgeId;
    const pathEdgeIndex = edgeNameToIndex.get(pathEdgeId);

    if (pathEdgeIndex === undefined) {
      console.error(`Path edge ${pathEdgeId} not found`);
      return;
    }

    if (!prevEdge.nextEdgeIndices?.includes(pathEdgeIndex)) {
      console.error(`Path edge ${pathEdgeId} not connected to ${prevEdge.edge_name}`);
      return;
    }

    prevEdge = edgeArray[pathEdgeIndex];
  }

  // 3. 검증 통과 → 예약
  this.reservedPaths.set(vehId, path.map(p => ({
    edgeId: p.edgeId,
    targetRatio: p.targetRatio
  })));

  // 4. 현재 edge 끝까지 이동
  data[ptr + MovementData.TARGET_RATIO] = 1;
}
```

---

## 코드 가이드 (API, 사용법)

### TransferMgr 생성 및 초기화

```typescript
// FabContext.ts
import { TransferMgr } from "@/common/vehicle/logic/TransferMgr";

class FabContext {
  private readonly transferMgr: TransferMgr;

  constructor() {
    this.transferMgr = new TransferMgr();
  }
}
```

### MQTT 명령 처리

```typescript
// MQTT 메시지 수신
function handleMqttMessage(topic: string, message: string) {
  const command: VehicleCommand = JSON.parse(message);
  const vehId = extractVehicleId(topic);

  // 명령 할당
  transferMgr.assignCommand(
    vehId,
    command,
    vehicleDataArray,
    edgeArray,
    edgeNameToIndex
  );
}

// 예시 명령:
// { "targetRatio": 0.8 }
// { "nextEdgeId": "E002", "targetRatio": 0.5 }
// { "path": [
//     { "edgeId": "E002" },
//     { "edgeId": "E003", "targetRatio": 0.5 }
//   ]
// }
```

### Transfer Queue 처리

```typescript
// SimulationEngine.ts
function simulationStep(deltaTime: number) {
  // 1. 차량 이동 업데이트
  for (const context of fabContexts.values()) {
    context.updateMovement(deltaTime);
    // → movementUpdate.ts에서 edge 끝 도달 시
    //   transferMgr.enqueueVehicleTransfer(vehId) 호출
  }

  // 2. Transfer Queue 처리
  for (const context of fabContexts.values()) {
    context.transferMgr.processTransferQueue(
      context.vehicleDataArray,
      context.edges,
      context.vehicleLoopMap,
      context.edgeNameToIndex,
      context.transferMode
    );
  }
}
```

### Loop 설정

```typescript
// vehicleLoopMap 초기화
const vehicleLoopMap = new Map<number, VehicleLoop>();

// VEH0에게 루프 할당
vehicleLoopMap.set(0, {
  edgeSequence: ["E001", "E002", "E003"]
});

// processTransferQueue에 전달
transferMgr.processTransferQueue(
  vehicleDataArray,
  edgeArray,
  vehicleLoopMap,  // ← Loop 맵
  edgeNameToIndex,
  TransferMode.LOOP
);
```

---

# Auto Manager (AutoMgr) - 자동 경로 배정 시스템

AUTO_ROUTE 모드에서 차량에게 자동으로 목적지를 배정하고 최단 경로를 계산하는 시스템입니다.

## 개념 (왜 이렇게 설계했나)

### 문제: 실제 운영 시뮬레이션

실제 공장처럼 동작하는 시뮬레이션을 위해서는:

```
요구사항:
┌─────────────────────────────────────────────────────────────────┐
│ 1. 차량이 목적지(Station)로 자동 이동                            │
│    → 현재 위치에서 목적지까지 최단 경로 계산                     │
│                                                                  │
│ 2. 도착 후 다음 목적지 자동 배정                                 │
│    → 유휴 차량 없이 계속 운행                                    │
│                                                                  │
│ 3. 성능 최적화                                                   │
│    → 매 프레임 수백 대 경로 계산은 불가능                        │
│    → 프레임당 제한 + Round-Robin 분산                            │
│                                                                  │
│ 4. 구역 분리 (멀티 FAB)                                          │
│    → 서로 연결 안 된 구역끼리 경로 탐색 방지                     │
└─────────────────────────────────────────────────────────────────┘
```

### 해결: AutoMgr (자동 배정 + 최적화)

```
AutoMgr 아키텍처:
┌─────────────────────────────────────────────────────────────────┐
│                        AutoMgr                                   │
│                                                                  │
│  ┌───────────────────────────────────────────────────────┐      │
│  │ Station Database                                      │      │
│  │                                                        │      │
│  │  stations: [                                           │      │
│  │    { name: "ST001", edgeIndex: 5, regionId: 0 },     │      │
│  │    { name: "ST002", edgeIndex: 12, regionId: 0 },    │      │
│  │    { name: "ST003", edgeIndex: 45, regionId: 1 }     │      │
│  │  ]                                                     │      │
│  └───────────────────────────────────────────────────────┘      │
│                           ↓                                      │
│  ┌───────────────────────────────────────────────────────┐      │
│  │ Region Mapping (BFS)                                  │      │
│  │                                                        │      │
│  │  edgeToRegion: Map<edgeIdx, regionId>                │      │
│  │  regionStations: Map<regionId, Station[]>            │      │
│  │                                                        │      │
│  │  → 같은 구역 내에서만 경로 배정                       │      │
│  └───────────────────────────────────────────────────────┘      │
│                           ↓                                      │
│  ┌───────────────────────────────────────────────────────┐      │
│  │ Round-Robin + Frame Limit                             │      │
│  │                                                        │      │
│  │  nextVehicleIndex = 0                                 │      │
│  │  pathFindCountThisFrame = 0                           │      │
│  │  MAX_PATH_FINDS_PER_FRAME = 10                        │      │
│  │                                                        │      │
│  │  → 매 프레임 최대 10대만 경로 계산                    │      │
│  │  → 다음 프레임은 11번째 차량부터                      │      │
│  └───────────────────────────────────────────────────────┘      │
│                           ↓                                      │
│  ┌───────────────────────────────────────────────────────┐      │
│  │ Pathfinding (Dijkstra)                                │      │
│  │                                                        │      │
│  │  findShortestPath(currentEdge, targetEdge, edgeArray) │      │
│  │  → [E001, E005, E012, E023]                           │      │
│  │  → TransferMgr.assignCommand({ path: [...] })        │      │
│  └───────────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────────┘
```

### 핵심 설계 원칙

| 원칙 | 설명 |
|------|------|
| **구역 기반 배정** | BFS로 연결된 edge를 구역으로 분류, 같은 구역 내에서만 배정 |
| **프레임 분산** | Round-Robin + 프레임당 최대 10대 경로 계산 |
| **경로 캐싱** | 계산된 경로는 TransferMgr에 예약되어 재사용 |
| **실패 재시도** | 경로 탐색 실패 시 다른 Station 시도 (최대 5번) |

---

## 시스템 아키텍처

### 1. Station Database

스테이션(목적지) 정보를 관리합니다.

```typescript
interface StationTarget {
  name: string;        // 스테이션 이름 (예: "ST001")
  edgeIndex: number;   // 스테이션이 위치한 edge 인덱스
  regionId?: number;   // 속한 구역 ID
}

export class AutoMgr {
  private stations: StationTarget[] = [];

  initStations(
    stationData: StationRawData[],
    edgeNameToIndex: Map<string, number>,
    edgeArray?: Edge[]
  ) {
    // 1. Station 목록 생성
    for (const station of stationData) {
      if (station.nearest_edge) {
        const edgeIdx = edgeNameToIndex.get(station.nearest_edge);
        if (edgeIdx !== undefined) {
          this.stations.push({
            name: station.station_name,
            edgeIndex: edgeIdx
          });
        }
      }
    }

    // 2. 구역 매핑
    if (edgeArray && this.stations.length > 0) {
      this.buildRegionMapping(edgeArray);
    }
  }
}
```

**시각화:**

```
Station 배치:
┌─────────────────────────────────────────────────────────────────┐
│                    Region 0 (연결됨)                             │
│                                                                  │
│   E001 ──► E002 ──► E003                                         │
│    │        │        │                                           │
│   ST001   ST002    ST003                                         │
│                                                                  │
│   stations: [                                                    │
│     { name: "ST001", edgeIndex: 1, regionId: 0 },               │
│     { name: "ST002", edgeIndex: 2, regionId: 0 },               │
│     { name: "ST003", edgeIndex: 3, regionId: 0 }                │
│   ]                                                              │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                    Region 1 (분리됨)                             │
│                                                                  │
│   E045 ──► E046                                                  │
│    │        │                                                    │
│   ST010   ST011                                                  │
│                                                                  │
│   stations: [                                                    │
│     { name: "ST010", edgeIndex: 45, regionId: 1 },              │
│     { name: "ST011", edgeIndex: 46, regionId: 1 }               │
│   ]                                                              │
└─────────────────────────────────────────────────────────────────┘
```

### 2. Region Mapping (구역 분류)

BFS로 연결된 edge들을 구역(Region)으로 분류합니다.

```typescript
private buildRegionMapping(edgeArray: Edge[]) {
  // 1. 역방향 인덱스 구축 (O(E))
  const prevEdges = this.buildReverseEdgeIndex(edgeArray);

  // 2. BFS로 edge들을 구역에 할당
  this.assignEdgesToRegions(edgeArray, prevEdges);

  // 3. 스테이션을 구역별로 분류
  this.classifyStationsByRegion();
}

private buildReverseEdgeIndex(edgeArray: Edge[]): number[][] {
  const prevEdges: number[][] = Array.from({ length: edgeArray.length }, () => []);

  for (let i = 0; i < edgeArray.length; i++) {
    const nextIndices = edgeArray[i]?.nextEdgeIndices || [];
    for (const next of nextIndices) {
      if (next < prevEdges.length) {
        prevEdges[next].push(i);  // next로 들어오는 edge가 i
      }
    }
  }

  return prevEdges;
}

private assignEdgesToRegions(edgeArray: Edge[], prevEdges: number[][]): void {
  const visited = new Set<number>();
  let regionId = 0;

  for (let startEdge = 0; startEdge < edgeArray.length; startEdge++) {
    if (visited.has(startEdge)) continue;

    // BFS로 연결된 모든 edge 탐색
    this.exploreRegion(startEdge, regionId, edgeArray, prevEdges, visited);
    regionId++;
  }
}
```

**BFS 동작:**

```
Edge 연결 구조:
┌─────────────────────────────────────────────────────────────────┐
│  E001 → E002 → E003    (Region 0)                               │
│    ↑      ↓                                                      │
│    └───  E004                                                    │
│                                                                  │
│  E010 → E011           (Region 1, 분리됨)                        │
│                                                                  │
│  E020                  (Region 2, 고립됨)                        │
└─────────────────────────────────────────────────────────────────┘

BFS 실행:
┌─────────────────────────────────────────────────────────────────┐
│ 1. startEdge = 0 (E001)                                          │
│    visited = {}, regionId = 0                                   │
│                                                                  │
│    BFS: [E001] → [E002, E004] → [E003] → []                    │
│    edgeToRegion: { 0→0, 1→0, 2→0, 3→0 }                       │
│    visited = {0, 1, 2, 3}                                       │
│                                                                  │
│ 2. startEdge = 10 (E010)                                         │
│    visited = {0,1,2,3}, regionId = 1                            │
│                                                                  │
│    BFS: [E010] → [E011] → []                                    │
│    edgeToRegion: { ..., 10→1, 11→1 }                           │
│    visited = {0,1,2,3,10,11}                                    │
│                                                                  │
│ 3. startEdge = 20 (E020)                                         │
│    regionId = 2                                                 │
│                                                                  │
│    BFS: [E020] → []                                             │
│    edgeToRegion: { ..., 20→2 }                                 │
└─────────────────────────────────────────────────────────────────┘

최종 구역 매핑:
  edgeToRegion: Map {
    0 → 0, 1 → 0, 2 → 0, 3 → 0,    (Region 0)
    10 → 1, 11 → 1,                (Region 1)
    20 → 2                          (Region 2)
  }

  regionStations: Map {
    0 → [ST001, ST002, ST003],     (Region 0 스테이션들)
    1 → [ST010, ST011],            (Region 1 스테이션들)
    2 → []                          (Region 2 스테이션 없음)
  }
```

### 3. Round-Robin + Frame Limit

매 프레임 최대 10대만 경로를 계산하고, 다음 프레임은 이어서 처리합니다.

```typescript
const MAX_PATH_FINDS_PER_FRAME = 10;

export class AutoMgr {
  private nextVehicleIndex = 0;
  private pathFindCountThisFrame = 0;

  update(
    mode: TransferMode,
    numVehicles: number,
    vehicleDataArray: IVehicleDataArray,
    edgeArray: Edge[],
    edgeNameToIndex: Map<string, number>,
    transferMgr: TransferMgr
  ) {
    if (mode !== TransferMode.AUTO_ROUTE) return;

    // 프레임 시작: 카운터 리셋
    this.pathFindCountThisFrame = 0;

    const startIndex = this.nextVehicleIndex;

    for (let i = 0; i < numVehicles; i++) {
      // 프레임당 제한 도달
      if (this.pathFindCountThisFrame >= MAX_PATH_FINDS_PER_FRAME) {
        break;
      }

      const vehId = (startIndex + i) % numVehicles;
      const didAssign = this.checkAndAssignRoute(vehId, ...);

      if (didAssign) {
        this.nextVehicleIndex = (vehId + 1) % numVehicles;
      }
    }
  }
}
```

**Round-Robin 시나리오:**

```
차량: VEH0 ~ VEH49 (총 50대)
MAX_PATH_FINDS_PER_FRAME = 10

프레임 1:
  startIndex = 0
  처리: VEH0 ~ VEH9 (10대)
  nextVehicleIndex = 10

프레임 2:
  startIndex = 10
  처리: VEH10 ~ VEH19 (10대)
  nextVehicleIndex = 20

프레임 3:
  startIndex = 20
  처리: VEH20 ~ VEH29 (10대)
  nextVehicleIndex = 30

...

프레임 5:
  startIndex = 40
  처리: VEH40 ~ VEH49 (10대)
  nextVehicleIndex = 0  (순환)

프레임 6:
  startIndex = 0
  처리: VEH0 ~ VEH9
  ...

→ 5 프레임마다 모든 차량 체크 (60fps 기준 0.083초)
```

### 4. 경로 배정 로직

```typescript
private checkAndAssignRoute(
  vehId: number,
  vehicleDataArray: IVehicleDataArray,
  edgeArray: Edge[],
  edgeNameToIndex: Map<string, number>,
  transferMgr: TransferMgr
): boolean {
  // 1. 이미 명령이 있으면 스킵
  if (transferMgr.hasPendingCommands(vehId)) return false;

  const data = vehicleDataArray.getData();
  const ptr = vehId * VEHICLE_DATA_SIZE;
  const currentEdgeIdx = Math.trunc(data[ptr + MovementData.CURRENT_EDGE]);

  // 2. 랜덤 목적지 배정
  return this.assignRandomDestination(vehId, currentEdgeIdx, ...);
}

assignRandomDestination(
  vehId: number,
  currentEdgeIdx: number,
  ...
): boolean {
  // 1. 현재 edge의 구역에서 스테이션 가져오기
  const availableStations = this.getStationsForEdge(currentEdgeIdx);

  if (availableStations.length === 0) {
    return false;
  }

  const MAX_ATTEMPTS = 5;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    // 2. 랜덤 스테이션 선택
    const candidate = availableStations[Math.floor(Math.random() * availableStations.length)];

    // 3. 현재 edge와 같으면 스킵 (다른 후보 선택)
    if (candidate.edgeIndex === currentEdgeIdx && availableStations.length > 1) {
      continue;
    }

    // 4. 경로 탐색 (Dijkstra)
    this.pathFindCountThisFrame++;
    const pathIndices = findShortestPath(currentEdgeIdx, candidate.edgeIndex, edgeArray);

    if (pathIndices && pathIndices.length > 0) {
      // 5. 경로를 VehicleCommand로 변환
      const pathCommand = this.constructPathCommand(pathIndices, edgeArray);

      const command: VehicleCommand = {
        path: pathCommand
      };

      // 6. 목적지 저장 (UI용)
      this.vehicleDestinations.set(vehId, { stationName: candidate.name, edgeIndex: candidate.edgeIndex });

      // 7. SharedMemory 업데이트
      data[ptr + LogicData.DESTINATION_EDGE] = candidate.edgeIndex;
      data[ptr + LogicData.PATH_REMAINING] = pathCommand.length;

      // 8. TransferMgr에 명령 할당
      transferMgr.assignCommand(vehId, command, vehicleDataArray, edgeArray, edgeNameToIndex);
      return true;
    }
  }

  return false;
}
```

**시나리오:**

```
VEH0 상태:
  currentEdge: E001 (regionId = 0)
  hasPendingCommands: false (유휴 상태)

1. getStationsForEdge(E001)
   → regionId = 0
   → regionStations.get(0) = [ST001(E005), ST002(E012), ST003(E023)]

2. 랜덤 선택:
   candidate = ST002 (E012)

3. 경로 탐색:
   findShortestPath(E001, E012, edgeArray)
   → [E001, E002, E005, E012]

4. 명령 생성:
   command = {
     path: [
       { edgeId: "E002" },
       { edgeId: "E005" },
       { edgeId: "E012", targetRatio: 0.5 }  ← 목적지는 중간 위치
     ]
   }

5. TransferMgr 할당:
   transferMgr.assignCommand(0, command, ...)
   → reservedPaths[0] = [...]
   → data[TARGET_RATIO] = 1.0

6. SharedMemory 업데이트:
   data[DESTINATION_EDGE] = 12
   data[PATH_REMAINING] = 3

→ VEH0이 E001 → E002 → E005 → E012(0.5) 경로로 이동
```

---

## 코드 가이드 (API, 사용법)

### AutoMgr 생성 및 초기화

```typescript
// FabContext.ts
import { AutoMgr } from "@/common/vehicle/logic/AutoMgr";

class FabContext {
  private readonly autoMgr: AutoMgr;

  constructor(params: FabInitParams) {
    this.autoMgr = new AutoMgr();

    // Station 데이터로 초기화
    this.autoMgr.initStations(
      params.stationData,    // Station 목록
      this.edgeNameToIndex,  // Edge 이름 → 인덱스 맵
      this.edges             // Edge 배열 (구역 매핑용)
    );
  }
}
```

### 매 프레임 업데이트

```typescript
// SimulationEngine.ts
function simulationStep(deltaTime: number) {
  for (const context of fabContexts.values()) {
    // AUTO_ROUTE 모드일 때만 실행
    context.autoMgr.update(
      context.transferMode,      // TransferMode.AUTO_ROUTE
      context.numVehicles,       // 차량 수
      context.vehicleDataArray,  // SharedMemory
      context.edges,             // Edge 배열
      context.edgeNameToIndex,   // Edge 맵
      context.transferMgr        // TransferMgr 인스턴스
    );
  }
}
```

### 목적지 정보 조회

```typescript
// UI에서 차량의 목적지 표시
function displayVehicleDestination(vehId: number) {
  const destInfo = autoMgr.getDestinationInfo(vehId);

  if (destInfo) {
    console.log(`VEH${vehId} → ${destInfo.stationName} (Edge ${destInfo.edgeIndex})`);
  }
}
```

### Cleanup

```typescript
// FabContext 종료 시
class FabContext {
  dispose() {
    this.autoMgr.dispose();  // 메모리 해제
  }
}
```

---

## 성능 최적화

### 1. Region 기반 필터링

같은 구역 내에서만 경로 배정하여 불필요한 경로 탐색을 방지합니다.

```
❌ Region 없이:
  VEH0 (E001, Region 0)
  → 모든 스테이션 후보: [ST001, ST002, ..., ST099]
  → findShortestPath(E001, ST050) → 실패 (연결 안 됨)
  → 시간 낭비

✅ Region 기반:
  VEH0 (E001, Region 0)
  → 같은 Region 0 스테이션만: [ST001, ST002, ST003]
  → 모두 연결 보장
  → 탐색 성공률 100%
```

### 2. 프레임당 제한

매 프레임 최대 10대만 처리하여 스파이크를 방지합니다.

```
성능 비교 (60fps, 100대 차량):

❌ 제한 없음:
  - 모든 차량이 동시에 유휴 상태
  - 100개 경로 탐색 (Dijkstra)
  - 프레임 시간: 80ms → 12fps 드롭!

✅ 프레임당 10대:
  - 10개 경로 탐색
  - 프레임 시간: 8ms → 60fps 유지
  - 10 프레임 후 모든 차량 처리 완료 (0.16초)
```

### 3. 조기 중단 (Early Exit)

이미 명령이 있는 차량은 스킵합니다.

```typescript
// ✅ 조기 중단
if (transferMgr.hasPendingCommands(vehId)) return false;

// 명령이 있는 차량 비율이 높을수록 성능 향상
// 예: 80%가 이동 중 → 실제 처리 2대 → 프레임 시간 대폭 감소
```

### 4. 재시도 제한

경로 탐색 실패 시 최대 5번만 재시도합니다.

```typescript
const MAX_ATTEMPTS = 5;

for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
  // 랜덤 스테이션 선택 + 경로 탐색
  // 성공하면 즉시 return
}

// 5번 실패하면 다음 프레임에서 재시도
```

---

## 주의사항

### 1. Station 데이터 필수

`initStations`를 호출하지 않으면 목적지 배정이 불가능합니다.

```typescript
// ❌ 초기화 누락
const autoMgr = new AutoMgr();
autoMgr.update(...);  // stations.length = 0 → 아무것도 안 함

// ✅ 올바른 초기화
const autoMgr = new AutoMgr();
autoMgr.initStations(stationData, edgeNameToIndex, edgeArray);
autoMgr.update(...);  // 정상 동작
```

### 2. TransferMode 확인

`AUTO_ROUTE` 모드가 아니면 `update()`가 즉시 리턴합니다.

```typescript
// ✅ AUTO_ROUTE 모드 설정
context.transferMode = TransferMode.AUTO_ROUTE;
autoMgr.update(context.transferMode, ...);

// ❌ 다른 모드
context.transferMode = TransferMode.MQTT_CONTROL;
autoMgr.update(context.transferMode, ...);  // 즉시 리턴
```

### 3. TransferMgr 연동

AutoMgr은 TransferMgr에 의존합니다.

```typescript
// ✅ 올바른 흐름
autoMgr.update(..., transferMgr);  // AutoMgr이 명령 생성
transferMgr.processTransferQueue(...);  // TransferMgr이 명령 실행

// ❌ TransferMgr 없이 사용 불가
autoMgr.update(..., undefined);  // 에러!
```

### 4. Region 분리 확인

구역이 분리된 맵에서는 각 구역별로 독립적으로 동작합니다.

```
맵 구조:
  Region 0: E001 ~ E030 (Station 10개)
  Region 1: E050 ~ E080 (Station 5개)  ← 분리됨

VEH0 (E001, Region 0):
  → Region 0 Station 중 랜덤 선택 (10개 중)
  → Region 1 Station은 후보에서 제외

VEH1 (E050, Region 1):
  → Region 1 Station 중 랜덤 선택 (5개 중)
  → Region 0 Station은 후보에서 제외
```

---

---

# Dijkstra Pathfinding - 최단 경로 탐색

AutoMgr에서 사용하는 Dijkstra 알고리즘 기반 최단 경로 탐색 시스템입니다.

## 개념 (왜 이렇게 설계했나)

### 문제: 효율적인 경로 탐색

차량이 목적지까지 이동할 최적 경로를 찾아야 합니다.

```
요구사항:
┌─────────────────────────────────────────────────────────────────┐
│ 1. 최단 경로 탐색                                                │
│    → Edge 거리 기반으로 가장 짧은 경로 찾기                      │
│                                                                  │
│ 2. 성능                                                          │
│    → 매 프레임 여러 차량의 경로 계산 (프레임당 최대 10대)        │
│    → 빠른 응답 속도 필요                                         │
│                                                                  │
│ 3. 캐싱                                                          │
│    → 같은 경로 반복 조회 시 재계산 방지                          │
│                                                                  │
│ 4. Zero-GC                                                       │
│    → 경로 계산 시 GC 최소화                                      │
│                                                                  │
│ 5. 확장 가능성 (향후)                                            │
│    → 단순 거리 → 거리 * cost (반송, 밸런싱)                     │
└─────────────────────────────────────────────────────────────────┘
```

### 해결: Dijkstra + Min-Heap + LRU Cache

```
Dijkstra 아키텍처:
┌─────────────────────────────────────────────────────────────────┐
│                   findShortestPath()                             │
│                                                                  │
│  ┌───────────────────────────────────────────────────────┐      │
│  │ 1. Cache 확인                                         │      │
│  │    pathCache.get("start:end")                         │      │
│  │    → Hit: 캐시된 경로 반환 (O(1))                    │      │
│  │    → Miss: Dijkstra 실행                              │      │
│  └───────────────────────────────────────────────────────┘      │
│                           ↓                                      │
│  ┌───────────────────────────────────────────────────────┐      │
│  │ 2. Dijkstra 알고리즘                                  │      │
│  │                                                        │      │
│  │  Min-Heap (Priority Queue):                           │      │
│  │    - push(edgeIndex, cost)      O(log V)              │      │
│  │    - pop() → min cost edge      O(log V)              │      │
│  │                                                        │      │
│  │  distArray[v] = min distance to v                     │      │
│  │  prevArray[v] = previous edge in path                 │      │
│  │                                                        │      │
│  │  while heap not empty:                                │      │
│  │    u = heap.pop()                                     │      │
│  │    for each neighbor v of u:                          │      │
│  │      weight = v.distance                              │      │
│  │      if distArray[u] + weight < distArray[v]:         │      │
│  │        distArray[v] = distArray[u] + weight           │      │
│  │        prevArray[v] = u                               │      │
│  │        heap.push(v, distArray[v])                     │      │
│  └───────────────────────────────────────────────────────┘      │
│                           ↓                                      │
│  ┌───────────────────────────────────────────────────────┐      │
│  │ 3. 경로 재구성 (reconstructPath)                      │      │
│  │    prevArray를 역추적하여 경로 생성                   │      │
│  │    [start, ..., end]                                  │      │
│  └───────────────────────────────────────────────────────┘      │
│                           ↓                                      │
│  ┌───────────────────────────────────────────────────────┐      │
│  │ 4. Cache 저장                                         │      │
│  │    pathCache.set("start:end", path)                   │      │
│  │    LRU 정책으로 오래된 항목 제거                      │      │
│  └───────────────────────────────────────────────────────┘      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 핵심 설계 원칙

| 원칙 | 설명 |
|------|------|
| **Min-Heap 사용** | O(E log V) 시간 복잡도 (배열 방식 O(V²)보다 빠름) |
| **LRU Cache** | 반복 조회 성능 향상 (최대 2000개 경로 캐싱) |
| **Zero-GC** | Heap, distArray, prevArray 재사용 |
| **거리 기반** | 현재는 edge.distance만 사용 (향후 확장 가능) |

---

## 시스템 아키텍처

### 1. Min-Heap Priority Queue

효율적인 우선순위 큐 구현입니다.

```typescript
class MinHeap {
  private heap: number[] = []; // [edgeIndex0, cost0, edgeIndex1, cost1, ...]
  private size = 0;

  push(edgeIndex: number, cost: number): void {
    // O(log V)
    const idx = this.size * 2;
    if (idx >= this.heap.length) {
      this.heap.push(edgeIndex, cost);
    } else {
      this.heap[idx] = edgeIndex;
      this.heap[idx + 1] = cost;
    }
    this.size++;
    this.bubbleUp(this.size - 1);
  }

  pop(): { edgeIndex: number; cost: number } | null {
    // O(log V)
    if (this.size === 0) return null;
    const edgeIndex = this.heap[0];
    const cost = this.heap[1];
    // ... (heap 재정렬)
    return { edgeIndex, cost };
  }
}
```

**배열 구조:**

```
heap = [edgeIdx0, cost0, edgeIdx1, cost1, edgeIdx2, cost2, ...]
         ↑       ↑       ↑       ↑       ↑       ↑
        i=0     i=1     i=2     i=3     i=4     i=5

heap[i*2] = edgeIndex
heap[i*2 + 1] = cost

parent(i) = floor((i - 1) / 2)
left(i) = 2*i + 1
right(i) = 2*i + 2
```

**예시:**

```
Min-Heap 구조:
         (5, 10)          ← root (min cost)
        /        \
    (7, 15)    (12, 18)
    /    \
 (9, 20) (15, 25)

heap = [5, 10,  7, 15,  12, 18,  9, 20,  15, 25]
        ↑   ↑   ↑   ↑   ↑    ↑   ↑   ↑   ↑    ↑
       i=0     i=1     i=2      i=3       i=4

pop() → { edgeIndex: 5, cost: 10 }
```

### 2. LRU Path Cache

자주 사용되는 경로를 캐싱합니다.

```typescript
const PATH_CACHE_MAX_SIZE = 2000;
const pathCache = new Map<string, number[] | null>();

function getCacheKey(start: number, end: number): string {
  return `${start}:${end}`;
}

function getCachedPath(start: number, end: number): number[] | null | undefined {
  const key = getCacheKey(start, end);
  const cached = pathCache.get(key);
  if (cached !== undefined) {
    // LRU: Move to end
    pathCache.delete(key);
    pathCache.set(key, cached);
    return cached;
  }
  return undefined;
}

function setCachedPath(start: number, end: number, path: number[] | null): void {
  const key = getCacheKey(start, end);
  // Evict oldest if at capacity
  if (pathCache.size >= PATH_CACHE_MAX_SIZE) {
    const firstKey = pathCache.keys().next().value;
    if (firstKey !== undefined) {
      pathCache.delete(firstKey);
    }
  }
  pathCache.set(key, path);
}
```

**LRU 동작:**

```
Cache (max 3개):
┌─────────────────────────────────────────────────────────────────┐
│ 초기: []                                                         │
│                                                                  │
│ get(1, 5) → Miss → Dijkstra → set(1:5, [1,2,5])                │
│ Cache: ["1:5" → [1,2,5]]                                        │
│                                                                  │
│ get(3, 7) → Miss → Dijkstra → set(3:7, [3,4,7])                │
│ Cache: ["1:5" → [1,2,5], "3:7" → [3,4,7]]                      │
│                                                                  │
│ get(1, 5) → Hit → LRU 갱신 (맨 뒤로 이동)                       │
│ Cache: ["3:7" → [3,4,7], "1:5" → [1,2,5]]                      │
│                                                                  │
│ get(5, 9) → Miss → Dijkstra → set(5:9, [5,6,9])                │
│ Cache: ["3:7" → [3,4,7], "1:5" → [1,2,5], "5:9" → [5,6,9]]    │
│                                                                  │
│ get(2, 8) → Miss → Capacity 초과 → 가장 오래된 것 제거         │
│ Cache: ["1:5" → [1,2,5], "5:9" → [5,6,9], "2:8" → [2,3,8]]    │
│         (3:7 제거됨)                                             │
└─────────────────────────────────────────────────────────────────┘
```

### 3. Dijkstra 알고리즘

```typescript
export function findShortestPath(
  startEdgeIndex: number,
  endEdgeIndex: number,
  edgeArray: Edge[]
): number[] | null {
  // 1. Cache 확인
  const cached = getCachedPath(startEdgeIndex, endEdgeIndex);
  if (cached !== undefined) {
    return cached ? [...cached] : null;
  }

  const n = edgeArray.length;
  ensureArraySize(n);
  resetArrays(n);
  heap.clear();

  // 2. 초기화
  distArray[startEdgeIndex] = 0;
  heap.push(startEdgeIndex, 0);

  // 3. Dijkstra
  while (!heap.isEmpty()) {
    const node = heap.pop()!;
    const u = node.edgeIndex;
    const cost = node.cost;

    if (cost > distArray[u]) continue;  // 이미 더 나은 경로 발견
    if (u === endEdgeIndex) break;      // 목적지 도달

    processNeighbors(u, cost, edgeArray);
  }

  // 4. 경로 재구성
  const result = reconstructPath(startEdgeIndex, endEdgeIndex);

  // 5. Cache 저장
  setCachedPath(startEdgeIndex, endEdgeIndex, result);

  return result;
}

function processNeighbors(u: number, cost: number, edgeArray: Edge[]): void {
  const currentEdge = edgeArray[u];
  const nextIndices = currentEdge.nextEdgeIndices || [];

  for (const v of nextIndices) {
    if (!edgeArray[v]) continue;

    const weight = edgeArray[v].distance;  // ← 현재: 거리만 사용
    const alt = cost + weight;

    if (alt < distArray[v]) {
      distArray[v] = alt;
      prevArray[v] = u;
      heap.push(v, alt);
    }
  }
}
```

**시각화:**

```
Edge 네트워크:
     1 ──10m──► 2
     │          │
    5m         3m
     │          │
     ↓          ↓
     3 ──8m───► 4

findShortestPath(1, 4):

초기:
  distArray = [Inf, 0, Inf, Inf, Inf]
  prevArray = [-1, -1, -1, -1, -1]
  heap = [(1, 0)]

반복 1: u=1, cost=0
  neighbors = [2, 3]
  - v=2: alt = 0 + 10 = 10 < Inf → distArray[2] = 10, prevArray[2] = 1, heap.push(2, 10)
  - v=3: alt = 0 + 5 = 5 < Inf → distArray[3] = 5, prevArray[3] = 1, heap.push(3, 5)
  heap = [(3, 5), (2, 10)]

반복 2: u=3, cost=5
  neighbors = [4]
  - v=4: alt = 5 + 8 = 13 < Inf → distArray[4] = 13, prevArray[4] = 3, heap.push(4, 13)
  heap = [(2, 10), (4, 13)]

반복 3: u=2, cost=10
  neighbors = [4]
  - v=4: alt = 10 + 3 = 13 = distArray[4] → 변화 없음
  heap = [(4, 13)]

반복 4: u=4, cost=13
  u == endEdgeIndex → break

경로 재구성:
  prevArray = [-1, -1, 1, 1, 3]
  curr = 4 → prevArray[4] = 3 → path = [4]
  curr = 3 → prevArray[3] = 1 → path = [4, 3]
  curr = 1 → startEdgeIndex → path = [4, 3, 1]
  reverse → [1, 3, 4]

결과: [1, 3, 4] (총 거리 13m)
```

---

## 현재 구현: 거리 기반

### Weight 계산

```typescript
// Dijkstra.ts:239
const weight = edgeArray[v].distance;  // 단순 거리만 사용
const alt = cost + weight;
```

**특징:**
- Edge의 물리적 거리만 고려
- 가장 짧은 물리 경로 탐색
- 단순하고 명확함

**예시:**

```
Edge 정보:
  Edge A: distance = 10m
  Edge B: distance = 15m
  Edge C: distance = 8m

경로 1: A → C (총 18m)
경로 2: B (총 15m)

→ 경로 2 선택 (더 짧음)
```

---

## 향후 확장: Cost 기반 라우팅

### 문제: 거리만으로는 부족

실제 운영에서는 거리 외에도 다양한 요소를 고려해야 합니다.

```
확장 필요성:
┌─────────────────────────────────────────────────────────────────┐
│ 1. 반송 (Return)                                                 │
│    → 빈 차량 복귀 경로는 가중치 낮게                             │
│    → 적재 차량 경로는 가중치 높게                                │
│                                                                  │
│ 2. 밸런싱 (Load Balancing)                                       │
│    → 혼잡한 Edge는 가중치 높게 (회피)                            │
│    → 빈 Edge는 가중치 낮게 (선호)                                │
│                                                                  │
│ 3. 우선순위 (Priority)                                           │
│    → 긴급 작업은 가중치 낮게 (빠른 경로)                         │
│    → 일반 작업은 가중치 높게 (경제적 경로)                       │
│                                                                  │
│ 4. 시간대별 가중치                                               │
│    → 피크 시간대 특정 구역 회피                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 확장 방안

#### 방안 1: Edge Cost 속성 추가

```typescript
// types/edge.ts
export interface Edge {
  edge_name: string;
  distance: number;

  // 추가 속성
  cost?: number;           // 기본 비용 (1.0 = 중립)
  congestion?: number;     // 혼잡도 (0~1, 실시간 업데이트)
  priority?: number;       // 우선순위 (높을수록 선호)
}
```

```typescript
// Dijkstra.ts
function processNeighbors(u: number, cost: number, edgeArray: Edge[]): void {
  const currentEdge = edgeArray[u];
  const nextIndices = currentEdge.nextEdgeIndices || [];

  for (const v of nextIndices) {
    if (!edgeArray[v]) continue;

    const edge = edgeArray[v];

    // ✅ 확장된 Weight 계산
    const baseCost = edge.cost ?? 1.0;
    const congestionFactor = 1.0 + (edge.congestion ?? 0);
    const priorityFactor = 1.0 / (edge.priority ?? 1.0);

    const weight = edge.distance * baseCost * congestionFactor * priorityFactor;
    const alt = cost + weight;

    if (alt < distArray[v]) {
      distArray[v] = alt;
      prevArray[v] = u;
      heap.push(v, alt);
    }
  }
}
```

**예시:**

```
Edge 정보:
  Edge A: distance = 10m, cost = 1.0, congestion = 0.5 (혼잡)
  Edge B: distance = 15m, cost = 1.0, congestion = 0.0 (한산)

Edge A Weight:
  10 * 1.0 * (1.0 + 0.5) = 15

Edge B Weight:
  15 * 1.0 * (1.0 + 0.0) = 15

→ 동일 가중치 (거리는 짧지만 혼잡도 때문에)
```

#### 방안 2: Cost 함수 전달

```typescript
export type CostFunction = (edge: Edge, context: CostContext) => number;

export interface CostContext {
  vehicleId?: number;
  isReturn?: boolean;      // 반송 여부
  priority?: number;       // 작업 우선순위
  currentTime?: number;    // 현재 시간
}

export function findShortestPath(
  startEdgeIndex: number,
  endEdgeIndex: number,
  edgeArray: Edge[],
  costFn?: CostFunction,   // ← 옵션 추가
  context?: CostContext
): number[] | null {
  // ...
}

function processNeighbors(
  u: number,
  cost: number,
  edgeArray: Edge[],
  costFn?: CostFunction,
  context?: CostContext
): void {
  // ...
  for (const v of nextIndices) {
    const edge = edgeArray[v];

    const weight = costFn
      ? costFn(edge, context ?? {})
      : edge.distance;  // 기본값

    const alt = cost + weight;
    // ...
  }
}
```

**사용 예시:**

```typescript
// 반송 경로 (빈 차량)
const returnCostFn: CostFunction = (edge, ctx) => {
  if (ctx.isReturn) {
    return edge.distance * 0.5;  // 반송은 가중치 낮게
  }
  return edge.distance;
};

const path = findShortestPath(
  start,
  end,
  edgeArray,
  returnCostFn,
  { isReturn: true, vehicleId: 5 }
);

// 밸런싱 고려
const balancingCostFn: CostFunction = (edge, ctx) => {
  const congestion = getEdgeCongestion(edge.edge_name);
  return edge.distance * (1.0 + congestion * 2.0);  // 혼잡도 2배 가중
};
```

#### 방안 3: Multi-Objective Optimization

여러 목적을 동시에 최적화합니다.

```typescript
interface PathScore {
  distance: number;      // 물리적 거리
  time: number;          // 예상 소요 시간
  congestion: number;    // 혼잡도
  cost: number;          // 비용
}

// Pareto Optimal 경로 탐색
export function findParetoOptimalPaths(
  start: number,
  end: number,
  edgeArray: Edge[],
  weights: { distance: number; time: number; congestion: number; cost: number }
): number[][] {
  // Multi-objective Dijkstra
  // ...
}
```

---

## 성능 최적화

### 1. Min-Heap 사용

```
배열 기반 vs Min-Heap:

❌ 배열 기반 (Naive):
  while distArray has Inf:
    u = find min in distArray  ← O(V) 매번 전체 탐색
    for each neighbor v of u:
      update distArray[v]

  총 시간: O(V²)

✅ Min-Heap:
  heap = [(start, 0)]
  while heap not empty:
    u = heap.pop()             ← O(log V)
    for each neighbor v of u:
      heap.push(v, cost)       ← O(log V)

  총 시간: O(E log V)

  Edge 수(E)가 많아도 Log 시간!
```

### 2. LRU Cache

```
성능 비교 (100대 차량, 20개 station):

❌ Cache 없음:
  - 매번 Dijkstra 실행
  - 평균 0.5ms per pathfinding
  - 100 calls = 50ms (프레임 드롭!)

✅ LRU Cache (2000개):
  - Cache Hit Rate: 85%
  - 평균 0.05ms (캐시) + 0.5ms (미스)
  - 100 calls = 0.05*85 + 0.5*15 = 11.75ms ✅
```

### 3. Zero-GC 재사용

```typescript
// 모듈 레벨에서 한 번만 생성
const heap = new MinHeap();
const distArray: number[] = [];
const prevArray: number[] = [];

function findShortestPath(...) {
  // 재사용 (GC 없음)
  heap.clear();
  resetArrays(n);
  // ...
}
```

### 4. Early Exit

```typescript
while (!heap.isEmpty()) {
  const node = heap.pop()!;
  const u = node.edgeIndex;

  if (u === endEdgeIndex) break;  // ← 목적지 도달 시 즉시 종료
  // ...
}
```

---

## 코드 가이드 (API, 사용법)

### 기본 사용

```typescript
import { findShortestPath } from "@/common/vehicle/logic/Dijkstra";

const path = findShortestPath(
  5,          // startEdgeIndex
  23,         // endEdgeIndex
  edgeArray   // Edge[]
);

if (path) {
  console.log(`Path: ${path.join(' → ')}`);
  // Path: 5 → 7 → 12 → 18 → 23
} else {
  console.log("No path found");
}
```

### Cache 관리

```typescript
import { clearPathCache } from "@/common/vehicle/logic/Dijkstra";

// 맵 변경 시 캐시 초기화
function onMapChange() {
  clearPathCache();
}
```

### 성능 모니터링

```typescript
import {
  getDijkstraPerformanceStats,
  resetDijkstraPerformanceStats
} from "@/common/vehicle/logic/Dijkstra";

// 통계 조회
const stats = getDijkstraPerformanceStats();
console.log(`Avg: ${stats.totalTime / stats.count}ms`);
console.log(`Cache Hit Rate: ${stats.cacheHits / (stats.cacheHits + stats.cacheMisses) * 100}%`);

// 통계 리셋
resetDijkstraPerformanceStats();
```

---

## 주의사항

### 1. Edge 연결성

모든 Edge가 연결되어 있어야 합니다.

```typescript
// ✅ 연결된 그래프
const path = findShortestPath(1, 5, edgeArray);
// → [1, 2, 3, 5]

// ❌ 분리된 그래프
const path = findShortestPath(1, 100, edgeArray);
// → null (도달 불가)
```

### 2. Cache Invalidation

Edge 정보가 변경되면 캐시를 초기화해야 합니다.

```typescript
// Edge distance 변경
edgeArray[5].distance = 20;  // 10 → 20

// ❌ 캐시가 오래된 경로 반환
const path = findShortestPath(1, 10, edgeArray);

// ✅ 캐시 초기화 후 사용
clearPathCache();
const path = findShortestPath(1, 10, edgeArray);
```

### 3. 성능 고려

경로 탐색은 비용이 큰 작업입니다.

```typescript
// ✅ 프레임당 제한
const MAX_PATH_FINDS_PER_FRAME = 10;

// ❌ 한 프레임에 너무 많은 계산
for (let i = 0; i < 100; i++) {
  findShortestPath(i, target, edgeArray);  // 프레임 드롭!
}
```

---

## 관련 문서

- [시스템 아키텍처](../../../../doc/SYSTEM_ARCHITECTURE.md)
- [Vehicle Memory Architecture](../memory/README.md) - TrafficState, STOP_REASON 메모리 구조
- [Worker 시뮬레이션 엔진](../../../shmSimulator/core/README.md) - LockMgr 통합
- [Movement Update](../movement/README.md) - movementUpdate.ts에서 LockMgr 사용
