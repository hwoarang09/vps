# Lock System - AI Agent Context

> 사람용 개념 문서: `doc/spec/Lock정리.md`
> 이 파일은 에이전트가 코드 수정 시 참조하는 컨텍스트입니다.

---

## 현재 시스템 (2026-02-08)

Checkpoint 기반 Lock 시스템. 경로 결정 시 CP 리스트 미리 생성 → 매 프레임 `currentEdge===cpEdge && currentRatio>=cpRatio` 비교만.

---

## 데이터 구조

### LockMgr 내부 상태
```typescript
locks: Map<string, number>        // nodeName → holder vehId
queues: Map<string, number[]>     // nodeName → 대기 큐
pendingReleases: Map<number, Array<{nodeName: string; releaseEdgeIdx: number}>>
edges: Edge[]                     // 0-based 배열
```

### VehicleDataArray 주요 필드
| 필드 | 용도 |
|------|------|
| `CURRENT_EDGE` (9) | 현재 edge (1-based) |
| `EDGE_RATIO` (7) | 0.0~1.0 |
| `VELOCITY` (6) | m/s |
| `MOVING_STATUS` (8) | MOVING=1, STOPPED=2, PAUSED=3 |
| `STOP_REASON` (18) | bitmask (LOCKED=1<<3) |
| `CURRENT_CP_EDGE` (27) | 현재 CP edge (1-based, 0=없음) |
| `CURRENT_CP_RATIO` (28) | 현재 CP ratio |
| `CURRENT_CP_FLAGS` (29) | 현재 CP flags (mutable) |
| `CURRENT_CP_TARGET` (30) | CP의 targetEdge (1-based) |
| `CHECKPOINT_HEAD` (22) | 다음 로드할 CP index |

### CheckpointFlags
```
LOCK_REQUEST  = 1 << 0  (0x01)
LOCK_WAIT     = 1 << 1  (0x02)
LOCK_RELEASE  = 1 << 2  (0x04)
MOVE_PREPARE  = 1 << 3  (0x08)
```

### Checkpoint 배열
```
checkpointArray[0] = MAX_CHECKPOINTS (50)
Vehicle N section: offset = 1 + N * CHECKPOINT_SECTION_SIZE
  [0] = count, then [edge, ratio, flags, targetEdge] × count
CHECKPOINT_FIELDS = 4
```

---

## 핵심 불변식 (Invariants)

1. **edge index**: SHM에서 항상 **1-based**. `edges[]` 배열은 **0-based**. 직접 접근 시 반드시 `-1`.
2. **merge node 판단**: `targetEdge.from_node` = merge node (incoming edge 2개 이상인 노드).
3. **CP 처리 순서**: MOVE_PREPARE → LOCK_RELEASE → LOCK_REQUEST → LOCK_WAIT.
4. **LOCK_WAIT는 매 프레임 체크**: grant 안 받으면 flag 남음 → 매 프레임 재확인.
5. **auto-release는 holder 체크 필수**: holder===vehId일 때만 release+grantNext. 아니면 cancelFromQueue.
6. **zone-internal 끼리는 선점 안 함**: 기존 FIFO 유지.

---

## Deadlock Zone

### 구조
분기→합류 다이아몬드. `edge.isDeadlockZoneInside === true`인 edge가 존 내부.

### 우선순위 규칙
| 상황 | 동작 |
|------|------|
| grantNextInQueue 호출 시 | 큐에서 zone-internal 차량 먼저 찾아 grant |
| handleLockWait에서 blocked | 나=zone-internal, holder=zone-external → 선점 (locks.set) |
| zone-internal vs zone-internal | 기존 FIFO 유지 (선점 안 함) |

### 선점 안전성
- holder가 zone-external → 아직 merge 통과 안 함 → 회수 안전
- 회수된 holder는 큐에 잔류 → auto-release 시 cancelFromQueue로 정리

### Zone 판단
```typescript
isVehicleInDeadlockZone(vehId): boolean
  → vehicleDataArray[ptr + CURRENT_EDGE] → edges[idx-1].isDeadlockZoneInside
```
플래그는 `edgeStore.updateDeadlockZoneFlags()`에서 세팅됨.

---

## 합류 유형별 CP 배치 규칙

