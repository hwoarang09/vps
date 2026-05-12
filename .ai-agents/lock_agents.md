# Lock System — AI Agent Context

> 사람용 개념 문서: [`src/common/vehicle/logic/LockMgr/README.md`](../src/common/vehicle/logic/LockMgr/README.md)
> 이 파일은 에이전트가 코드 수정 시 참조하는 컨텍스트입니다. 의심나면 위 README가 정답.

---

## 현재 시스템 (v0.4, 2026-05-12 기준)

Checkpoint 기반 lock + Deadlock Zone(DZ) 통합 메커니즘 3종. v0.3까지 있던
`zone-internal vs zone-external preemption`은 **제거됨** — 같은 효과를 더 단순한
방식으로 (a) auto gate + (b) approaching-edge priority grant + (c) stuck holder
swap으로 분리해서 처리.

---

## 데이터 구조

### LockMgr 내부 상태 (`LockMgr/index.ts:32-44`)
```typescript
locks: Map<string, number>          // nodeName → holder vehId
queues: Map<string, number[]>       // nodeName → FIFO 대기 큐
pendingReleases: Map<number, Array<{ nodeName, releaseEdgeIdx }>>
waitingVehicles: Set<number>
mergeNodes: Set<string>             // incoming ≥ 2인 노드들
deadlockZoneMerges: Set<string>     // DZ로 마킹된 merge 노드들 (정적 분석)
edges: Edge[]                       // 0-based 배열
```

### VehicleDataArray 필드 (`constants.ts` 기준 인덱스)
| 인덱스 | 필드 | 용도 |
|------:|------|------|
| 22 | `STOP_REASON` | bitmask (LOCKED = `1 << 3`) |
| 26 | `CHECKPOINT_HEAD` | 다음 로드할 cp index |
| 27 | `CURRENT_CP_EDGE` | 현재 활성 cp의 edge (1-based, 0=없음) |
| 28 | `CURRENT_CP_RATIO` | 현재 cp의 ratio |
| 29 | `CURRENT_CP_FLAGS` | 현재 cp의 flags (mutable — 처리 후 비트 클리어) |
| 30 | `CURRENT_CP_TARGET` | 현재 cp의 targetEdge (1-based) |

### CheckpointFlags
```
LOCK_REQUEST  = 1 << 0  (0x01)
LOCK_WAIT     = 1 << 1  (0x02)
LOCK_RELEASE  = 1 << 2  (0x04)
MOVE_PREPARE  = 1 << 3  (0x08)
```

### Checkpoint 배열 (별도 SAB)
```
checkpointArray[0] = MAX_CHECKPOINTS_PER_VEHICLE (200)

vehicle N section: offset = 1 + N × CHECKPOINT_SECTION_SIZE (= 801)
  [0]: count
  [1..4]: cp0 = {edge, ratio, flags, targetEdge}
  [5..8]: cp1
  ...

CHECKPOINT_FIELDS = 4
```

---

## 핵심 불변식 (Invariants)

1. **edge index**: SHM 안에서는 **1-based**. `edges[]` 배열은 **0-based**. 직접 접근 시 `-1` 필수.
2. **merge node 판단**: `targetEdge.from_node` = merge node.
3. **DZ merge 판단**: `state.deadlockZoneMerges.has(nodeName)`. 정적 분석으로 init 시 1회 결정. 시뮬 중 변하지 않음.
4. **CP flag 처리 순서** (`processCheckpointFlags` 안): MOVE_PREPARE → LOCK_RELEASE → LOCK_REQUEST → LOCK_WAIT.
5. **LOCK_WAIT는 매 프레임 체크**: grant 못 받으면 flag 남음 → 다음 프레임에 재확인. catch-up loop은 LOCK_WAIT가 남은 cp에서 멈춤.
6. **auto-release는 holder 체크 필수**: holder===vehId일 때만 release+grantNext. 아니면 큐에서만 제거.
7. **Catch-up loop**: 짧은 edge에서 cp 여러 개 건너뛰면 최대 10개까지 연속 처리. `isCpEdgeBehind`로 판정 — NEXT_EDGE_0..4에 cpEdge 없으면 이미 지나간 것.

---

## Deadlock Zone

### 검출 (`store/map/nodeStore.ts:detectDeadlockZones`)
- 분기점 A, D 두 개가 같은 합류점 쌍 {B, C}로 모두 도달 가능
- reachable = **1-hop 직접** OR **2-hop curve-passthrough** (변형 DZ 2 — 곡선 끼어 있는 형태)
- 검출된 B, C에 `node.isDeadlockMergeNode = true`. `LockMgr.init()`에서 `state.deadlockZoneMerges`에 복사.

### 런타임 통합 메커니즘 3종 (DZ 마킹된 모든 노드에 자동 적용)

| 메커니즘 | 코드 | 동작 |
|---------|------|------|
| **(a) Auto gate** | `deadlock-zone.ts:updateDeadlockZoneGates` | checkpoint 발화와 무관하게, DZ merge로 향하는 직전 edge 진입 직후 자동 REQ/GRANT/STOP. merge 통과 후 자동 RELEASE |
| **(b) Approaching-edge priority** | `deadlock-zone.ts:grantNextInQueue` | 일반 merge는 FIFO head. DZ merge는 큐 안에서 `currentEdge.to_node === merge`인 차량(즉시 통과 가능) 우선 |
| **(c) Stuck holder swap** | `deadlock-zone.ts:detectAndSwapDeadlockedHolders` | DZ holder가 vel=0으로 2초 이상 stuck + 큐에 ready 차량 있으면 holder 강제 이전 |

