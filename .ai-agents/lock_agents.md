# Lock System - AI Context

## 상태: 재설계 중

기존 락 시스템이 **삭제**되었습니다. 새로운 단순한 락 시스템으로 교체 예정입니다.

## 삭제된 파일/코드

- `LockMgr.ts`: 복잡한 BATCH/FIFO/ARRIVAL_ORDER 전략 → **stub으로 대체**
- `vehiclePosition.ts`: processMergeLogicInline, findAllMergeTargets 등 → **제거**
- `mergeBraking.ts`: 합류점 사전 감속 → **비활성화**
- `edgeTransition.ts`: checkLockBlocking → **제거**
- `TransferMgr.ts`: fillNextEdgesFromPathBuffer의 merge 체크 → **제거**

## 현재 상태

- `LockMgr`는 빈 stub (항상 `checkGrant() = true` 반환)
- 모든 차량이 합류점에서 대기 없이 통과
- 충돌 방지는 없음 (센서 충돌만 동작)

## 새 락 시스템 설계 예정

### 기본 원칙
1. **단순함**: edge 전환 시점에만 체크
2. **한 곳에서**: 모든 lock 요청/체크를 한 곳에서
3. **FIFO**: 먼저 요청한 차량이 먼저 통과

### 예정 구조
```
SimpleLockMgr:
  - mergeNodes: Set<string>           // merge node 목록
  - locks: Map<nodeName, vehId>       // 현재 잡고 있는 차량
  - queues: Map<nodeName, vehId[]>    // 대기 큐 (FIFO)

  request(node, vehId):
    - locks에 없으면 즉시 grant
    - 있으면 queue에 추가

  release(node, vehId):
    - locks에서 제거
    - queue 맨 앞 차량에게 grant

  hasLock(node, vehId):
    - locks[node] === vehId
```

### 호출 위치 (예정)
- `edgeTransition.handleEdgeTransition`:
  - ratio >= 1 && nextEdge.to_node가 merge
  - → request → hasLock → 통과/대기

---

**TODO**: 사용자와 함께 새 락 시스템 설계