| 유형 | REQ 위치 | WAIT 위치 | PREP 위치 |
|------|----------|-----------|-----------|
| 직선 합류 | 5.1m 전 (REQ\|PREP 합침) | waiting_offset 전 (기본 1.89m) | REQ와 합쳐짐 |
| 곡선 합류 | 곡선 fn 1m 전 (직전 직선) | 곡선@0.0 (fn) | 곡선@0.5 |
| 직선합류+곡선target | 5.1m 전 (**분리**) | waiting_offset 전 | 1.0m 전 (**분리**) |

**주의:** Bug #5 수정으로 직선합류+곡선target에서 REQ/PREP는 반드시 분리.

---

## 놓친 CP (Catch-up)

짧은 edge에서 한 프레임에 CP를 건너뛸 수 있음.
- `isCpEdgeBehind()`: cpEdge가 pathBuffer에 없으면 이미 지나감
- `handleMissedCheckpoint()`: PREP/REQ/RELEASE 실행, WAIT 스킵
- catch-up loop 최대 10개

---

## 코드 위치 (LockMgr.ts)

| 라인 | 메서드 | 역할 |
|------|--------|------|
| 37-56 | class fields | locks, queues, pendingReleases |
| 60-64 | eName() | edge idx → name |
| 69-84 | init() | 참조 저장, buildMergeNodes |
| 110-117 | updateAll() | checkAutoRelease + processLock 루프 |
| 148-247 | processCheckpoint() | CP 도달 체크, catch-up loop |
| 253-264 | isCpEdgeBehind() | 놓친 CP 감지 |
| 273-288 | handleMissedCheckpoint() | 놓친 CP 처리 |
| 294-336 | loadNextCheckpoint() | 다음 CP 로드 |
| 341-355 | handleLockRelease() | lock 해제 |
| 361-391 | handleLockRequest() | lock 요청 + auto-release 등록 |
| 397-457 | handleLockWait() | lock 대기 + preemption |
| 462-506 | handleMovePrepare() | NEXT_EDGE 채우기 |
| 511-525 | requestLockInternal() | 큐 push |
| 537-550 | releaseLockInternal() | lock 해제 |
| 556-563 | cancelFromQueue() | 큐에서만 제거 |
| 589-610 | grantNextInQueue() | 다음 grant (zone priority) |
| 616-650 | checkAutoRelease() | 자동 해제 |
| 722-733 | isVehicleInDeadlockZone() | zone-internal 판단 |

### 관련 파일

| 파일 | 역할 |
|------|------|
| `logic/checkpoint/builder.ts` | CP 리스트 생성 |
| `logic/checkpoint/utils.ts` | CP 정렬 (`sortCheckpointsByPathOrder`) |
| `logic/TransferMgr.ts` | pathBuffer 관리, CP 저장 (`saveCheckpoints`) |
| `logic/AutoMgr.ts` | Dijkstra 경로 설정 |
| `movement/edgeTransition.ts` | edge 전환, `shiftNextEdges` |
| `initialize/constants.ts` | CheckpointFlags, StopReason, MovementData |
| `store/map/edgeStore.ts` | `updateDeadlockZoneFlags()` |

---

## 버그 히스토리 요약

| # | 핵심 | 수정 파일 |
|---|------|-----------|
| 1 | 곡선 합류 시 REQ/PREP 분리 필요 | builder.ts |
| 2 | CP 정렬: edge의 path 내 위치 기준 | utils.ts |
| 3 | waiting_offset undefined → 기본값 1.89m | builder.ts |
| 4 | auto-release에서 holder 체크 필수 | LockMgr.ts |
| 5 | 직선합류+곡선target에서 REQ/PREP 분리 | builder.ts |
| 6 | 짧은 edge CP 미스 → catch-up loop | LockMgr.ts |
| 7 | FIFO 교착 → zone-internal 우선순위 | LockMgr.ts |

상세 분석은 `doc/spec/Lock정리.md` 참조.

---

## 로그 태그

| 태그 | 의미 |
|------|------|
| `[processCP] HIT!` | CP 도달 |
| `[processCP] MISSED!` | CP 건너뜀 → catch-up |
| `[LOCK_REQ]` | lock 요청 |
| `[LOCK_WAIT] BLOCKED` | 대기 (정지) |
| `[LOCK_WAIT] PASS` | 통과 |
| `[LOCK_WAIT] PREEMPT` | zone-internal 선점 |
| `[LOCK_GRANT] ZONE_PRIORITY` | zone-internal 우선 grant |
| `[AUTO_RELEASE]` | 자동 해제 |
| `[AUTO_RELEASE] CANCEL` | 큐 제거만 (holder 아님) |
