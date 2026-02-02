# Lock System - AI Context

## File Map
```yaml
src/common/vehicle/logic/LockMgr.ts:766
  classes:
    - LockMgr: 락 관리자 메인 클래스
    - BatchController: BATCH 전략 구현
    - RingBuffer<T>: O(1) queue

  methods:
    requestLock(nodeName, edgeName, vehId):
      - requests 배열 추가, edgeQueues.enqueue
      - FIFO: 즉시 1개 승인
      - BATCH: step()에서 배치 승인

    releaseLock(nodeName, vehId):
      - granted 제거, edgeQueues.dequeue
      - FIFO: 다음 차량 즉시 승인
      - BATCH: onRelease() 호출

    checkGrant(nodeName, vehId):bool
      - granted 배열 조회

    cancelLock(nodeName, vehId):bool
      - requests/granted 제거
      - edgeQueue 재구성 O(n)
      - BATCH: batchReleasedCount 조정

    getLocksForVehicle(vehId): {nodeName, edgeName, isGranted}[]
      - 차량이 보유한 모든 락 반환

    step():  # BATCH 전략 + 양쪽 합류 노드
      - 양쪽 합류 노드: handleArrivalOrder_Grant()
      - 일반 노드: batchController.step()
      - newGrants → granted 추가

    notifyArrival(nodeName, vehId):
      - 차량이 대기 지점에 도착했음을 알림
      - arrivalTime 기록
      - 양쪽 합류 노드에서 도착 순서 기반 grant 재평가

    isBothSideMergeNode(nodeName):bool
      - deadlockZoneNodes에 포함되면 true
      - 양쪽에서 합류하는 노드 (180도-180도, 분기 양쪽 다 합류)

    handleArrivalOrder_Grant(node):
      - 양쪽 합류 노드 전용
      - arrivalTime이 있는 요청 중 가장 먼저 도착한 차량에게 grant
      - BATCH 전략 무시, 도착 순서 기반

    initFromEdges(edges):
      - incomingEdges >= 2인 노드만 merge node 등록

  params:
    batchSize: 5  # 동시 승인 최대
    passLimit: 3  # edge별 연속 통과 최대

src/common/vehicle/logic/AutoMgr.ts:280
  methods:
    cancelObsoleteLocks(vehId, newPath, edgeArray, lockMgr):
      - findLocksToCancel: 새 경로에 없는 노드 필터링
      - lockMgr.cancelLock 호출

    update():
      - MAX_PATH_FINDS_PER_FRAME: 10
      - round-robin 처리

src/common/vehicle/movement/vehiclePosition.ts:603
  methods:
    findAllMergeTargets(lockMgr, edgeArray, currentEdge, currentRatio, data, ptr): MergeTarget[]
      - 경로상 모든 합류점 탐색
      - type: STRAIGHT | CURVE

    findFirstBlockingMerge(lockMgr, ...): BlockingMergeResult | null
      - 락 없는 첫 merge 찾기
      - LINEAR edge에서만 동작

    processMergeLogicInline:652-789
      CRITICAL: L671-695 곡선→곡선→합류
      - lockMgr.requestLock → checkGrant
      - WAITING: 현재 위치에서 멈춤 (뒤로 되돌리지 않음)
      - ACQUIRED: 진입 허용

  log_throttle:
    MergeLockLogState: 2000ms

src/common/vehicle/movement/mergeBraking.ts:103
  methods:
    checkMergePreBraking(...): {shouldBrake, deceleration, distanceToMerge}
      - findFirstBlockingMerge 호출
      - distanceToWait <= brakeDistance → 감속
      - LINEAR edge만 적용

src/common/vehicle/movement/edgeTransition.ts:344
  methods:
    handleEdgeTransition(params):
      CRITICAL: L904-914 현재edge.to_node merge체크
      CRITICAL: L916-935 다음edge 곡선→merge 대기
      - checkGrant 실패 → ratio=1, break
      - 성공 → moveVehicleToEdge, shiftAndRefillNextEdges
      - TRAFFIC_STATE = FREE, LOCKED 플래그 제거

    shiftAndRefillNextEdges(data, ptr, vehId, pathBuffer, edgeArray):
      - pathBuffer shift: 맨 앞 edge 제거
      - nextEdges shift: 0←1, 1←2, 2←3, 3←4
      - NEXT_EDGE_4 ← pathBuffer[4]

src/initialize/constants.ts
  TrafficState:
    FREE: 0
    WAITING: 1
    ACQUIRED: 2

  StopReason:  # bitflag
    LOCKED: 1 << 3 (8)
    SENSORED: 1 << 10 (1024)

    ops:
      add: reason | StopReason.LOCKED
      remove: reason & ~StopReason.LOCKED
      check: (reason & StopReason.LOCKED) !== 0
```

