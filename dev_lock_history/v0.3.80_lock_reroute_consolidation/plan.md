# v0.3.80 계획: 경로 변경 시 Lock 처리 통합 (Step 4.5)

## 1. Simulation Step 구조

```
Step 1. Collision Check    — 센서 감지 → 감속/정지 결정
Step 2. Lock 처리          — checkpoint 히트 → REQ/GRANT/WAIT/REL (매 프레임 전체 차량)
Step 3. Movement Update    — 이동 + edge 전이
Step 4. Auto Routing       — 경로 변경 + checkpoint rebuild
Step 4.5 Lock 재정합       — 경로 변경된 차량만 lock 정합성 처리 ← 여기에 통합
Step 5. Replay Snapshot    — 리플레이용 기록
```

Lock은 Movement 전에 처리해야 함 (WAIT 차량 정지).
경로 변경은 Movement 후에 발생함.
→ 순서를 바꿀 수 없으므로 Step 4.5에서 **경로 변경된 차량만** 후처리.

## 2. 현재 문제: lock 관련 코드가 흩어져 있음

| 위치 | 하는 일 | 문제 |
|------|---------|------|
| `processPathCommand` (TransferMgr) | releaseOrphanedLocks 호출 | lock 로직이 TransferMgr에 섞임 |
| `buildCheckpoints` (TransferMgr) | checkpoint rebuild + head=0 리셋 | 이미 처리한 REQ가 날아감 |
| `checkAutoRelease` (LockMgr, Step 2) | 자동 해제 | 경로 변경 전 상태 기준 |
| `Step 4.5` (v0.3.79) | processLock 재호출 | 임시 땜빵, orphan 처리 없음 |

## 3. 수정 방향

### 원칙
- **processPathCommand에서는 lock을 건드리지 않음** — 경로/checkpoint만 세팅
- **경로 변경 시 필요한 정보를 저장**해두고, Step 4.5에서 일괄 처리
- Lock 관련 판단은 전부 LockMgr 쪽에서 수행

### Step 4.5 통합 처리 내용

경로 변경된 차량(`transferMgr.getPathChangedVehicles()`)에 대해 순서대로:

#### (1) orphaned lock 정리
- 신 경로에 없는 merge → HOLDER면 release + grantNext, 큐면 cancel
- 신 경로에 있는 merge:
  - WAIT 상태 (merge 직전 정지) → 유지
  - 물리 거리 < 20m → 유지 + releaseEdgeIdx 갱신
  - 물리 거리 ≥ 20m → HOLDER면 release, 큐면 cancel

#### (2) missed checkpoint 즉시 처리
- checkpoint rebuild로 새로 생긴 LOCK_REQUEST를 이미 지나쳤으면 → 즉시 REQ
- 이미 큐에 있는 merge면 → 중복 REQ 방지 (스킵)

#### (3) 중복 방지
- 해당 merge에 이미 REQ/큐 진입한 상태면 재REQ 안 함
- HOLDER 상태면 checkpoint 처리 불필요 (이미 통과 중)

## 4. 수정 파일 및 상세

### TransferMgr/index.ts
- `processPathCommand`에서 `releaseOrphanedLocks` 호출 **제거**
- `_pathChangedVehicles`에 경로 정보도 함께 저장:
  ```typescript
  interface PathChangeInfo {
    vehId: number;
    newPathEdges: number[];         // edgeIndicesWithCurrent
    newPathMergeNodes: Set<string>; // getMergeNodesInPath 결과
  }
  private _pathChangedVehicles: Map<number, PathChangeInfo>;
  ```

### LockMgr/index.ts
- `processPathChange(vehId, info)` 메서드 추가 — Step 4.5에서 호출
  - orphaned lock 처리 (기존 releaseOrphanedLocks 로직)
  - missed checkpoint 처리 (기존 processCheckpoint 로직)
  - 중복 REQ 방지 로직

### simulation-step.ts
- Step 4.5에서:
  ```typescript
  const pathChanged = transferMgr.getPathChangedVehicles();
  for (const [vehId, info] of pathChanged) {
    lockMgr.processPathChange(vehId, info);
  }
  transferMgr.clearPathChangedVehicles();
  ```

### ILockMgrForNextEdge (TransferMgr/types.ts)
- `releaseOrphanedLocks` 제거 (더 이상 TransferMgr에서 호출 안 함)

## 5. 검증 케이스

| 케이스 | 기대 동작 |
|--------|-----------|
| 먼 우회로 경로 변경 | Step 4.5에서 물리 거리 > 20m → cancel → 나중에 가까워지면 재REQ |
| 가까이서 경로 살짝 변경 | Step 4.5에서 물리 거리 < 20m → 큐 유지 |
| WAIT 상태에서 경로 변경 | 큐 유지 (merge 직전이라 cancel 위험) |
| HOLDER가 멀리 우회 | Step 4.5에서 release + grantNext |
| checkpoint rebuild 후 이미 지나침 | Step 4.5에서 즉시 REQ (1프레임 딜레이 없음) |
| 이미 큐에 있는 merge의 경로 변경 | 중복 REQ 방지 |

## 6. v0.3.70~79 수정 이력 요약

| 버전 | 수정 | 결과 |
|------|------|------|
| v0.3.70 | 미GRANT 큐 cancel | 가까운 차량도 cancel → 롤백 |
| v0.3.71 | 롤백 | 원래 문제 재발 |
| v0.3.72 | 직진/우회 edge count 판별 | HOLDER에도 적용 → HOLDER 해제 버그 |
| v0.3.73 | HOLDER 무조건 유지 | 멀리 우회해도 유지 |
| v0.3.74 | WAIT cancel 방지 | |
| v0.3.75 | 물리 위치 기반 판별 | currentEdge 기준 거리 |
| v0.3.76 | 물리 거리(m) + HOLDER도 체크 | edge count → meter |
| v0.3.79 | Step 4.5 processLock 재호출 | 임시 땜빵 |
| **v0.3.80** | **Step 4.5 통합** | **최종 구조** |

## 7. 별도 이슈 (이 PR 범위 밖)

- **merge 양쪽 센서 간섭**: fab_1_1 N0250, fab_2_1 N0049
  - HOLDER가 반대 branch WAIT 차량의 센서에 걸림
  - waiting_offset 또는 센서 제외 로직 필요
  - lock 통합과는 별개 문제
