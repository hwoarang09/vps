# LockMgr — Merge Node 진입 제어 시스템

여러 edge가 한 node로 합류하는 지점에서 차량이 동시 진입하면 충돌한다. **한 번에 한 대**에게만 진입 허가(grant)를 부여하는 신호등. 차량 1만대 × 60FPS 환경을 견디기 위해 vehicle-side는 매 프레임 비교 2개로 끝내고, merge-side는 FIFO 큐 + 일부 노드에 deadlock 방지 메커니즘을 얹는다.

> Deadlock Zone 부분만 깊게: [`DEADLOCK_ZONE.md`](./DEADLOCK_ZONE.md)

---

## 1. 문제 — Merge Node 충돌

```
       Edge A
  VEH0 ────►╲
              ╲   Merge Node
       Edge B  ╲      ●──► Next Edge
  VEH1 ────────►╱
              ╱
       Edge C╱
  VEH2 ────►

❌ VEH0, VEH1, VEH2가 동시 진입 → 충돌
```

해결: **LockMgr이 한 번에 한 대에게만 진입 허가(grant)**.

---

## 2. 일반 Lock — Checkpoint 기반

### 2.1 핵심 아이디어 — 매 프레임 비교 2개로 끝

순진한 방식: 매 프레임 모든 차량에 대해 "근처 merge 있나, 거리 얼마나 남았나, lock 잡혀있나" 계산. 10만대 × 60FPS면 초당 600만 호출 — 너무 비쌈.

대신 **경로 결정 시점**에 차량별 *checkpoint 리스트*를 미리 계산해서 SAB에 넣어둠. 매 프레임은:

```typescript
if (currentEdge === cpEdge && currentRatio >= cpRatio) {
  // checkpoint 도달 → flag별 작업 실행
}
```

비교 2개로 끝. 99%는 여기서 조기 종료, 1%만 본격 lock 로직.

### 2.2 Checkpoint 구조

```typescript
interface Checkpoint {
  edge: number;       // 1-based, 어느 edge의
  ratio: number;      // 어느 위치 (0.0 ~ 1.0)에 도달하면
  flags: number;      // 무슨 작업을 해야 하나 (bitmask)
  targetEdge: number; // 관련 target edge (어느 merge의 lock인지 구분)
}
```

**flags 4종** (`constants.ts`):
| flag | 값 | 의미 |
|------|---:|------|
| `LOCK_REQUEST` | 1 | merge lock 요청 + auto-release 등록 |
| `LOCK_WAIT` | 2 | grant 받았는지 확인, 못 받으면 정지 |
| `LOCK_RELEASE` | 4 | merge 통과 후 lock 해제 + 다음 grant |
| `MOVE_PREPARE` | 8 | NEXT_EDGE_0..4 미리 채워두기 (movement용) |

한 checkpoint에 여러 flag 비트가 켜질 수 있음 — 예: `REQUEST | MOVE_PREPARE`.

### 2.3 경로별 checkpoint 예시

```
출발 → E10(직선) → E11(merge N5) → E12 → E13(merge N8) → 도착

checkpoints (builder.ts가 사전 계산):
  [edge=10, ratio=0.70, flags=REQ|PREP, target=E11]   // N5 5.1m 전: 요청 + NEXT_EDGE 준비
  [edge=10, ratio=0.85, flags=WAIT,     target=E11]   // N5 1.89m 전: grant 대기 지점
  [edge=11, ratio=0.20, flags=RELEASE,  target=E11]   // N5 통과 후: 해제
  [edge=11, ratio=0.80, flags=REQ,      target=E13]   // N8 요청
  [edge=12, ratio=0.50, flags=PREP,     target=E13]   // 곡선 N8 진입 전 NEXT_EDGE 준비
  [edge=12, ratio=0.95, flags=WAIT,     target=E13]   // N8 대기
  [edge=13, ratio=0.20, flags=RELEASE,  target=E13]   // N8 통과 후 해제
```

merge 통과당 보통 3개 (REQ, WAIT, RELEASE). 차량당 최대 200개 (`MAX_CHECKPOINTS_PER_VEHICLE`).