### 함정 (자주 잘못 알기 쉬움)
- ❌ "zone-internal vs zone-external preemption" — v0.3까지의 메커니즘. 현재는 없음.
- ❌ `edge.isDeadlockZoneInside` 같은 edge 플래그 — 없음. `node.isDeadlockMergeNode`만 있음.
- ❌ DZ에서 zone-internal 차량 "직접 선점" — 없음. (b) approaching-edge priority가 큐 안에서 선택하는 것일 뿐, queue 밖 차량을 끌어오지 않음.

---

## Path Change 시 lock 재정합 (`processPathChange`, step 4.5)

차량이 시뮬 중 새 경로 받으면:
1. `releaseOrphanedLocks` — 새 경로에 없는 merge의 lock 회수/큐 제거
2. `requestLockWithPriority` — 새 경로 안 merge에 대해 거리 기반 우선 REQ
3. `processCheckpoint` — rebuild된 cp 중 이미 지나친 게 있으면 즉시 처리

`transferMgr.getPathChangedVehicles()`로 path 바뀐 차량 목록 받음.

---

## 코드 맵

### `LockMgr/` 폴더 (옛 단일 `LockMgr.ts` 파일이 폴더로 split됨)
| 파일 | 역할 |
|------|------|
| `index.ts` | LockMgr 클래스 (`init`, `updateAll`, `processLock`, `processPathChange`, `preLockMergeNodes`, legacy stub) |
| `checkpoint-loader.ts` | cp 로드 / `ensureCheckpointLoaded` / `checkCheckpointReached` / `isCpEdgeBehind` / `loadNextCheckpoint` |
| `checkpoint-processor.ts` | `processCheckpoint` — 도달 체크 + flag 디스패치 + catch-up loop |
| `lock-handlers.ts` | `handleLockRequest/Wait/Release` / `handleMovePrepare` / `handleMissedCheckpoint` / `checkAutoRelease` / `requestLockInternal` / `releaseOrphanedLocks` / `requestLockWithPriority` |
| `deadlock-zone.ts` | DZ 3종 메커니즘 (`updateDeadlockZoneGates`, `grantNextInQueue` 안 priority, `detectAndSwapDeadlockedHolders`) |
| `snapshot.ts` | Lock Info Panel용 스냅샷 |
| `types.ts` | 타입 / `LockEventType` / `LockDetailType` |

### 관련 파일
| 파일 | 역할 |
|------|------|
| `common/vehicle/logic/checkpoint/builder.ts` | 경로 → cp 리스트 (`buildCheckpoints`) |
| `common/vehicle/logic/checkpoint/utils.ts` | `sortCheckpointsByPathOrder`, `isCurveEdge` |
| `common/vehicle/logic/TransferMgr/` (폴더) | pathBuffer 관리, `getPathChangedVehicles` |
| `common/vehicle/logic/AutoMgr.ts` | Dijkstra 경로 결정 |
| `common/vehicle/movement/edgeTransition.ts` | edge 전환, `shiftNextEdges` |
| `common/vehicle/initialize/constants.ts` | `CheckpointFlags`, `StopReason`, `MovementData`, `LogicData` |
| `store/map/nodeStore.ts` | `detectDeadlockZones`, `isDeadlockMergeNode` (정적 분석) |

---

## 로그 / 디버그 태그

매 step의 lock 이벤트는 SimLogger로 OPFS에 기록됨 (`ML_LOCK`). 의심 메커니즘은 `DEV_LOCK_DETAIL`로 별도. 분석 도구는 [`scripts/log_parser/`](../scripts/log_parser/) 참조.

| 태그 | 의미 |
|------|------|
| `[processCP] HIT!` | cp 도달 |
| `[processCP] MISSED!` | cp 건너뜀 (catch-up) |
| `[LOCK_REQ]` | lock 요청 |
| `[LOCK_WAIT] BLOCKED` | 정지 (holder 아님) |
| `[LOCK_WAIT] PASS` | 통과 (holder 맞음) |
| `[LOCK_GRANT]` | 큐 다음 차량에 grant |
| `[LOCK_GRANT] ZONE_PRIORITY` | DZ approaching-edge priority grant |
| `[DZ_GATE_AUTO_REQ]` | DZ auto gate에서 cp 우회 REQ |
| `[DZ_GATE_AUTO_GRANT]` | DZ auto gate 직후 즉시 grant |
| `[DZ_GATE_BLOCK]` | DZ auto gate 정지 (cp 발화 없이 강제) |
| `[DEADLOCK_SWAP]` | Stuck holder 강제 이전 |
| `[AUTO_RELEASE] CANCEL` | holder 아닌데 auto-release → 큐 제거만 |

---

## 분석 도구

| 도구 | 위치 | 용도 |
|------|------|------|
| `log_parser.py` | `scripts/log_parser/` | `.bin` → DataFrame (event별) |
| `analyze.py` | `scripts/log_parser/` | 이벤트별 분석 (lock wait time, deadlock 추적 등) |
| `snapshot_streaming.py` | `scripts/log_parser/` | 큰 `_snapshot.bin` (>200MB) OOM 방지 streaming parser |
| `LockInfoPanel.tsx` | `components/react/menu/panels/` | 런타임 lock 상태 UI |