## Logic Flow

### STRAIGHT_MERGE
```
vehiclePosition → findAllMergeTargets (type:STRAIGHT)
→ shouldRequestLockNow (distToMerge <= requestDistStr)
→ processMergeLogicInline → requestLock → checkGrant
  → granted: ACQUIRED
  → !granted: findFirstBlockingMerge → 현재 위치에서 멈춤, WAITING
→ mergeBraking → checkMergePreBraking (감속)
→ edgeTransition → to_node merge체크 → releaseLock
```

### CURVE_MERGE
```
LINEAR edge에서:
  findAllMergeTargets (nextEdge is curve & to_node is merge)
  → requestLock (미리 요청)

edgeTransition:
  → nextEdge가 곡선 & to_node merge 체크 (L916-935)
  → !checkGrant: ratio=1, break (곡선 진입 차단)
  → checkGrant: 곡선 진입 허용
  → 곡선 통과 후 releaseLock
```

### CURVE→CURVE→MERGE
```
첫 곡선 (vehiclePosition L671-695):
  → nextEdge도 곡선 & to_node merge 체크
  → remainingDist <= requestDistCurve: requestLock
  → !checkGrant: WAITING (첫 곡선 끝 대기)
  → checkGrant: ACQUIRED

edgeTransition (L916-935):
  → 첫 곡선→두 번째 곡선 전환 시 checkGrant
  → !granted: ratio=1, break
```

### BATCH Strategy
```
매 프레임: lockMgr.step()
→ BatchController.step(node):
    - selectNextBatchEdge (round-robin)
    - batchSize까지 grant
→ onRelease(node):
    - edgePassCount++
    - edgePassCount >= passLimit && hasWaitingOnOtherEdges
      → Yes: 다음 edge로 전환
      → No: edgePassCount 리셋, 같은 edge 계속
```

### ARRIVAL_ORDER Strategy (데드락 존 전용)
```
핵심: 분기점 기준으로 데드락 존 판단
  - from_node가 데드락 분기점이면 → ARRIVAL_ORDER 적용
  - BATCH/FIFO 무시, 도착 순서 기반 grant
  - 한 번에 1대만 grant

조건:
  lockMgr.isDeadlockBranchNode(edge.from_node) === true

Flow:
1. vehiclePosition.findAllMergeTargets():
   - isDeadlockMerge = lockMgr.isDeadlockBranchNode(edge.from_node)
2. requestLock → requests 배열 추가 (arrivalTime 없음)
3. 차량이 waiting point 도달 (shouldWait=true):
   - isDeadlockMerge이면 lockMgr.notifyArrival() 호출
   - arrivalTime 기록
4. step()에서:
   - 데드락 존 합류점: handleArrivalOrder_Grant() 호출
   - arrivalTime 있는 요청 중 가장 빠른 차량에게 grant
   - 일반 합류점: 기존 BATCH/FIFO 전략

LockRequest 구조:
  vehId: number
  edgeName: string
  requestTime: number     # 요청 시점
  arrivalTime?: number    # 대기 지점 도착 시점 (notifyArrival로 설정)

LockMgr 메서드:
  isDeadlockBranchNode(nodeName): 분기점 체크
  isDeadlockZoneNode(nodeName): 합류점 체크
  notifyArrival(nodeName, vehId): 도착 알림
  handleArrivalOrder_Grant(node): 도착 순서 기반 grant

호출 위치:
  vehiclePosition.ts processMergeTargets():613-621
    shouldWait && isDeadlockMerge → lockMgr.notifyArrival()
```

### Path Reroute
```
AutoMgr.assignRandomDestination
→ findShortestPath (새 경로)
→ cancelObsoleteLocks
  → findLocksToCancel: 새 경로에 없는 node 필터링
  → lockMgr.cancelLock (requests/granted 제거, queue 재구성)
```

## Critical Rules

**곡선 edge 규칙:**
- 곡선에서는 감속 불가 → 반드시 이전 edge에서 미리 락 요청
- 대기 방식: edge 전환 차단 (ratio=1 고정)

**processMergeLogicInline:**
- 곡선 위에서 ACQUIRED면 유지
- 합류점 없으면 LOCKED 플래그 제거 필수
- distanceToWait <= 0이면 현재 위치에서 멈춤 (뒤로 되돌리지 않음, 순간이동 방지)

**edgeTransition:**
- to_node merge → checkGrant 필수
- 다음 edge가 곡선 & to_node merge → 진입 전 checkGrant
- 전환 성공 → TRAFFIC_STATE=FREE, LOCKED 제거, shiftAndRefillNextEdges

**cancelLock:**
- edgeQueue 재구성 O(n)
- batchReleasedCount 조정 (통과 아닌 취소이므로 감소 안 함)