### 2.4 메모리 레이아웃 (SAB)

**vehicle data** (22 floats 중 lock 관련 5개):

| 필드 | 의미 |
|------|------|
| `CHECKPOINT_HEAD` | 다음에 로드할 cp의 array index |
| `CURRENT_CP_EDGE` | 현재 활성 cp의 edge (0 = 없음) |
| `CURRENT_CP_RATIO` | 현재 cp의 ratio |
| `CURRENT_CP_FLAGS` | 현재 cp의 flags (mutable — 처리한 flag는 비트 클리어) |
| `CURRENT_CP_TARGET` | 현재 cp의 target edge |

**checkpoint array** (별도 SAB):

```
[0]: MAX_CHECKPOINTS_PER_VEHICLE (meta, 200)

vehicle N section (offset = 1 + N × CHECKPOINT_SECTION_SIZE):
  [0]: count (실제 cp 개수)
  [1..4]: cp0 = {edge, ratio, flags, target}
  [5..8]: cp1
  ...

CHECKPOINT_SECTION_SIZE = 1 + 200 × 4 = 801 floats/vehicle
```

매 프레임 가장 hot한 데이터(`CURRENT_CP_*`)는 vehicle data에 캐시되어 있어서, checkpoint array는 cp 전환 시에만 access.

### 2.5 매 프레임 처리 (`processCheckpoint`)

```
processLock(vehId)
  └─ processCheckpoint(vehId):
      Catch-up loop (최대 10개):
       ├─ 1. ensureCheckpointLoaded(vehId)
       │   └─ CURRENT_CP_EDGE === 0이면 다음 cp를 array에서 로드
       │      (CHECKPOINT_HEAD++)
       │
       ├─ 2. checkCheckpointReached:
       │   ├─ currentEdge === cpEdge && currentRatio >= cpRatio
       │   │   → reached
       │   ├─ currentEdge !== cpEdge && NEXT_EDGE에 cpEdge 있음
       │   │   → waiting (아직 안 옴)
       │   └─ currentEdge !== cpEdge && NEXT_EDGE에 cpEdge 없음
       │       → missed (이미 지나감, catch-up 처리)
       │
       └─ 3. flag 처리 (PREPARE → RELEASE → REQUEST → WAIT 순서):
           ├─ MOVE_PREPARE → handleMovePrepare (NEXT_EDGE 채우기)
           ├─ LOCK_RELEASE → handleLockRelease + grantNextInQueue
           ├─ LOCK_REQUEST → handleLockRequest + auto-release 등록
           └─ LOCK_WAIT    → handleLockWait
                              ├─ holder === 나 → 통과
                              └─ holder !== 나 → 정지 (VELOCITY=0, STOP_REASON.LOCKED)

      flags === 0 되면 loadNextCheckpoint → continue (다음 cp도 도달했을 수 있음)
```

**catch-up loop**: 짧은 edge(~1.5m)를 한 프레임에 통과해서 cp 여러 개를 건너뛴 경우. `isCpEdgeBehind`로 "cp가 이미 뒤에 있는지" 판단 — NEXT_EDGE_0..4에 cpEdge가 있으면 아직 앞에 있음, 없으면 지나감. 최대 10개까지 연속 처리.

### 2.6 Merge-side 큐 (FIFO)

```typescript
state.queues: Map<nodeName, vehId[]>   // merge node마다 별도 FIFO 큐
state.locks: Map<nodeName, vehId>      // 현재 grant 받은 차량 (holder)
state.pendingReleases: Map<vehId, ...> // 자동 해제 등록 (LOCK_REQUEST 시)
```

- `LOCK_REQUEST`: 큐 push. 큐가 비어 있으면 즉시 grant (holder set).
- `LOCK_RELEASE`: 큐에서 제거 + holder 해제 + `grantNextInQueue` (큐 head를 holder로).
- `LOCK_WAIT`: holder가 자기면 통과, 아니면 정지 (VELOCITY=0 + STOP_REASON.LOCKED bit set).

---

## 3. Deadlock Zone — 다이아몬드 교착

