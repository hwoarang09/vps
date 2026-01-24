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

    step():  # BATCH 전략만
      - 모든 node에 batchController.step()
      - newGrants → granted 추가

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
      - WAITING: ratio 되돌림
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
  → !granted: findFirstBlockingMerge → ratio 되돌림, WAITING
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
- distanceToWait <= 0이면 ratio 되돌림

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