## Config (simulationConfig.ts)
```yaml
lockRequestDistanceFromMergingStr: 직선 요청 거리
lockWaitDistanceFromMergingStr: 직선 대기 거리
lockRequestDistanceFromMergingCurve: 곡선 요청 거리
lockWaitDistanceFromMergingCurve: 곡선 대기 거리
lockGrantStrategy: FIFO | BATCH
```

## Worker Communication (SHM Mode)
```
Main → Worker: GET_LOCK_TABLE {fabId, requestId}
Worker → Main: LOCK_TABLE {fabId, requestId, data:LockTableData}
FabContext.getLockTableData() → 직렬화
```

## Impact Map
| 수정 | 확인 필요 |
|------|-----------|
| LockMgr 로직 | AutoMgr.cancelObsoleteLocks, vehiclePosition.processMergeLogicInline |
| 거리 파라미터 | findAllMergeTargets, checkMergePreBraking |
| BatchController | step() 호출, onRelease |
| edge 전환 | shiftAndRefillNextEdges, pathBuffer 동기화 |
| TrafficState | edgeTransition L142-157, L904-935 |

---

## Deadlock Zone Detection

### 정의
```
데드락 존 = 분기점 2개 + 합류점 2개 + edge 4개

구조:
  분기점A ----→ 합류점B ←---- 분기점D
      \                   /
       ----→ 합류점C ←----

조건:
1. 분기점 A, D: outgoing edge >= 2
2. 합류점 B, C: incoming edge >= 2
3. A → B, A → C, D → B, D → C (edge 4개)
4. A와 D의 공통 toNode가 정확히 B, C
```

### File Map
```yaml
src/store/map/nodeStore.ts
  interface:
    DeadlockZone:
      divergeNodes: [string, string]  # 분기점 2개
      mergeNodes: [string, string]    # 합류점 2개

  functions:
    detectDeadlockZones(edges): DeadlockZone[]
      - 분기점별 toNode 집합 계산
      - 분기점 쌍 중 공통 toNode가 2개인 경우 찾기
      - 해당 toNode가 모두 합류점(incoming >= 2)이면 데드락 존

    isDeadlockDivergeNode(nodeName, zones): {isDiverge, zoneId?}
      - 노드가 데드락 존의 분기점인지 확인

    isDeadlockMergeNode(nodeName, zones): {isMerge, zoneId?}
      - 노드가 데드락 존의 합류점인지 확인

    updateTopology(edges):
      - 1단계: isMerge, isDiverge, isTerminal 계산
      - 2단계: detectDeadlockZones 호출
      - 3단계: Node에 데드락 존 정보 추가
        - isDeadlockBranchNode: 분기점 여부
        - isDeadlockMergeNode: 합류점 여부
        - deadlockZoneId: 존 ID

src/types/node.ts
  Node fields:
    isDeadlockMergeNode?: boolean   # 데드락 존 합류점
    isDeadlockBranchNode?: boolean  # 데드락 존 분기점
    deadlockZoneId?: number         # 존 ID (같으면 같은 존)
```

### 알고리즘
```
1. edge 순회 → 분기점별 toNode 집합, 합류점 집합 구축
2. 분기점 목록 추출 (outgoing >= 2)
3. 분기점 쌍 (A, D) 순회:
   - A.toNodes ∩ D.toNodes = commonToNodes
   - |commonToNodes| == 2 && 모두 합류점이면:
     - DeadlockZone { divergeNodes: [A, D], mergeNodes: [B, C] }
4. Node에 isDeadlockBranchNode, isDeadlockMergeNode, deadlockZoneId 설정
```

### 콘솔 출력 (맵 로딩 시)
```
updateTopology 호출 시 데드락 존 감지 결과 출력:
[DeadlockZone] Zone 0:
  분기점: nodeA, nodeD
  합류점: nodeB, nodeC
  Edges: A→B, A→C, D→B, D→C
```

### 사용처
```yaml
LockMgr.isBothSideMergeNode(nodeName):
  - Node.isDeadlockMergeNode 체크
  - true면 ARRIVAL_ORDER 전략 적용

updateTopology 호출 위치:
  - src/store/system/cfgStore.ts:498
  - 맵 로딩 직후 자동 호출
```

---

## 핵심 데드락 지역 (Key Deadlock Zone)

### y_short 맵
```yaml
핵심 데드락 지역:
  분기점: n248, n346
  합류점: n345, n249
  Edges: e722, e549, e397, e286

구조:
  n248 --e722--> n345 <--e397-- n346
    \                         /
     --e549--> n249 <--e286--

특징:
  - y_short 맵의 대표적 데드락 유발 구간
  - 양방향 합류로 인한 교착 가능성 높음
  - ARRIVAL_ORDER 전략 적용 대상
```

**"핵심 데드락 지역"** = 위 노드/엣지 조합을 의미
