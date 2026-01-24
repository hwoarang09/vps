# VPS 락(Lock) 시스템 완전 가이드

VPS 프로젝트의 합류점(Merge Node) 제어를 위한 락 시스템 전체 문서입니다.

## 목차
1. [개요](#개요)
2. [폴더 구조도](#폴더-구조도)
3. [핵심 파일 상세](#핵심-파일-상세)
4. [로직 흐름도](#로직-흐름도)
5. [상태 관리](#상태-관리)
6. [핵심 개념 정리](#핵심-개념-정리)
7. [체크리스트](#체크리스트)

---

## 개요

### 락 시스템의 목적
- **합류점(Merge Node)에서 차량 간 충돌 방지**
- 여러 edge에서 합류하는 지점에서 **한 번에 한 대씩 또는 배치 단위로 진입 제어**
- **공정성 보장**: FIFO 또는 BATCH 전략으로 edge 간 균형 유지

### 지원하는 합류 타입
1. **직선 합류 (Straight Merge)**: 직선 edge → merge node
2. **곡선 합류 (Curve Merge)**: 곡선 edge → merge node (이전 직선에서 미리 요청)
3. **곡선→곡선→합류**: 첫 번째 곡선 → 두 번째 곡선 → merge node

### 2가지 승인 전략

| 전략 | 장점 | 단점 | 사용 시나리오 |
|------|------|------|---------------|
| **FIFO** | 간단, 예측 가능 | 특정 edge 독점 가능 | 트래픽 적은 환경 |
| **BATCH** | 공정성, 처리량 증가 | 복잡도 증가 | 고밀도 트래픽 (100k+ 차량) |

---

## 폴더 구조도

```
vps/
├── src/
│   ├── common/vehicle/                    # 공통 차량 로직
│   │   ├── logic/
│   │   │   ├── LockMgr.ts                 # ⭐ 핵심 락 관리자 (766줄)
│   │   │   │   ├── class LockMgr          # 메인 락 관리 클래스
│   │   │   │   ├── class BatchController # BATCH 전략 구현
│   │   │   │   ├── class RingBuffer<T>    # O(1) 큐
│   │   │   │   ├── requestLock(nodeName, edgeName, vehId)
│   │   │   │   ├── releaseLock(nodeName, vehId)
│   │   │   │   ├── checkGrant(nodeName, vehId)
│   │   │   │   ├── cancelLock(nodeName, vehId)
│   │   │   │   ├── getLocksForVehicle(vehId) # 차량의 모든 락 조회
│   │   │   │   ├── step()                 # BATCH 전략 grant 처리
│   │   │   │   ├── reset()                # 테이블 초기화
│   │   │   │   ├── getGrantStrategy()     # 현재 전략 반환
│   │   │   │   ├── setLockConfig(config)  # 거리 파라미터 설정
│   │   │   │   ├── setLockPolicy(policy)  # 전략 변경
│   │   │   │   └── initFromEdges(edges)   # 맵 데이터로부터 초기화
│   │   │   └── AutoMgr.ts                 # 경로 변경 & 락 취소 (280줄)
│   │   │       ├── initStations(stationData, edgeNameToIndex)
│   │   │       ├── update(...)            # round-robin + 프레임당 10개 제한
│   │   │       ├── findLocksToCancel(vehId, newPathIndices, ...)
│   │   │       ├── cancelObsoleteLocks(vehId, newPathIndices, ...)
│   │   │       ├── getDestinationInfo(vehId)
│   │   │       └── dispose()              # GC를 위한 정리
│   │   └── movement/
│   │       ├── vehiclePosition.ts         # 합류 로직 (603줄)
│   │       │   ├── findAllMergeTargets(lockMgr, edgeArray, currentEdge, ...)
│   │       │   │   # 경로상 모든 합류점 탐색 (직선/곡선 타입 결정)
│   │       │   ├── findFirstBlockingMerge(lockMgr, ...)
│   │       │   │   # 락 없는 첫 번째 merge 찾기
│   │       │   ├── shouldRequestLockNow(distanceToMerge, requestDistance)
│   │       │   │   # 락 요청 시점 판단
│   │       │   ├── processMergeLogicInline(lockMgr, ...)
│   │       │   │   # 락 요청/승인/대기 처리
│   │       │   │   # TRAFFIC_STATE 업데이트
│   │       │   │   # 곡선→곡선→합류 케이스 (434-464줄)
│   │       │   ├── MergeLockLogState      # 로그 중복 방지 (2초 throttle)
│   │       │   └── LOG_THROTTLE_MS = 2000
│   │       ├── mergeBraking.ts            # ⭐ 합류 사전 감속 (103줄)
│   │       │   └── checkMergePreBraking(vehId, currentEdge, ...)
│   │       │       # findFirstBlockingMerge로 blocking merge 찾기
│   │       │       # 대기 지점까지 거리 기반 감속 필요 여부 계산
│   │       │       # calculateBrakeDistance로 제동 거리 계산
│   │       │       # LINEAR edge에서만 적용
│   │       └── edgeTransition.ts          # Edge 전환 (344줄)
│   │           ├── handleEdgeTransition(params)
│   │           │   # Edge 전환 시 락 체크
│   │           │   # 곡선→곡선→합류 대기 (142-157줄)
│   │           │   # [UnusualMove] 연결 검증 (179-187줄)
│   │           └── shiftAndRefillNextEdges(...)
│   │               # pathBuffer와 nextEdges 동시 shift
│   │               # Edge transition 성공 시 호출
│   │
│   ├── initialize/
│   │   └── constants.ts                   # 상태 & 플래그 정의
│   │       ├── TrafficState
│   │       │   ├── FREE: 0      # 자유 통행
│   │       │   ├── WAITING: 1   # 락 대기 중
│   │       │   └── ACQUIRED: 2  # 락 획득
│   │       └── StopReason (비트 플래그)
│   │           ├── LOCKED: 1 << 3     # 락 대기
│   │           └── SENSORED: 1 << 10  # 센서 감지
│   │
│   ├── shmSimulator/                      # Worker Thread 시뮬레이터
│   │   ├── core/
│   │   │   ├── FabContext.ts              # Fab별 락 관리
│   │   │   │   ├── lockMgr: LockMgr       # Fab마다 독립 락 관리자
│   │   │   │   └── getLockTableData()     # 락 테이블 직렬화
│   │   │   └── SimulationEngine.ts        # 멀티 Fab 엔진
│   │   │       └── getLockTableData(fabId) # Fab별 락 조회
│   │   ├── worker.entry.ts                # Worker 메시지 처리
│   │   │   └── handleGetLockTable()       # GET_LOCK_TABLE 메시지 핸들러
│   │   └── types.ts                       # 타입 정의
│   │       ├── LockNodeData               # 직렬화 가능한 락 노드 데이터
│   │       ├── LockTableData              # 직렬화 가능한 락 테이블
│   │       └── WorkerMessage/MainMessage  # 락 관련 메시지 타입
│   │
│   ├── components/react/menu/panels/
│   │   └── LockInfoPanel.tsx              # UI: 락 상태 표시 (326줄)
│   │       └── 특정 merge node의 granted/requests 표시
│   │
│   └── config/
│       └── simulationConfig.ts            # 락 파라미터 설정
│           ├── lockWaitDistanceFromMergingStr     # 직선 대기 거리
│           ├── lockRequestDistanceFromMergingStr  # 직선 요청 거리
│           ├── lockWaitDistanceFromMergingCurve   # 곡선 대기 거리
│           ├── lockRequestDistanceFromMergingCurve # 곡선 요청 거리
│           └── lockGrantStrategy          # FIFO or BATCH
```

---

## 핵심 파일 상세

### 1. LockMgr.ts (766줄)

#### 주요 클래스

**LockMgr**
```typescript
export class LockMgr {
  private lockTable: LockTable = {};
  private readonly batchControllers: Map<string, BatchController>;

  // 설정 가능한 파라미터
  private lockWaitDistanceFromMergingStr: number;
  private lockRequestDistanceFromMergingStr: number;
  private lockWaitDistanceFromMergingCurve: number;
  private lockRequestDistanceFromMergingCurve: number;
  private strategyType: GrantStrategy;
  private readonly batchSize: number = 5;
  private readonly passLimit: number = 3;
}
```

**BatchController**
```typescript
class BatchController {
  readonly state: BatchState;

  step(node: MergeLockNode): Grant[]
  onRelease(node: MergeLockNode): void
  private hasWaitingVehiclesOnOtherEdges(node, currentEdge): boolean
  private selectNextBatchEdge(node): string | null
  isBatchComplete(): boolean
}
```

**RingBuffer<T>**
```typescript
export class RingBuffer<T> {
  enqueue(item: T): void    // O(1)
  dequeue(): T | undefined  // O(1)
  peek(): T | undefined
  get size(): number
}
```

#### 주요 메서드

**락 요청/승인/해제**
```typescript
// 합류점에서 락 요청
requestLock(nodeName: string, edgeName: string, vehId: number): void
  → requests 배열에 추가
  → edgeQueues[edgeName].enqueue(vehId)
  → FIFO: 즉시 1개 승인
  → BATCH: step()에서 배치 승인

// 락 획득 여부 확인
checkGrant(nodeName: string, vehId: number): boolean
  → granted 배열에 vehId 있는지 확인

// 락 해제 (Edge 전환 시)
releaseLock(nodeName: string, vehId: number): void
  → granted 배열에서 제거
  → edgeQueues[edge].dequeue()
  → FIFO: 다음 차량 승인
  → BATCH: onRelease() 호출

// 락 취소 (경로 변경 시)
cancelLock(nodeName: string, vehId: number): boolean
  → granted 또는 requests에서 제거
  → edgeQueue에서 제거 (O(n))
  → BATCH: batchReleasedCount 조정
```

**조회 메서드**
```typescript
// 차량의 모든 락 정보 반환
getLocksForVehicle(vehId: number): Array<{
  nodeName: string;
  edgeName: string;
  isGranted: boolean
}>

// 현재 락 설정/정책 반환
getLockConfig(): LockConfig
getLockPolicy(): LockPolicy
getGrantStrategy(): GrantStrategy

// 거리 계산
getRequestDistanceFromMergingStr(): number
getRequestDistanceFromMergingCurve(): number
getWaitDistanceFromMergingStr(): number
getWaitDistanceFromMergingCurve(): number
```

**설정 관리**
```typescript
// 락 파라미터 설정 (fab별 오버라이드)
setLockConfig(config: LockConfig): void

// 락 정책 변경 (FIFO ↔ BATCH)
setLockPolicy(policy: LockPolicy): void
  → BATCH로 변경 시 모든 node에 BatchController 생성
  → BATCH에서 다른 전략으로 변경 시 controller 제거

// 맵 데이터로부터 초기화
initFromEdges(edges: Edge[]): void
  → incomingEdges가 2개 이상인 node만 merge node로 등록
  → edgeQueues 생성
  → BATCH 전략이면 BatchController 생성

// 테이블 초기화 (설정값은 유지)
reset(): void
```

**프레임 업데이트**
```typescript
// 매 프레임 호출 (BATCH 전략만)
step(): void
  → 모든 merge node에 대해 controller.step() 호출
  → newGrants를 granted에 추가
  → requests에서 승인된 차량 제거
```

#### BatchController 세부 로직

**step() - 새 grant 결정**
```typescript
step(node: MergeLockNode): Grant[] {
  // passLimit 도달 시 새 grant 중단
  if (this.state.passLimitReached) {
    return [];
  }

  // 새 batch 시작
  if (!this.state.currentBatchEdge) {
    const nextEdge = this.selectNextBatchEdge(node);  // round-robin
    if (!nextEdge) return [];

    this.state.currentBatchEdge = nextEdge;
    this.state.batchGrantedCount = 0;
    this.state.batchReleasedCount = 0;
    this.state.edgePassCount = 0;
    this.state.passLimitReached = false;
  }

  // batchSize 도달 체크
  if (this.state.batchGrantedCount >= this.state.batchSize) {
    return [];
  }

  // batchSize까지 여유가 있으면 추가 grant
  const requestsFromEdge = node.requests.filter(r => r.edgeName === this.state.currentBatchEdge);
  const grants: Grant[] = [];
  const availableSlots = this.state.batchSize - this.state.batchGrantedCount;
  const grantCount = Math.min(availableSlots, requestsFromEdge.length);

  for (let i = 0; i < grantCount; i++) {
    const req = requestsFromEdge[i];
    grants.push({ veh: req.vehId, edge: req.edgeName });
    this.state.batchGrantedCount++;
  }

  return grants;
}
```

**onRelease() - 차량 통과 처리**
```typescript
onRelease(node: MergeLockNode): void {
  if (!this.state.currentBatchEdge) return;

  this.state.batchReleasedCount++;
  this.state.edgePassCount++;  // 통과 차량 수 증가

  // passLimit 도달 체크 - 다른 edge에 대기 차량이 있을 때만 의미있음
  if (this.state.edgePassCount >= this.state.passLimit && !this.state.passLimitReached) {
    const hasWaitingOnOtherEdge = this.hasWaitingVehiclesOnOtherEdges(node, this.state.currentBatchEdge);

    if (hasWaitingOnOtherEdge) {
      this.state.passLimitReached = true;
      // 새 grant 중단
    } else {
      // 다른 edge에 대기 차량 없으면 passLimit 리셋하고 계속
      this.state.edgePassCount = 0;
    }
  }

  // Batch 완료 체크
  if (this.isBatchComplete()) {
    const currentQueue = node.edgeQueues[this.state.currentBatchEdge];
    const hasMoreVehicles = currentQueue && currentQueue.size > 0;

    if (this.state.passLimitReached) {
      // passLimit 도달 → 다음 edge로 전환
      this.state.lastUsedEdge = this.state.currentBatchEdge;
      this.state.currentBatchEdge = null;
      this.state.batchGrantedCount = 0;
      this.state.batchReleasedCount = 0;
      this.state.edgePassCount = 0;
      this.state.passLimitReached = false;
    } else if (hasMoreVehicles) {
      // passLimit 미달이고 차량 있으면 같은 edge 유지 (다음 batch)
      this.state.batchGrantedCount = 0;
      this.state.batchReleasedCount = 0;
      // edgePassCount는 유지 (누적)
    } else {
      // 현재 edge 큐가 비어있으면 즉시 다음 edge로 전환
      this.state.lastUsedEdge = this.state.currentBatchEdge;
      this.state.currentBatchEdge = null;
      this.state.batchGrantedCount = 0;
      this.state.batchReleasedCount = 0;
      this.state.edgePassCount = 0;
      this.state.passLimitReached = false;
    }
  }
}
```

**hasWaitingVehiclesOnOtherEdges() - 공정성 체크**
```typescript
private hasWaitingVehiclesOnOtherEdges(node: MergeLockNode, currentEdge: string): boolean {
  for (const [edgeName, queue] of Object.entries(node.edgeQueues)) {
    if (edgeName !== currentEdge && queue.size > 0) {
      return true;
    }
  }
  return false;
}
```

**selectNextBatchEdge() - round-robin**
```typescript
private selectNextBatchEdge(node: MergeLockNode): string | null {
  const edgeNames = Object.keys(node.edgeQueues);
  if (edgeNames.length === 0) return null;

  // lastUsedEdge가 없으면 처음부터 시작
  if (!this.state.lastUsedEdge) {
    for (const edgeName of edgeNames) {
      const queue = node.edgeQueues[edgeName];
      if (queue && queue.size > 0) {
        return edgeName;
      }
    }
    return null;
  }

  // lastUsedEdge 다음부터 순회 (round-robin)
  const lastIndex = edgeNames.indexOf(this.state.lastUsedEdge);
  const startIndex = lastIndex === -1 ? 0 : (lastIndex + 1) % edgeNames.length;

  for (let i = 0; i < edgeNames.length; i++) {
    const index = (startIndex + i) % edgeNames.length;
    const edgeName = edgeNames[index];
    const queue = node.edgeQueues[edgeName];
    if (queue && queue.size > 0) {
      return edgeName;
    }
  }

  return null;
}
```

---

### 2. AutoMgr.ts (280줄)

#### 경로 변경 시 락 취소

**initStations() - 스테이션 초기화**
```typescript
initStations(stationData: StationRawData[], edgeNameToIndex: Map<string, number>) {
  this.stations = [];
  for (const station of stationData) {
    if (station.nearest_edge) {
      const edgeIdx = edgeNameToIndex.get(station.nearest_edge);
      if (edgeIdx !== undefined) {
        this.stations.push({ name: station.station_name, edgeIndex: edgeIdx });
      }
    }
  }
}
```

**update() - round-robin + 프레임당 제한**
```typescript
const MAX_PATH_FINDS_PER_FRAME = 10;

update(mode, numVehicles, vehicleDataArray, edgeArray, edgeNameToIndex, transferMgr, lockMgr?) {
  if (mode !== TransferMode.AUTO_ROUTE) return;
  if (numVehicles === 0) return;

  // Reset per-frame counter
  this.pathFindCountThisFrame = 0;

  // Process vehicles in round-robin fashion with limit
  const startIndex = this.nextVehicleIndex;

  for (let i = 0; i < numVehicles; i++) {
    // Check if we've hit the per-frame limit
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
```

**findLocksToCancel() - 새 경로에 없는 락 찾기**
```typescript
findLocksToCancel(
  vehId: number,
  newPathIndices: number[],
  edgeArray: Edge[],
  lockMgr: LockMgr
): string[] {
  // 1. 현재 차량이 가진 락 목록 조회
  const currentLocks = lockMgr.getLocksForVehicle(vehId);
  if (currentLocks.length === 0) return [];

  // 2. 새 경로에 포함된 노드들 수집 (to_node 기준)
  const newPathNodes = new Set<string>();
  for (const edgeIdx of newPathIndices) {
    const edge = edgeArray[edgeIdx];
    if (edge) {
      newPathNodes.add(edge.to_node);
    }
  }

  // 3. 새 경로에 없는 락 찾기
  const locksToCancel: string[] = [];
  for (const lock of currentLocks) {
    if (!newPathNodes.has(lock.nodeName)) {
      locksToCancel.push(lock.nodeName);
    }
  }

  return locksToCancel;
}
```

**cancelObsoleteLocks() - 불필요한 락 제거**
```typescript
cancelObsoleteLocks(
  vehId: number,
  newPathIndices: number[],
  edgeArray: Edge[],
  lockMgr: LockMgr
): void {
  const locksToCancel = this.findLocksToCancel(vehId, newPathIndices, edgeArray, lockMgr);

  if (locksToCancel.length > 0) {
    devLog.veh(vehId).debug(`[cancelObsoleteLocks] cancelling ${locksToCancel.length} locks`);
  }

  for (const nodeName of locksToCancel) {
    lockMgr.cancelLock(nodeName, vehId);
  }
}
```

**호출 시점**
```typescript
assignRandomDestination(...) {
  // Pathfinding
  const pathIndices = findShortestPath(currentEdgeIdx, candidate.edgeIndex, edgeArray);

  if (pathIndices && pathIndices.length > 0) {
    // 경로 변경 전에 새 경로에 없는 락 취소
    if (lockMgr) {
      this.cancelObsoleteLocks(vehId, pathIndices, edgeArray, lockMgr);
    }

    const pathCommand = this.constructPathCommand(pathIndices, edgeArray);
    transferMgr.assignCommand(vehId, command, ...);
  }
}
```

**기타 메서드**
```typescript
// 목적지 정보 조회
getDestinationInfo(vehId: number) {
  return this.vehicleDestinations.get(vehId);
}

// GC를 위한 정리
dispose(): void {
  this.stations = [];
  this.vehicleDestinations.clear();
}
```

---

### 3. vehiclePosition.ts (603줄)

#### findAllMergeTargets() - 경로상 모든 합류점 탐색

```typescript
export function findAllMergeTargets(
  lockMgr: LockMgr,
  edgeArray: Edge[],
  currentEdge: Edge,
  currentRatio: number,
  data: Float32Array,
  ptr: number
): MergeTarget[] {
  const targets: MergeTarget[] = [];

  // 현재 edge 남은 거리
  let accumulatedDist = currentEdge.distance * (1 - currentRatio);

  // 1. currentEdge.tn 확인 (직선 합류)
  if (lockMgr.isMergeNode(currentEdge.to_node)) {
    targets.push({
      type: 'STRAIGHT',
      mergeNode: currentEdge.to_node,
      requestEdge: currentEdge.edge_name,
      distanceToMerge: accumulatedDist,
      requestDistance: lockMgr.getRequestDistanceFromMergingStr(),
      waitDistance: lockMgr.getWaitDistanceFromMergingStr(),
    });
  }

  // 2. nextEdge들 순회 (최대 5개)
  for (const offset of NEXT_EDGE_OFFSETS) {
    const nextEdgeIdx = data[ptr + offset];
    if (nextEdgeIdx < 0) break;

    const nextEdge = edgeArray[nextEdgeIdx];
    if (!nextEdge) break;

    // 곡선이고 tn이 합류점이면 → 곡선 합류
    if (nextEdge.vos_rail_type !== EdgeType.LINEAR && lockMgr.isMergeNode(nextEdge.to_node)) {
      targets.push({
        type: 'CURVE',
        mergeNode: nextEdge.to_node,
        requestEdge: nextEdge.edge_name,
        distanceToMerge: accumulatedDist,
        requestDistance: lockMgr.getRequestDistanceFromMergingCurve(),
        waitDistance: lockMgr.getWaitDistanceFromMergingCurve(),
      });
    }
    // 직선이고 tn이 합류점이면 → 직선 합류
    else if (lockMgr.isMergeNode(nextEdge.to_node)) {
      targets.push({
        type: 'STRAIGHT',
        mergeNode: nextEdge.to_node,
        requestEdge: nextEdge.edge_name,
        distanceToMerge: accumulatedDist + nextEdge.distance,
        requestDistance: lockMgr.getRequestDistanceFromMergingStr(),
        waitDistance: lockMgr.getWaitDistanceFromMergingStr(),
      });
    }

    accumulatedDist += nextEdge.distance;
  }

  return targets;
}
```

#### findFirstBlockingMerge() - 락 없는 첫 merge 찾기

```typescript
export function findFirstBlockingMerge(
  lockMgr: LockMgr,
  edgeArray: Edge[],
  currentEdge: Edge,
  currentRatio: number,
  vehId: number,
  data: Float32Array,
  ptr: number
): BlockingMergeResult | null {
  // 곡선에서는 이미 lock 처리가 끝난 상태로 간주
  if (currentEdge.vos_rail_type !== EdgeType.LINEAR) {
    return null;
  }

  const mergeTargets = findAllMergeTargets(lockMgr, edgeArray, currentEdge, currentRatio, data, ptr);

  for (const target of mergeTargets) {
    // 아직 request 지점에 도달 안 했으면 skip
    if (!shouldRequestLockNow(target.distanceToMerge, target.requestDistance)) {
      continue;
    }

    // Lock 획득 여부 확인
    const isGranted = lockMgr.checkGrant(target.mergeNode, vehId);

    if (!isGranted) {
      // 이 merge가 첫 번째 blocking merge
      const distanceToWait = target.distanceToMerge - target.waitDistance;
      return {
        mergeTarget: target,
        distanceToWait: Math.max(0, distanceToWait)
      };
    }
  }

  // 모든 merge에서 lock 획득 성공
  return null;
}
```

#### processMergeLogicInline() - 락 요청/승인/대기

```typescript
function processMergeLogicInline(
  lockMgr: LockMgr,
  edgeArray: Edge[],
  currentEdge: Edge,
  vehId: number,
  currentRatio: number,
  data: Float32Array,
  ptr: number,
  target: PositionResult
): boolean {
  // 곡선 위에서는 기본적으로 lock 계산 안 함
  if (currentEdge.vos_rail_type !== EdgeType.LINEAR) {
    const currentTrafficState = data[ptr + LogicData.TRAFFIC_STATE];

    // ACQUIRED 상태면 그대로 유지
    if (currentTrafficState === TrafficState.ACQUIRED) {
      return false;
    }

    // 곡선→곡선→합류 케이스 처리
    const nextEdgeIdx = data[ptr + MovementData.NEXT_EDGE_0];
    if (nextEdgeIdx >= 0) {
      const nextEdge = edgeArray[nextEdgeIdx];
      if (nextEdge &&
          nextEdge.vos_rail_type !== EdgeType.LINEAR &&  // 다음도 곡선
          lockMgr.isMergeNode(nextEdge.to_node)) {       // 그 곡선의 tn이 합류노드

        // 현재 곡선의 남은 거리로 lock 요청 시점 판단
        const remainingDist = currentEdge.distance * (1 - currentRatio);
        const requestDist = lockMgr.getRequestDistanceFromMergingCurve();

        if (remainingDist <= requestDist) {
          lockMgr.requestLock(nextEdge.to_node, nextEdge.edge_name, vehId);
          const isGranted = lockMgr.checkGrant(nextEdge.to_node, vehId);

          if (!isGranted) {
            data[ptr + LogicData.TRAFFIC_STATE] = TrafficState.WAITING;
            // mergeBraking에서 감속 처리됨
            return false;
          }
          data[ptr + LogicData.TRAFFIC_STATE] = TrafficState.ACQUIRED;
        }
      }
    }

    return false;
  }

  // 경로 전체를 탐색해서 합류점 찾기
  const mergeTargets = findAllMergeTargets(lockMgr, edgeArray, currentEdge, currentRatio, data, ptr);

  // 합류점이 없으면 자유 통행
  if (mergeTargets.length === 0) {
    const currentReason = data[ptr + LogicData.STOP_REASON];
    if ((currentReason & StopReason.LOCKED) !== 0) {
      data[ptr + LogicData.STOP_REASON] = currentReason & ~StopReason.LOCKED;
    }
    data[ptr + LogicData.TRAFFIC_STATE] = TrafficState.FREE;
    return false;
  }

  const currentTrafficState = data[ptr + LogicData.TRAFFIC_STATE];
  const currentReason = data[ptr + LogicData.STOP_REASON];

  // 각 merge target을 순차적으로 처리
  for (const mergeTarget of mergeTargets) {
    const shouldRequest = shouldRequestLockNow(mergeTarget.distanceToMerge, mergeTarget.requestDistance);

    if (!shouldRequest) {
      continue;
    }

    // 요청 시점 도달 - Lock 요청
    lockMgr.requestLock(mergeTarget.mergeNode, mergeTarget.requestEdge, vehId);

    // Lock 획득 여부 확인
    const isGranted = lockMgr.checkGrant(mergeTarget.mergeNode, vehId);

    // 로그 중복 방지
    if (mergeTarget.type === 'CURVE') {
      const now = Date.now();
      const prevLogState = mergeLockLogStates.get(vehId);
      const stateChanged = !prevLogState ||
        prevLogState.lastMergeNode !== mergeTarget.mergeNode ||
        prevLogState.lastRequestEdge !== mergeTarget.requestEdge ||
        prevLogState.lastIsGranted !== isGranted;
      const timeElapsed = !prevLogState || (now - prevLogState.lastLogTime) >= LOG_THROTTLE_MS;

      if (stateChanged || timeElapsed) {
        devLog.veh(vehId).debug(`[MERGE_LOCK] 곡선 합류 락: ...`);
        mergeLockLogStates.set(vehId, { ... });
      }
    }

    if (!isGranted) {
      // Lock 획득 실패 - 이 target의 wait 지점에서 대기
      data[ptr + LogicData.TRAFFIC_STATE] = TrafficState.WAITING;

      const distanceToWait = mergeTarget.distanceToMerge - mergeTarget.waitDistance;

      if (distanceToWait <= 0) {
        // 대기 지점을 넘어갔으면 되돌림
        const waitRatio = currentRatio + distanceToWait / currentEdge.distance;

        if (waitRatio < 0) {
          devLog.veh(vehId).error(`[MERGE_WAIT] BUG: 대기지점이 현재 edge 이전에 있음!`);
          data[ptr + LogicData.STOP_REASON] = currentReason | StopReason.LOCKED;
          target.x = 0;
          return true;
        }

        data[ptr + LogicData.STOP_REASON] = currentReason | StopReason.LOCKED;
        target.x = waitRatio;
        return true;
      }

      // 대기 지점 이전이면 현재 위치 유지
      if ((currentReason & StopReason.LOCKED) !== 0) {
        data[ptr + LogicData.STOP_REASON] = currentReason & ~StopReason.LOCKED;
      }
      return false;
    }

    // 이 target의 lock 획득 성공 → 다음 target 확인
  }

  // 모든 도달한 target의 lock 획득 성공
  if ((currentReason & StopReason.LOCKED) !== 0) {
    data[ptr + LogicData.STOP_REASON] = currentReason & ~StopReason.LOCKED;
  }

  const anyRequested = mergeTargets.some(t => shouldRequestLockNow(t.distanceToMerge, t.requestDistance));
  const newState = anyRequested ? TrafficState.ACQUIRED : TrafficState.FREE;

  data[ptr + LogicData.TRAFFIC_STATE] = newState;

  return false;
}
```

#### 로그 중복 방지

```typescript
interface MergeLockLogState {
  lastMergeNode: string;
  lastRequestEdge: string;
  lastIsGranted: boolean;
  lastLogTime: number;
}
const mergeLockLogStates = new Map<number, MergeLockLogState>();
const LOG_THROTTLE_MS = 2000; // 같은 상태일 때 2초마다만 로그
```

---

### 4. mergeBraking.ts (103줄) - 합류 사전 감속

```typescript
export function checkMergePreBraking({
  vehId,
  currentEdge,
  currentRatio,
  currentVelocity,
  edgeArray,
  lockMgr,
  config,
  data,
  ptr,
}: {
  vehId: number;
  currentEdge: Edge;
  currentRatio: number;
  currentVelocity: number;
  edgeArray: Edge[];
  lockMgr: LockMgr;
  config: MovementConfig;
  data: Float32Array;
  ptr: number;
}): MergeBrakeCheckResult {
  const noResult: MergeBrakeCheckResult = {
    shouldBrake: false,
    deceleration: 0,
    distanceToMerge: Infinity,
  };

  // 곡선 Edge에서는 merge 사전 감속 적용 안 함
  if (currentEdge.vos_rail_type !== EdgeType.LINEAR) {
    return noResult;
  }

  // 1. "lock을 못 받은 첫 번째 merge" 찾기
  const blockingMerge = findFirstBlockingMerge(lockMgr, edgeArray, currentEdge, currentRatio, vehId, data, ptr);

  // Blocking merge가 없으면 (락 획득 성공) → 감속 안 함
  if (!blockingMerge) {
    return noResult;
  }

  // Blocking merge가 있으면 해당 wait 지점까지 거리 기반 감속
  const { mergeTarget, distanceToWait } = blockingMerge;

  // 이미 wait 지점을 지났으면 감속하지 않음
  if (distanceToWait <= 0) {
    return noResult;
  }

  // 감속 필요 거리 계산
  const deceleration = config.linearPreBrakeDeceleration ?? -2.0;
  const brakeDistance = calculateBrakeDistance(currentVelocity, 0, deceleration);

  devLog.veh(vehId).debug(
    `[MERGE_BRAKE] blocking=${mergeTarget.mergeNode}(${mergeTarget.type}) distToWait=${distanceToWait.toFixed(2)} brakeDist=${brakeDistance.toFixed(2)}`
  );

  if (distanceToWait <= brakeDistance) {
    return {
      shouldBrake: true,
      deceleration,
      distanceToMerge: distanceToWait,
    };
  }

  return noResult;
}
```

**호출 위치:** `vehiclePhysics.ts`에서 속도 계산 시

---

### 5. edgeTransition.ts (344줄)

#### handleEdgeTransition() - Edge 전환 & 락 체크

```typescript
export function handleEdgeTransition(params: EdgeTransitionParams): void {
  const { vehicleDataArray, store, vehicleIndex, initialEdgeIndex, initialRatio, edgeArray, target, lockMgr } = params;

  let currentEdgeIdx = initialEdgeIndex;
  let currentRatio = initialRatio;
  let currentEdge = edgeArray[currentEdgeIdx];

  const data = vehicleDataArray.getData();
  const ptr = vehicleIndex * VEHICLE_DATA_SIZE;

  while (currentEdge && currentRatio >= 1) {
    const nextState = data[ptr + MovementData.NEXT_EDGE_STATE];
    const nextEdgeIndex = data[ptr + MovementData.NEXT_EDGE_0];
    const trafficState = data[ptr + LogicData.TRAFFIC_STATE];

    // Edge transition 가능 여부 체크
    if (lockMgr) {
      // 1. 현재 edge의 to_node가 merge node이고 lock이 없으면 block
      if (lockMgr.isMergeNode(currentEdge.to_node)) {
        const isGranted = lockMgr.checkGrant(currentEdge.to_node, vehicleIndex);
        if (!isGranted) {
          devLog.veh(vehicleIndex).debug(
            `[EDGE_TRANSITION] blocked: to_node=${currentEdge.to_node} lock not granted`
          );
          currentRatio = 1;
          break;
        }
      }

      // 2. 다음 edge가 곡선이고 그 to_node가 merge node면 대기
      // (곡선 위에서는 감속 불가능하므로, 곡선 진입 전에 대기해야 함)
      // - 직선→곡선→합류: 직선 끝에서 대기
      // - 곡선→곡선→합류: 첫 곡선 끝에서 대기
      if (nextEdgeIndex >= 0 && nextEdgeIndex < edgeArray.length) {
        const nextEdgeForCheck = edgeArray[nextEdgeIndex];
        if (nextEdgeForCheck &&
            nextEdgeForCheck.vos_rail_type !== EdgeType.LINEAR &&
            lockMgr.isMergeNode(nextEdgeForCheck.to_node)) {
          const isGranted = lockMgr.checkGrant(nextEdgeForCheck.to_node, vehicleIndex);
          if (!isGranted) {
            const currentType = currentEdge.vos_rail_type === EdgeType.LINEAR ? 'linear' : 'curve';
            devLog.veh(vehicleIndex).debug(
              `[EDGE_TRANSITION] ${currentType}→curve→merge 대기: nextEdge=${nextEdgeForCheck.edge_name}, mergeNode=${nextEdgeForCheck.to_node}`
            );
            currentRatio = 1;
            break;
          }
        }
      }
    } else {
      // 하위 호환: lockMgr 없으면 기존 WAITING 전역 체크
      if (trafficState === TrafficState.WAITING) {
        currentRatio = 1;
        break;
      }
    }

    if (nextState !== NextEdgeState.READY || nextEdgeIndex === -1) {
      currentRatio = 1;
      break;
    }

    const nextEdge = edgeArray[nextEdgeIndex];
    if (!nextEdge) {
      currentRatio = 1;
      break;
    }

    // [UnusualMove] Edge 전환 시 연결 여부 검증
    if (currentEdge.to_node !== nextEdge.from_node) {
      const prevX = data[ptr + MovementData.X];
      const prevY = data[ptr + MovementData.Y];
      devLog.veh(vehicleIndex).error(
        `[UnusualMove] 연결되지 않은 edge로 이동! ` +
        `prevEdge=${currentEdge.edge_name}(to:${currentEdge.to_node}) → ` +
        `nextEdge=${nextEdge.edge_name}(from:${nextEdge.from_node}), ` +
        `pos: (${prevX.toFixed(2)},${prevY.toFixed(2)})`
      );
    }

    store.moveVehicleToEdge(vehicleIndex, nextEdgeIndex, overflowDist / nextEdge.distance);

    updateSensorPresetForEdge(vehicleDataArray, vehicleIndex, nextEdge);

    data[ptr + LogicData.TRAFFIC_STATE] = TrafficState.FREE;
    const currentReason = data[ptr + LogicData.STOP_REASON];
    if ((currentReason & StopReason.LOCKED) !== 0) {
      data[ptr + LogicData.STOP_REASON] = currentReason & ~StopReason.LOCKED;
    }

    // Next Edge 배열을 한 칸씩 앞으로 당기고 마지막 슬롯 채우기
    shiftAndRefillNextEdges(data, ptr, vehicleIndex, pathBufferFromAutoMgr, edgeArray);

    // ... (나머지 로직)
  }

  target.finalEdgeIndex = currentEdgeIdx;
  target.finalRatio = currentRatio;
  target.activeEdge = currentEdge || null;
}
```

#### shiftAndRefillNextEdges() - pathBuffer 동기화

```typescript
function shiftAndRefillNextEdges(
  data: Float32Array,
  ptr: number,
  vehicleIndex: number,
  pathBufferFromAutoMgr: Int32Array | null | undefined,
  edgeArray: Edge[]
): void {
  // 1. pathBuffer shift (맨 앞 edge 제거)
  if (pathBufferFromAutoMgr) {
    const pathPtr = vehicleIndex * MAX_PATH_LENGTH;
    const beforePathLen = pathBufferFromAutoMgr[pathPtr + PATH_LEN];

    if (beforePathLen > 0) {
      // 실제 shift: 모든 edge를 한 칸 앞으로
      for (let i = 0; i < beforePathLen - 1; i++) {
        pathBufferFromAutoMgr[pathPtr + PATH_EDGES_START + i] =
          pathBufferFromAutoMgr[pathPtr + PATH_EDGES_START + i + 1];
      }
      // 길이 감소
      pathBufferFromAutoMgr[pathPtr + PATH_LEN] = beforePathLen - 1;
    }
  }

  // 2. nextEdges shift: 0 <- 1, 1 <- 2, 2 <- 3, 3 <- 4
  data[ptr + MovementData.NEXT_EDGE_0] = data[ptr + MovementData.NEXT_EDGE_1];
  data[ptr + MovementData.NEXT_EDGE_1] = data[ptr + MovementData.NEXT_EDGE_2];
  data[ptr + MovementData.NEXT_EDGE_2] = data[ptr + MovementData.NEXT_EDGE_3];
  data[ptr + MovementData.NEXT_EDGE_3] = data[ptr + MovementData.NEXT_EDGE_4];

  // 3. NEXT_EDGE_4를 pathBuffer[4]에서 채우기 (shift 후 기준)
  let newLastEdge = -1;
  if (pathBufferFromAutoMgr && afterPathLen > 0) {
    const pathPtr = vehicleIndex * MAX_PATH_LENGTH;
    const pathOffset = NEXT_EDGE_COUNT - 1; // = 4
    if (pathOffset < afterPathLen) {
      const candidateEdgeIdx = pathBufferFromAutoMgr[pathPtr + PATH_EDGES_START + pathOffset];
      if (candidateEdgeIdx >= 0 && candidateEdgeIdx < edgeArray.length) {
        newLastEdge = candidateEdgeIdx;
      }
    }
  }
  data[ptr + MovementData.NEXT_EDGE_4] = newLastEdge;

  // NEXT_EDGE_0이 비어있으면 STATE도 EMPTY로
  if (data[ptr + MovementData.NEXT_EDGE_0] === -1) {
    data[ptr + MovementData.NEXT_EDGE_STATE] = NextEdgeState.EMPTY;
  }
}
```

---

## 로직 흐름도

### 1️⃣ 직선 합류 (Straight Merge)

```
[차량 이동 중] (vehiclePosition.ts)
    │
    ▼
findAllMergeTargets(lockMgr, edgeArray, currentEdge, ...)
    │ ← 경로상 모든 합류점 탐색
    │ ← STRAIGHT 타입 식별
    ▼
shouldRequestLockNow(distanceToMerge, requestDistance)
    │ ← 요청 거리 도달 여부 확인
    ▼
processMergeLogicInline(lockMgr, ...)
    │
    ├─► lockMgr.requestLock(nodeName, edgeName, vehId)
    │       │ ← requests 배열에 추가
    │       │ ← FIFO: 즉시 1개만 승인
    │       │ ← BATCH: step()에서 배치 승인
    │       ▼
    │   [requests queue에 추가됨]
    │
    ├─► lockMgr.checkGrant(nodeName, vehId)
    │       │ ← granted 배열에 있는지 확인
    │       ▼
    │   [승인 여부 반환]
    │
    ├─► 승인 O → 통과 (TRAFFIC_STATE = ACQUIRED)
    │   승인 X → findFirstBlockingMerge()
    │       │ ← 대기 지점 계산
    │       │ ← ratio 조정으로 속도 제한
    │       │ ← TRAFFIC_STATE = WAITING
    │       ▼
    │   [합류점 앞에서 대기]
    │
    └─► [Edge 전환 시]
        lockMgr.releaseLock(nodeName, vehId)
            │ ← granted 배열에서 제거
            │ ← 다음 차량에게 기회 제공
            ▼
        [락 해제 완료]
```

### 2️⃣ 곡선 합류 (Curve Merge)

```
[직선 edge] (곡선 진입 전)
    │
    ▼
findAllMergeTargets()
    │ ← 앞의 curve가 merge인지 확인
    │ ← CURVE_BEFORE_MERGE 타입 식별
    ▼
lockMgr.requestLock(curveEndNode, nextEdge, vehId)
    │ ← 미리 락 요청 (curve 진입 전)
    ▼
[직선 → 곡선 전환 시점]
    │
    ▼
handleEdgeTransition(params) (edgeTransition.ts)
    │
    ├─► lockMgr.checkGrant(curveEndNode, vehId)
    │       ▼
    │   승인 O → curve 진입 허용
    │   승인 X → edge 전환 차단
    │       │ ← ratio = 1로 고정 (곡선 진입 전 정지)
    │       │ ← TRAFFIC_STATE = WAITING
    │       ▼
    │   [curve 진입 전 대기]
    │
    └─► [curve 통과 후]
        lockMgr.releaseLock(curveEndNode, vehId)
            ▼
        [다음 edge로 이동]
```

### 3️⃣ 곡선→곡선→합류 (특수 케이스)

```
[첫 번째 곡선 edge]
    │
    ▼
processMergeLogicInline() (vehiclePosition.ts 434-464줄)
    │ ← currentEdge가 곡선
    │ ← nextEdge도 곡선
    │ ← nextEdge.to_node가 merge node
    ▼
remainingDist <= requestDist?
    │
    ├─► Yes → lockMgr.requestLock(nextEdge.to_node, nextEdge.edge_name, vehId)
    │       │
    │       ├─► isGranted?
    │       │       │
    │       │       ├─► Yes → TRAFFIC_STATE = ACQUIRED
    │       │       └─► No  → TRAFFIC_STATE = WAITING
    │       │                 mergeBraking에서 감속 처리
    │       ▼
    │   [두 번째 곡선 진입 전 대기 또는 진입]
    │
    └─► No  → 계속 진행
        ▼
    [첫 번째 곡선 → 두 번째 곡선 전환]
        │
        ▼
    handleEdgeTransition() (edgeTransition.ts 142-157줄)
        │
        ├─► nextEdge가 곡선이고 to_node가 merge?
        │       │
        │       ├─► Yes → checkGrant()
        │       │       │
        │       │       ├─► Yes → 전환 허용
        │       │       └─► No  → ratio = 1 (대기)
        │       │
        │       └─► No  → 일반 전환
        │
        └─► [두 번째 곡선 통과 후 락 해제]
```

### 4️⃣ 합류 사전 감속 (mergeBraking.ts)

```
[차량 이동 중] (vehiclePhysics.ts)
    │
    ▼
checkMergePreBraking(lockMgr, currentEdge, currentRatio, ...)
    │
    ├─► findFirstBlockingMerge(lockMgr, ...)
    │       │ ← "lock 못 받은 첫 번째 merge" 찾기
    │       ▼
    │   blocking merge 있음?
    │       │
    │       ├─► Yes → distanceToWait 계산
    │       │       │
    │       │       ├─► distanceToWait <= brakeDistance?
    │       │       │       │
    │       │       │       ├─► Yes → 감속 시작 (deceleration = -2.0)
    │       │       │       └─► No  → 감속 안 함
    │       │       ▼
    │       │   { shouldBrake: true/false, deceleration, distanceToMerge }
    │       │
    │       └─► No  → 감속 안 함 (lock 획득 성공)
    │
    ▼
calculateNextSpeed(velocity, accel, decel)
    │ ← 감속 적용
    ▼
[속도 업데이트]
    │
    ▼
processMergeLogicInline(lockMgr, ...)
    │ ← 대기 지점 도달 체크
    │ ← ratio 되돌림 (필요 시)
    ▼
[TRAFFIC_STATE 업데이트]
```

### 5️⃣ BATCH 전략 처리

```
[매 프레임]
    │
    ▼
lockMgr.step() (LockMgr.ts)
    │
    ▼
BatchController.tryGrant()
    │
    ├─► currentEdgeIndex로 edge 선택 (round-robin)
    │       ▼
    │   해당 edge의 requests 큐에서 차량 꺼냄
    │       ▼
    │   batchSize만큼 승인
    │       ▼
    │   passCounter++
    │       ▼
    │   passCounter >= passLimit?
    │       │
    │       ├─► Yes → hasWaitingVehiclesOnOtherEdges() 체크
    │       │       │
    │       │       ├─► Yes → currentEdgeIndex++ (다음 edge로)
    │       │       └─► No  → passCounter 리셋, 같은 edge 계속
    │       │
    │       └─► No  → 같은 edge 계속
    │
    └─► granted 배열에 추가
            ▼
        checkGrant()로 확인 가능
```

### 6️⃣ 경로 변경 시 락 취소

```
[차량 경로 재계산] (AutoMgr.ts)
    │
    ▼
assignRandomDestination(vehId, newDestNodeName)
    │ ← MAX_PATH_FINDS_PER_FRAME = 10으로 제한
    │ ← round-robin으로 공정하게 처리
    ▼
findShortestPath(currentNode, newDestNodeName)
    │ ← Dijkstra로 새 경로 계산
    ▼
cancelObsoleteLocks(vehId, newPathIndices, edgeArray, lockMgr)
    │
    ├─► findLocksToCancel(vehId, newPathIndices, edgeArray, lockMgr)
    │       │
    │       ├─► lockMgr.getLocksForVehicle(vehId)
    │       │       ▼
    │       │   [차량이 보유한 모든 락 조회]
    │       │
    │       └─► 새 경로에 없는 노드 필터링
    │               ▼
    │           obsoleteNodes[]
    │
    └─► for (nodeName of obsoleteNodes)
            lockMgr.cancelLock(nodeName, vehId)
                │ ← requests에서 제거
                │ ← granted에서 제거
                │ ← edgeQueue 재구성 (O(n))
                │ ← BATCH: batchReleasedCount 조정
                ▼
            [불필요한 락 취소 완료]
```

### 7️⃣ Worker ↔ Main Thread 통신

```
[Main Thread: LockInfoPanel.tsx]
    │
    ├─► Array Mode:
    │       └─► getLockMgr() 직접 호출
    │               ▼
    │           실시간 락 테이블 조회
    │
    └─► SHM Mode:
            │
            ▼
        postMessage({ type: "GET_LOCK_TABLE", fabId, requestId })
            │
            ▼
        [Worker Thread: worker.entry.ts]
            │
            ▼
        handleGetLockTable(fabId, requestId)
            │
            ▼
        engine.getLockTableData(fabId)
            │
            ▼
        fabContext.getLockTableData()
            │ ← lockMgr → LockNodeData 변환
            │ ← 직렬화 가능한 형태로
            ▼
        postMessage({ type: "LOCK_TABLE", fabId, requestId, data })
            │
            ▼
        [Main Thread: LockInfoPanel.tsx]
            │
            ▼
        setState(lockTableData)
            │
            ▼
        UI 업데이트: granted/requests 표시
```

---

## 상태 관리

### TrafficState (3가지 상태)

```typescript
export const TrafficState = {
  FREE: 0,      // 자유 통행 (merge 아님)
  WAITING: 1,   // 락 대기 중
  ACQUIRED: 2,  // 락 획득 (진입 가능)
} as const;
```

**상태 전환 흐름:**
```
FREE (자유 통행)
  │
  ├─► merge node 도달
  │   requestLock()
  │       ▼
  │   WAITING (락 대기)
  │       │
  │       ├─► checkGrant() == true
  │       │       ▼
  │       │   ACQUIRED (락 획득)
  │       │       │
  │       │       └─► edge 전환
  │       │               ▼
  │       │           FREE (해제)
  │       │
  │       └─► checkGrant() == false
  │               ▼
  │           WAITING 유지 (대기 계속)
  │
  └─► merge node 아님
          ▼
      FREE 유지
```

### StopReason (비트 플래그)

```typescript
export const StopReason = {
  NONE: 0,
  OBS_LIDAR: 1,              // 1 << 0
  OBS_CAMERA: 1 << 1,        // 2
  E_STOP: 1 << 2,            // 4
  LOCKED: 1 << 3,            // 8 ⭐ 락 대기
  DESTINATION_REACHED: 1 << 4,
  PATH_BLOCKED: 1 << 5,
  LOAD_ON: 1 << 6,
  LOAD_OFF: 1 << 7,
  NOT_INITIALIZED: 1 << 8,
  INDIVIDUAL_CONTROL: 1 << 9,
  SENSORED: 1 << 10,         // 1024 ⭐ 센서 감지
} as const;
```

**비트 플래그 조작:**
```typescript
// 플래그 추가
data[ptr + LogicData.STOP_REASON] = currentReason | StopReason.LOCKED;

// 플래그 제거
data[ptr + LogicData.STOP_REASON] = currentReason & ~StopReason.LOCKED;

// 플래그 확인
if ((currentReason & StopReason.LOCKED) !== 0) {
  // LOCKED 플래그가 설정되어 있음
}
```

**LOCKED vs SENSORED 차이:**
- **LOCKED**: 합류점에서 락 대기 중 (merge node 제어)
- **SENSORED**: 앞차와 충돌 위험으로 감속/정지 (센서 제어)

---

## 핵심 개념 정리

### LockMgr의 역할
1. **Merge Node 관리**: 합류점마다 독립적인 락 상태 유지
2. **공정성 보장**: BATCH 전략으로 edge 간 균형 유지
3. **데드락 방지**: 경로 변경 시 자동으로 obsolete 락 취소
4. **성능 최적화**: RingBuffer로 O(1) enqueue/dequeue

### 직선 vs 곡선 합류 차이

| 구분 | 직선 합류 | 곡선 합류 |
|------|-----------|-----------|
| **요청 시점** | 합류점 N미터 앞 | 이전 직선 edge에서 |
| **대기 방식** | 합류점 앞에서 감속/정지 | edge 전환 차단 (ratio=1 고정) |
| **감속 처리** | mergeBraking.ts에서 사전 감속 | 이전 edge에서 미리 감속 |
| **해제 시점** | 다음 edge 진입 시 | 곡선 통과 후 |
| **이유** | 직선에서는 감속 가능 | 곡선에서는 감속 불가능 |

### BATCH 전략 핵심 파라미터

| 파라미터 | 기본값 | 설명 |
|----------|--------|------|
| **batchSize** | 5 | 동시에 grant 가능한 최대 대수 |
| **passLimit** | 3 | 한 edge에서 최대 통과 가능 대수 |
| **currentBatchEdge** | null | 현재 처리 중인 edge |
| **batchGrantedCount** | 0 | 현재 batch에서 승인한 차량 수 |
| **batchReleasedCount** | 0 | 현재 batch에서 통과한 차량 수 |
| **edgePassCount** | 0 | 현재 edge에서 통과한 총 차량 수 |
| **passLimitReached** | false | passLimit 도달 여부 |

**동작 원리:**
1. 한 edge에서 batchSize(5)만큼 동시 승인
2. 승인받은 차량들이 통과할 때마다 edgePassCount 증가
3. edgePassCount가 passLimit(3)에 도달하면:
   - 다른 edge에 대기 차량 있음 → 다음 edge로 전환
   - 다른 edge에 대기 차량 없음 → passLimit 리셋하고 계속
4. round-robin으로 edge 순회하여 공정성 보장

### 거리 파라미터

| 파라미터 | 직선 | 곡선 | 설명 |
|----------|------|------|------|
| **requestDistance** | 예: 10m | 예: 5m | 락 요청 시작 거리 (합류점으로부터) |
| **waitDistance** | 예: 5m | 예: 2m | 대기 지점 거리 (합류점으로부터) |

**시각화:**
```
직선 합류:
●──────────────────────────────────────────►● Merge Node
                     ↑              ↑
              requestDistance  waitDistance
              (10m 전)         (5m 전)

곡선 합류:
●────────(직선)────────►●───(곡선)───►● Merge Node
              ↑                  ↑
       requestDistance      waitDistance
       (이전 직선에서)      (곡선 진입 전)
```

---

## 체크리스트

### 락 관련 핵심 파일 & 함수

| 파일 | 주요 클래스/함수 | 역할 | 완료 |
|------|------------------|------|------|
| **LockMgr.ts** | LockMgr, BatchController, RingBuffer | 핵심 락 관리 | ✅ |
| | requestLock, releaseLock, checkGrant, cancelLock | 기본 락 조작 | ✅ |
| | getLocksForVehicle | 차량의 모든 락 조회 | ✅ |
| | step | BATCH 전략 grant 처리 | ✅ |
| | reset, getGrantStrategy | 초기화 & 조회 | ✅ |
| **AutoMgr.ts** | AutoMgr | 경로 변경 & 락 취소 | ✅ |
| | initStations, update, dispose | 초기화 & 업데이트 | ✅ |
| | findLocksToCancel, cancelObsoleteLocks | 불필요한 락 제거 | ✅ |
| | getDestinationInfo | 목적지 조회 | ✅ |
| **vehiclePosition.ts** | findAllMergeTargets, findFirstBlockingMerge | 합류점 탐색 | ✅ |
| | processMergeLogicInline | 락 요청/승인/대기 | ✅ |
| | 곡선→곡선→합류 케이스 (434-464줄) | 특수 케이스 처리 | ✅ |
| | MergeLockLogState (로그 throttle) | 성능 최적화 | ✅ |
| **mergeBraking.ts** | checkMergePreBraking | 합류 사전 감속 | ✅ |
| **edgeTransition.ts** | handleEdgeTransition | Edge 전환 & 락 체크 | ✅ |
| | 곡선→곡선→합류 대기 (142-157줄) | 특수 케이스 처리 | ✅ |
| | shiftAndRefillNextEdges | pathBuffer 동기화 | ✅ |
| | [UnusualMove] 연결 검증 | 디버깅 로직 | ✅ |
| **constants.ts** | TrafficState, StopReason | 상태 & 플래그 정의 | ✅ |
| **LockInfoPanel.tsx** | LockInfoPanel | UI 표시 | ✅ |
| **FabContext.ts** | getLockTableData | 락 테이블 직렬화 | ✅ |
| **SimulationEngine.ts** | getLockTableData(fabId) | Fab별 락 조회 | ✅ |
| **worker.entry.ts** | handleGetLockTable | Worker 메시지 처리 | ✅ |
| **types.ts** | LockNodeData, LockTableData | 타입 정의 | ✅ |

### 중요 특수 케이스

| 케이스 | 처리 위치 | 설명 | 완료 |
|--------|-----------|------|------|
| 직선→직선→합류 | vehiclePosition.ts | processMergeLogicInline의 되돌림 로직 | ✅ |
| 직선→곡선→합류 | edgeTransition.ts (142-157줄) | 직선 끝에서 대기 | ✅ |
| 곡선→곡선→합류 | vehiclePosition.ts (434-464줄) + edgeTransition.ts | 첫 곡선 끝에서 대기 | ✅ |
| 합류 사전 감속 | mergeBraking.ts | findFirstBlockingMerge 기반 감속 | ✅ |
| 경로 변경 시 락 취소 | AutoMgr.ts | cancelObsoleteLocks | ✅ |
| pathBuffer 동기화 | edgeTransition.ts | shiftAndRefillNextEdges | ✅ |
| 로그 중복 방지 | vehiclePosition.ts | MergeLockLogState (2초 throttle) | ✅ |

---

## 마무리

이 문서는 VPS 락 시스템의 **모든 파일, 함수, 로직**을 완벽하게 정리한 완전 가이드입니다.

### 핵심 요약
1. **LockMgr.ts** - 핵심 락 관리자 (FIFO/BATCH 전략)
2. **AutoMgr.ts** - 경로 변경 시 락 취소
3. **vehiclePosition.ts** - 락 요청/승인/대기 처리
4. **mergeBraking.ts** - 합류 사전 감속
5. **edgeTransition.ts** - Edge 전환 시 락 체크 & pathBuffer 동기화
6. **특수 케이스** - 곡선→곡선→합류, 로그 throttle, 연결 검증

### 추가 학습 자료
- **LockMgr Policy 설계 문서**: `doc/dev_req/LockMgr_Policy_Plan.md`
- **Movement System README**: `src/common/vehicle/movement/README.md`
- **Logic Manager README**: `src/common/vehicle/logic/README.md`