### 3.1 문제 — 순수 FIFO로는 풀리지 않는 시나리오

```
       N248 (분기) ── 진입 edge E285
       ↙           ↘
  E286(직선)      E549(곡선)     ← zone 내부 edges
     ↓               ↓
   N249(합류)      N346(합류)
     ↑               ↑
  E722(곡선)      E397(직선)
       ↖           ↗
       N345 (분기) ── 진입 edge E396
```

A=N248, D=N345 두 분기점이 같은 합류점 쌍 {B=N249, C=N346}으로 모두 도달 가능. 이런 다이아몬드 구조는:

```
1. veh:125 → E285(zone 외부) 위에서 N249 lock REQ → FIFO 1번
2. veh:14  → E722(zone 내부) 위에서 N249 lock REQ → FIFO 2번
3. veh:125 → FIFO 1번이라 grant 받음
4. 그런데 veh:125는 아직 zone 진입 안 함 (E285 위) — 물리적으로 N249에 접근 못함
5. veh:14는 zone 내부, 빠져나가려면 N249 통과해야 하는데 lock 못 받음
6. veh:125는 E285→E286→N249로 가려는데 zone 내부 다른 차량들에 막힘
→ 영구 교착
```

**핵심 문제**: FIFO 1번이 *물리적으로 즉시 통과 불가능*한 차량인데 grant를 들고 있어서, *즉시 통과 가능한* zone 내부 차량이 영원히 막힘.

### 3.2 Deadlock Zone 검출 — 정적 분석

시뮬 시작 전 Main thread의 `nodeStore.detectDeadlockZones()`가 맵을 분석해서 어느 노드가 DZ인지 미리 판정한다 (`node.isDeadlockMergeNode = true`).

**검출 조건**:
- 분기점 A, D 두 개 (각각 outgoing ≥ 2)
- 합류점 B, C 두 개 (각각 incoming ≥ 2)
- A의 reachable merges == D의 reachable merges == {B, C}
- reachable = **1-hop 직접** OR **2-hop curve-passthrough** (변형 DZ 2)

2-hop curve passthrough: 분기점에서 곡선 edge를 거쳐 한 노드 건너 merge에 닿는 경우도 포함. 짧은 통로 + 곡선이 끼어 있으면 1-hop 직접 형태가 아니라도 실질적으로 같은 deadlock 위험.

→ DZ 검출 결과는 시뮬 시작 시 1회 계산되고, `LockMgr.state.deadlockZoneMerges: Set<nodeName>`에 저장.

### 3.3 통합 메커니즘 3종

DZ 검출된 노드에 대해서는 일반 FIFO 위에 3가지 메커니즘이 동시 적용된다. **노드별로 다른 해결책을 짜는 게 아니라, DZ로 마킹된 모든 노드에 같은 3종 메커니즘이 자동 적용**된다.

#### (a) Auto gate — checkpoint 우회 (`updateDeadlockZoneGates`)

`updateAll()`에서 매 프레임, 모든 차량에 대해:

```
for each vehicle:
  if (current edge의 to_node ∈ DZ merge):
    if 내가 holder: 통과
    else if 큐에 없음: 자동 REQ
    if (holder가 없음): grant 시도
    if (lock 못 받음): 강제 STOP (VELOCITY=0, STOP_REASON.LOCKED)

  if (current edge의 from_node ∈ DZ merge):  // merge 통과 후 edge 위
    if 내가 holder: 자동 RELEASE
```

일반 merge는 checkpoint를 기다리지만, DZ merge는 checkpoint 발화 없이도 **edge 진입 직후 자동으로** REQ/GRANT/STOP/RELEASE를 처리한다. checkpoint 처리 누락(타이밍 이슈)으로 DZ에서 stuck되는 케이스를 막는 안전망.

#### (b) Approaching-edge priority grant (`grantNextInQueue`)

```typescript
function grantNextInQueue(nodeName) {
  let nextVeh = queue[0];  // 기본 FIFO

  if (isDeadlockZoneMerge(nodeName)) {
    // 큐 안에서 "이미 merge 직전 edge 위에 있는" 차량을 우선 선택
    for (const veh of queue) {
      if (isVehicleApproachingMerge(veh, nodeName)) {
        nextVeh = veh;
        break;
      }
    }
  }
  state.locks.set(nodeName, nextVeh);
  // ...
}
```

