# VPS 락 시스템 재설계 계획 (v0.4.x)

목표: 현재 LockMgr 의 누적된 우선순위/preemption/deadlock-zone 로직을 걷어내고, **사전계산 cp 기반 단순 FIFO 락 시스템**으로 재구성.

작업 기간 추정: 3~4일

핵심 패러다임 전환:
- **Before**: 차량 path 들어올 때마다 cp 동적 계산 + LockMgr 안에 zone preemption / priority escalation / holder swap 등 정교한 로직 누적
- **After**: 맵 로드 시 cp 사전계산 1회 → 차량은 path 받으면 lookup만, LockMgr은 단순 FIFO + path change 시 락 정합

---

## 1. 배경 — 발견된 결함

### 1.1 fab_2_1 시뮬에서의 영구 데드락

`logs/20260504_0520/20260504_0520_fab_2_1_*.bin` 분석 결과 (`analyze.py --lock-node 384`):

```
veh=164 ts=9776 ~ END  (259.0s)  ❗ 잔존 holder
```

veh=164 의 전체 활동:
```
ts=     0  E0452 진입 (시작)
ts=  2240  E0452 EXIT → E0453 진입
ts=  4400  E0453 ratio=0.811 에서 vel=0 정지 (stopReason=0, 정지 사유 없음)
ts=  9776  N0385 LOCK_GRANT 받음  ← REQ도 WAIT도 안 한 차량
ts=  4400~268721 (264초) 그대로 정지, 락 보유
```

**결정적 사실**: veh=164 는 N0385 에 대해 `REQ` 이벤트도, `WAIT` 이벤트도 emit한 적 없음. 그런데 `grantNextInQueue` 가 **zone-internal 우선순위** 룰로 queue 외부에서 164 를 끌어와 grant. 받은 후 자기 앞 차량(165) 때문에 못 움직이지만 락은 영영 hold → 165, 168, 93 모두 starvation.

### 1.2 부수적으로 발견된 문제

- **이벤트 emit 순서 역전**: `requestLockInternal` 안에서 GRANT 콜백을 먼저 호출하고 그 다음 REQ emit → 동일 ts 내에서 GRANT before REQ 로 보여 개발자도구 락 화면이 lifecycle 추적 못 함.
- **cp 동적 계산**: 차량 path 들어올 때마다 `buildCheckpoints()` 가 path-aware 로 매번 계산. 차량 간 공유 캐시 없음. 같은 merge 에 대해 N대의 차량이 N번 계산.

---

## 2. 새 설계 원칙

### 2.1 CP 가 모든 행동 지점을 정적으로 가진다

차량 path 위 모든 cp 는 토폴로지에서 사전계산된 lookup 결과:

```
Path:  E_a → E_b → E_target → E_c → E_d
                   ↑
       cp1 marker=E_b@0.019,    flags=LOCK_REQUEST,  target=E_target  ← 5.1m 전 락 요청
       cp2 marker=E_b@0.596,    flags=LOCK_WAIT,     target=E_target  ← 락 못 받으면 정지
       cp3 marker=E_target@0.999, flags=LOCK_RELEASE, target=E_target  ← 빠져나가며 release
```

3개 cp가 한 세트(`target=E_target` 공통 키). 차량은 cp 만나면 **flag 대로 행동**:

| flag | 행동 |
|---|---|
| `LOCK_REQUEST` | `lockMgr.requestLock(target.from_node)` — 단순 queue.push |
| `LOCK_WAIT` | 락 없으면 정지, 있으면 통과 |
| `LOCK_RELEASE` | `lockMgr.releaseLock(target.from_node)` |
| `MOVE_PREPARE` | 다음 edge 진입 준비 (현재 그대로) |

### 2.2 LockMgr 는 단순 FIFO

```
state:
  locks    : Map<nodeName, holderVehId>
  queues   : Map<nodeName, vehId[]>  // 시간순 wait list

api:
  requestLock(vehId, nodeName)         → grant or queue 추가
  releaseLock(vehId, nodeName)         → unlock + 다음 차량 grant
  reconcileLocksOnPathChange(vehId, newCps)  → 새 path와 무관한 락 즉시 release
```

**제거**:
- zone-internal preemption
- priority escalation
- holder swap safeguards
- deadlock zone (entry/gate/REQ 자동화 포함 통째로)

**유지**:
- precompute (cp 사전계산)
- TransferMgr 의 path 처리 흐름
- vehicle movement 코드
- SHM checkpointBuffer 구조

### 2.3 Path 변경 시 락 자동 정합 — **핵심**

차량이 reroute 되면:

```
1. 새 path lookup 으로 cp 배열 재구성
2. 차량이 보유한 락 ∀node 점검:
     새 cp 배열에 LOCK_RELEASE target=node 가 있는가?
        있음 → 락 유지 (새 path도 그 merge 거침)
        없음 → 즉시 release (새 path는 그 merge 안 거침)
3. 정합된 cp 배열을 SHM 에 write
```

이 한 메서드 (`reconcileLocksOnPathChange`) 가 **시스템 안전성의 핵심**. 락이 leak 되거나 영구 hold 될 케이스 자체를 path change 시점에 차단.

### 2.4 결정 사항

| 항목 | 결정 |
|---|---|
| LOCK_RELEASE cp | target edge ratio 0.999 위치에 박음. 모든 LOCK_REQUEST 마다 짝 자동 생성 |
| Deadlock zone | **통째로 삭제** (`deadlock-zone.ts` 제거). 새 시스템에서 진짜 데드락 발견되면 그때 최소 형태로 재도입 |
| Holder watchdog | **추가 안 함** (개인 포폴 — 락 자체를 잘 만들어 freeze된 holder 자체가 안 생기게) |
| Path change 시 정합 | **필수** (위 2.3) |
| 이벤트 emit 순서 | REQ → WAIT/GRANT → RELEASE 순으로 정정 |
| 마이그레이션 | 한 번에 교체 (현 시스템이 깨졌으니 dual-run 가치 약함) |

---

## 3. Phase 별 구현 계획

### Phase 1 ✅ (완료, v0.3.x → 0.4.0)

- 사전계산 함수 `precompute.ts` 작성
- `precompute.test.ts` 동등성 검증 (y_short 2000 paths, 0 fail)
- `analyze.py --lock-node` 명령 추가
- snapshot.bin 파서 통합

### Phase 2 — `LOCK_RELEASE` cp 추가

**파일**: `src/common/vehicle/logic/checkpoint/precompute.ts`, `builder.ts`

- `buildCheckpoints()` 가 LOCK_REQUEST 와 함께 LOCK_RELEASE cp 생성:
  - `marker = target_edge`, `ratio = 0.999`
  - `flags = CheckpointFlags.LOCK_RELEASE`
  - `targetEdge = target_edge` (자기 자신)
- `precompute.ts` 의 fakePath 호출 결과에 LOCK_RELEASE cp 도 포함되도록
- 테스트 업데이트: dynamic builder 도 RELEASE cp 만들도록 수정 + 동등성 재검증

**검증**: `y_short` 2000 random paths 에서 lookup 결과 ⊇ {LOCK_REQUEST, LOCK_WAIT, LOCK_RELEASE, MOVE_PREPARE} 한 세트씩.

### Phase 3 — LockMgr 재작성

**파일**: `src/common/vehicle/logic/LockMgr/`

```
index.ts             재작성 (state 단순화)
lock-handlers.ts     재작성 (단순 FIFO + reconcile)
deadlock-zone.ts     ❌ 삭제
checkpoint-processor.ts  단순화 (flag 별 dispatch)
snapshot.ts          유지 (debug용)
types.ts             정리 (zone 관련 타입 제거)
```

**새 메서드 시그니처**:
```ts
class LockMgr {
  requestLock(vehId: number, nodeName: string): 'granted' | 'queued';
  releaseLock(vehId: number, nodeName: string): void;
  reconcileLocksOnPathChange(vehId: number, newCheckpoints: Checkpoint[], edgeArray: Edge[]): void;
  getHolder(nodeName: string): number | null;
  getQueue(nodeName: string): readonly number[];
}
```

`grantNextInQueue` 는 이름 그대로 유지하되 **queue 의 첫 번째에게만** grant. zone 우선순위 / preemption 일체 없음.

이벤트 emit 순서:
```
requestLock(v, n):
  if no holder:
    holder = v
    emit REQ(v, n, holder='-')
    emit GRANT(v, n)
  else:
    queue.push(v)
    emit REQ(v, n, holder=current_holder)
    emit WAIT(v, n, holder=current_holder)
```

### Phase 4 — `checkpoint-processor.ts` 단순화

차량이 cp 도달 시 dispatch:
```ts
function processCheckpoint(vehId, cp, lockMgr) {
  const target = cp.targetEdge;
  const node = edges[target - 1].from_node;

  if (cp.flags & LOCK_REQUEST)  lockMgr.requestLock(vehId, node);
  if (cp.flags & LOCK_WAIT)     handleWaitArrival(vehId, node, lockMgr);
  if (cp.flags & LOCK_RELEASE)  lockMgr.releaseLock(vehId, node);
  if (cp.flags & MOVE_PREPARE)  prepareNextEdge(vehId, target);
}
```