일반 merge는 큐 head를 grant. DZ merge는 **물리적으로 즉시 통과 가능한 차량**(`currentEdge.to_node === merge`)을 큐에서 골라서 grant. §3.1 시나리오의 "FIFO 1번이지만 물리적으로 못 옴" 문제를 직접 해결.

#### (c) Stuck holder swap (`detectAndSwapDeadlockedHolders`)

```
매 프레임, 모든 DZ merge에 대해:
  if (holder의 velocity == 0):
    if (holder가 incoming edge 위면): skip (단순 감속 상황 — 곧 진행)
    if (stuck 시간 < 2초): skip (대기)
    if (stuck 시간 >= 2초):
      큐에서 ready 차량 찾기 (STOP_REASON.LOCKED + currentEdge.to_node === merge)
      찾으면 → performHolderSwap (holder 강제 이전)
```

(a)와 (b)가 동작했어도 race condition / edge case로 stuck이 생길 수 있음. 2초 stuck이면 holder를 즉시 통과 가능한 다른 차량에게 강제 이전 — 최후의 안전망.

---

## 4. Path Change 시 lock 재정합 (`processPathChange`)

차량이 시뮬 도중 새 경로를 받으면 (rerouting), 옛 경로 기준 checkpoint와 잡고 있던 lock이 신 경로와 불일치한다. `step()` 안 단계 4.5에서:

```typescript
processPathChange(vehId, info):
  releaseOrphanedLocks(vehId, info.newPathMergeNodes, ...);
  //   신 경로에 없는 merge에 잡혀 있던 lock 회수 + 큐에서 제거

  requestLockWithPriority(vehId, info.newPathMergeNodes, ...);
  //   신 경로 안의 merge에 대해 거리 기반 우선 REQ
  //   (이미 가까운 merge는 즉시 큐 진입)

  processCheckpoint(vehId);
  //   rebuild된 checkpoint 중 이미 지나친 게 있으면 즉시 처리
```

이 단계가 빠지면 — 옛 경로 lock이 끝까지 안 풀려서 다른 차량 영구 블록 / 신 경로 merge에 REQ가 늦어 charging issue 등 발생.

---

## 5. 데이터 흐름 (한눈에)

```
[빌드 단계 (1회)]
  routing이 새 경로 결정 → checkpoint/builder.ts:buildCheckpoints
    → checkpointArray (SAB)에 vehicle별 cp 리스트 기록

[정적 분석 (1회, Main thread)]
  edges 분석 → nodeStore.detectDeadlockZones()
    → node.isDeadlockMergeNode 마킹
    → LockMgr.init() 시 state.deadlockZoneMerges에 복사

[매 프레임, FabContext.step() 안의 2단계]
  lockMgr.updateAll(numVehicles, simT):
    ├─ checkAutoRelease(state)
    ├─ updateDeadlockZoneGates(numVehicles, state)   ← DZ Auto gate (3-a)
    ├─ detectAndSwapDeadlockedHolders(state, simT)   ← DZ Stuck swap (3-c)
    └─ for each veh:
         processCheckpoint(veh, state):
           ├─ ensureCheckpointLoaded
           ├─ checkCheckpointReached
           └─ flag 처리 (PREPARE/RELEASE/REQUEST/WAIT)
                ├─ WAIT 도달 시: holder 아니면 정지
                └─ REQUEST/RELEASE 시: state.queues 갱신
                                       + grantNextInQueue (DZ면 Approaching-edge priority, 3-b)

[Step 4.5 (경로 변경 시만)]
  transferMgr.getPathChangedVehicles()
    → for each: lockMgr.processPathChange(veh, info)
```

---

## 6. 파일 맵