### Phase 5 — TransferMgr 통합

**파일**: `src/common/vehicle/logic/TransferMgr/index.ts`

`buildCheckpoints` (line 668-690) 를 lookup 기반으로 교체:
```ts
private buildCheckpoints(vehId, edgeIndices, edgeArray, lockMgr, data, ptr) {
  const cache = lockMgr.getPrecomputedCheckpoints();
  const checkpoints = lookupCheckpointsFromPath(edgeIndices, cache);
  this.saveCheckpoints(vehId, checkpoints, data, ptr);
}
```

`processPathCommand` 에 reconcile 호출 추가:
```ts
processPathCommand(ctx) {
  // ... 기존 path 처리 ...
  this.buildCheckpoints(...);
  lockMgr.reconcileLocksOnPathChange(vehId, newCheckpoints, edgeArray);
}
```

### Phase 6 — 검증

1. **동등성**: y_short random path 시뮬 → cp 생성 결과가 Phase 1 precompute 결과와 일치
2. **데드락 회피**: fab_2_1 시나리오 (200 차량, ~270초) 재현 → N0385 영구 hold 발생 안 하는지 확인
3. **단위 테스트**:
   - `precompute.test.ts` (Phase 2 후 업데이트)
   - 새 `lock-mgr.test.ts` — requestLock/releaseLock/reconcile 단위 테스트
   - 새 `path-change-reconcile.test.ts` — reroute 시 락 정합 시나리오
4. **수동 시뮬**: 다중 fab 시뮬 5분 돌려 락 leak 없는지 (`analyze.py --lock-node` 로 잔존 holder 0 확인)

---

## 4. 위험 요소 / 오픈 퀘스천

1. **Deadlock zone 제거 후 진짜 데드락 발생 가능성**
   - 현재 zone 시스템이 막던 케이스 (예: 좁은 영역에서 두 차량 양방향 잠금) 가 실제로 있었는지 식별 필요
   - 시뮬 검증 시 새 데드락 패턴 발견되면 그때 최소형태 (예: 같은 zone 차량들끼리 grant 우선순위) 만 재도입
2. **사전계산 cp 가 LOCK_RELEASE 까지 정확한가**
   - Phase 2 검증으로 동등성 확인
3. **Path change 시 reconcile 의 race condition**
   - reconcile 호출 시점이 SHM checkpointBuffer 업데이트와 같은 tick 안에 있어야 일관성 보장
   - TransferMgr 의 frame 처리 순서 확인 필요
4. **이벤트 emit 순서 변경의 후방 호환성**
   - 기존 로그 분석 도구는 GRANT-before-REQ 가정. 새 순서로 바뀌면 과거 .bin 분석 시 주의
   - `analyze.py` 는 시간순으로 처리하므로 영향 없음

---

## 5. Critical Files

수정 / 추가 / 삭제 대상:

```
src/common/vehicle/logic/checkpoint/precompute.ts       (Phase 2 — LOCK_RELEASE 추가)
src/common/vehicle/logic/checkpoint/builder.ts          (Phase 2 — LOCK_RELEASE 생성 로직)
src/common/vehicle/logic/checkpoint/precompute.test.ts  (Phase 2 — 검증 업데이트)
src/common/vehicle/logic/LockMgr/index.ts               (Phase 3 — 재작성)
src/common/vehicle/logic/LockMgr/lock-handlers.ts       (Phase 3 — 재작성)
src/common/vehicle/logic/LockMgr/deadlock-zone.ts       (Phase 3 — 삭제)
src/common/vehicle/logic/LockMgr/checkpoint-processor.ts (Phase 4 — 단순화)
src/common/vehicle/logic/LockMgr/types.ts               (Phase 3 — zone 타입 제거)
src/common/vehicle/logic/TransferMgr/index.ts           (Phase 5 — buildCheckpoints lookup 교체 + reconcile)
```

---

## 6. 진행 순서 요약

```
Phase 1 ✅ precompute + analyze.py + snapshot 파서 (v0.4.0)
   ↓
Phase 2  LOCK_RELEASE cp 추가 + 검증 업데이트
   ↓
Phase 3  LockMgr 재작성 (단순 FIFO + reconcile)
   ↓
Phase 4  deadlock-zone 삭제, checkpoint-processor 단순화
   ↓
Phase 5  TransferMgr lookup 통합 + reconcile 호출 배선
   ↓
Phase 6  검증 (fab_2_1 시나리오 재현 → 데드락 안 나면 OK)
```

각 Phase 별 commit + version bump (0.4.1, 0.4.2, ...).