| 파일 | 역할 |
|------|------|
| `./index.ts` | LockMgr 메인 클래스 (`updateAll`, `processLock`, `processPathChange`, `preLockMergeNodes`) |
| `./checkpoint-loader.ts` | cp 로드 / 도달 체크 / `isCpEdgeBehind` (catch-up 판정) |
| `./checkpoint-processor.ts` | `processCheckpoint` — flag 디스패치, catch-up loop |
| `./lock-handlers.ts` | flag별 핸들러 (`handleLockRequest/Wait/Release`, `handleMovePrepare`, `requestLockInternal`, `releaseOrphanedLocks`, `requestLockWithPriority`) |
| `./deadlock-zone.ts` | DZ 메커니즘 3종 (`updateDeadlockZoneGates`, `grantNextInQueue` 안 priority, `detectAndSwapDeadlockedHolders`) |
| `./snapshot.ts` | Lock 상태 스냅샷 (Lock Info Panel용) |
| `./types.ts` | 타입 / `LockEventType` / `LockDetailType` |
| [`../checkpoint/builder.ts`](../checkpoint/builder.ts) | 경로 → cp 리스트 변환 (사전 계산) |
| [`../checkpoint/utils.ts`](../checkpoint/utils.ts) | cp 정렬 (`sortCheckpointsByPathOrder`), curve edge 판정 |
| [`../TransferMgr/`](../TransferMgr/) | pathBuffer 관리, path change 시 신 경로 mergeNodes 산출 |
| [`../../movement/edgeTransition.ts`](../../movement/edgeTransition.ts) | edge 전환, NEXT_EDGE shift |
| [`../../initialize/constants.ts`](../../initialize/constants.ts) | `CheckpointFlags`, `LogicData.CURRENT_CP_*`, `MAX_CHECKPOINTS_PER_VEHICLE` |
| [`../../../../store/map/nodeStore.ts`](../../../../store/map/nodeStore.ts) | `detectDeadlockZones`, `isDeadlockMergeNode` (정적 분석) |
| [`../../../../components/react/menu/panels/LockInfoPanel.tsx`](../../../../components/react/menu/panels/LockInfoPanel.tsx) | Lock 상태 UI |

---

## 7. 디버그 로그 태그

매 step의 lock 이벤트는 SimLogger를 통해 OPFS에 기록된다 (`ML_LOCK` 이벤트). 의심스러운 메커니즘은 `DEV_LOCK_DETAIL`로 별도 기록.

| 태그 | 의미 |
|------|------|
| `[processCP] HIT!` | Checkpoint 도달 |
| `[processCP] MISSED!` | cp 건너뜀 (catch-up) |
| `[LOCK_REQ]` | lock 요청 + auto-release 등록 |
| `[LOCK_WAIT] BLOCKED` | 정지 (holder 아님) |
| `[LOCK_WAIT] PASS` | 통과 (holder 맞음) |
| `[LOCK_GRANT]` | 큐 다음 차량에 grant |
| `[LOCK_GRANT] ZONE_PRIORITY` | DZ approaching-edge priority grant |
| `[DZ_GATE_AUTO_REQ]` | DZ auto gate에서 cp 우회 REQ |
| `[DZ_GATE_AUTO_GRANT]` | DZ auto gate 직후 즉시 grant |
| `[DZ_GATE_BLOCK]` | DZ auto gate 정지 (cp 발화 없이 강제) |
| `[DEADLOCK_SWAP]` | Stuck holder 강제 이전 |
| `[AUTO_RELEASE] CANCEL` | holder 아닌데 auto-release → 큐 제거만 |
| `[MOVE_PREP]` | NEXT_EDGE 채움 |

---

## 8. 면접용 한 줄 요약

> *"merge node에서 한 번에 한 대만 통과시키는 신호등인데, 매 프레임 모든 차량을 검사하면 비싸서 경로 결정 시점에 차량별 checkpoint 리스트를 미리 만들고 매 프레임은 비교 2개로 99% 조기 종료. 다이아몬드 교착이 나는 노드는 정적 분석으로 미리 마킹하고, 거기에 (1) checkpoint 우회 auto gate, (2) 즉시 통과 가능 차량 우선 grant, (3) 2초 stuck holder 강제 swap 3가지 안전망을 깔았다."*
