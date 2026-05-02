# Path Change Priority Inversion 처리 계획

## 발견 배경

**관찰 로그**: `20260502_2343_fab_0_1_lock.bin`

- N0118 (idx=117) holder=v=7, queue=[7, 96, 8, 184, 186, 180, 90, 173]
- v=7 GRANT 시각: ts=117813
- 마지막 ts=191010까지 약 73초간 release 없음 → **deadlock**
- 큐 차량 7명 starvation

## 진단

```
경로 변경 전:
  v=8 path: ... → 840 → 652         (N0118 안 거침, REQ 안 함)
  v=7 path: ... → 650 → ...          (N0118 거침, REQ 함)

ts=117813  v=7  N0118 LOCK_REQUEST CP 도달 → 큐 1등 → 즉시 GRANT
ts=119493  v=8  새 path 받음 (dest=84)
새 path:   ... → 840 → 651 → 653 → ...  (N0118 거침)

ts=119493 시점:
  v=8 위치: edge 840 (N0118 진입 직전, LOCK_REQ 5.1m 안쪽)
  v=7 위치: edge 650 (N0118 더 멀리)

→ v=8이 물리적으로 앞인데 v=7이 lock 잡음 = priority inversion
```

## 왜 기존 로직이 못 잡는가

`releaseOrphanedLocks` (`lock-handlers.ts:440`)는 **path 변경 시 기존 lock을 어떻게 처리할까만** 봄:

| 시나리오 | 처리 |
|---|---|
| 신 경로에 없는 merge | release/cancel ✓ |
| 신 경로에 있고 가까움 (<20m) | 유지 + releaseEdge 갱신 ✓ |
| 신 경로에 있지만 멀거나 우회 | release/cancel ✓ |
| **신 경로에 새로 추가된 merge** | **❌ 처리 없음** |

`processCheckpoint`의 missed CP 처리도 LOCK_REQUEST CP가 path 상으로 차량보다 **앞**에 있을 때 (아직 안 지났음) 발동 안 함.

→ 차량은 path 따라가다 LOCK_REQUEST CP 도달 시점에 자연스럽게 REQ 하지만 그땐 이미 다른 차가 큐 1등.

## 설계 (옵션 1: Path 변경 시 큐 재정렬)

### 핵심 아이디어

1. Path 변경 직후, 신 path의 **모든 merge node**에 대해 본인이 **LOCK_REQ 범위 안쪽인지** 검사.
2. 안쪽이면 **즉시 REQ + priority 기반 큐 위치 결정**.
3. 본인이 holder보다 물리적으로 앞이면 **holder swap** (안전 가드 적용).

### "LOCK_REQ 범위 안쪽" 정의

**선택지 A** (단순, 권장): 차량 → merge 잔여 path 거리 ≤ `straightRequestDistance` (기본 5.1m, 곡선 incoming이면 1m).

**선택지 B**: path 상 LOCK_REQUEST CP 위치보다 차량이 뒤. CP 빌드 결과 참조 필요 — 의존 많음.

→ **A 채택**.

### "앞차" 판정

`pathDistanceToMerge(vehId, mergeNodeName)`:
- 차량 currentEdge부터 path 상 merge로 들어가는 edge까지 누적 거리.
- 더 작은 값 = 더 앞.

### 큐 재정렬 로직

```ts
function requestLockWithPriority(nodeName, vehId, state) {
  const queue = state.queues.get(nodeName) ?? [];
  const myDist = pathDistanceToMerge(vehId, nodeName);

  // 1. 큐에 정렬 위치로 insert (이미 있으면 제거 후 재삽입)
  const existIdx = queue.indexOf(vehId);
  if (existIdx !== -1) queue.splice(existIdx, 1);

  const insertIdx = queue.findIndex(v => pathDistanceToMerge(v, nodeName) > myDist);
  if (insertIdx === -1) queue.push(vehId);
  else queue.splice(insertIdx, 0, vehId);

  // 2. holder swap 검사
  const holder = state.locks.get(nodeName);
  if (holder !== undefined && holder !== vehId) {
    const holderDist = pathDistanceToMerge(holder, nodeName);
    if (myDist < holderDist && canSwap(holder, nodeName, state)) {
      state.locks.set(nodeName, vehId);
      emit RELEASE(holder) + GRANT(vehId);
    }
  } else if (holder === undefined && queue[0] === vehId) {
    state.locks.set(nodeName, vehId);
    emit GRANT(vehId);
  }
}
```

### Holder swap 안전 가드 (`canSwap`)

| 조건 | swap 허용 |
|---|---|
| holder가 WAIT 상태 (`waitingVehicles`) | ✓ (정지 중) |
| holder의 currentEdge === target edge (이미 merge 진입) | ✗ |
| holder의 currentEdge가 incoming edge 위 | ✓ (아직 merge 직전) |
| 그 외 (모호) | ✗ (보수적) |

**가장 보수적**: holder가 incoming edge 위에 있고 sensor stop 또는 lock wait로 정지 중일 때만 swap.

### 트리거 범위 최적화

`processPathChange` 안에서:
- 구 path와 신 path diff → **새로 추가된 merge node 집합** 계산.
- 이 집합 안에서만 priority 검사 (전체 merge 다 보면 비용 큼).

## 구현 step

### Step 1: `pathDistanceToMerge` helper
- `lock-handlers.ts`의 `calcPhysicalDistToMerge` 참고하여 작성.
- input: vehId, mergeNodeName, state, pathBuffer
- output: 차량 currentEdge부터 path 상 merge node로 들어가는 edge까지 누적 거리 (m).
- merge 못 찾으면 Infinity.

### Step 2: `canSwapHolder` helper
- 안전 가드 검사 (위 표 기준).

### Step 3: `requestLockWithPriority`
- 위 의사코드 구현.
- `requestLockInternal` (FIFO push) 그대로 두고 신규 함수 추가.

### Step 4: `processPathChange`에 로직 추가
```
1. releaseOrphanedLocks   (기존)
2. ★ checkPathChangeNewMerges:
     - 구 path와 신 path의 merge 차분
     - 새 merge 집합에 대해 본인이 LOCK_REQ 범위 안쪽인지 검사
     - 안쪽이면 requestLockWithPriority 호출
     - pendingReleases 등록 (auto-release 위해)
3. processCheckpoint     (기존, missed CP 처리)
```

### Step 5: 검증
- y_short fab_0_1 시나리오 재현 (v=8이 path 바뀌어 N0118 거치게 됨).
- v=8이 path 변경 직후 N0118 lock 큐에 우선순위 1등으로 들어가는지.
- v=7과 swap 발생 → v=7이 큐 2등으로 강등되는지.
- 두 차량 progress 정상화 확인.

## 위험 / 검토 사항

1. **swap 발생 시 v=7의 상태 복구**:
   - v=7은 lock 잡고 movement 진행 중일 수 있음.
   - swap되면 v=7은 holder 자격 잃지만 currentEdge는 그대로.
   - v=7이 merge 진입 시점에 다시 lock 검사 → 현재 holder가 v=8이면 정지해야 함.
   - 가드: v=7이 이미 incoming edge 마지막 ratio에 도달 → swap 위험. `canSwap`에서 거리 마진 두기.

2. **Loop / starvation 방지**:
   - 두 차량이 서로 path 바뀌어 swap 무한 반복 위험은 없음 (path 변경 빈도 낮음).
   - 같은 차량에 대해 swap이 여러 번 발생할 수 있는데 매번 안전 가드 통과해야 하므로 큰 문제 없음.

3. **multi-merge interaction**:
   - 한 차량의 path에 merge 여러 개 → 각각에 대해 priority 재정렬.
   - 순서대로 처리하되 holder swap이 이미 발생한 차량은 다음 merge 검사 시 갱신된 상태 반영.

4. **성능**:
   - path 변경 빈도 << 매 프레임. 신 path의 merge 개수 × O(queue 길이) 정도 비용. 무시 가능.

## 변형 DZ와의 관계

별개 이슈. 변형 DZ는 "짧은 LINEAR로 인해 wait CP 위치가 잘못 됨" 문제. priority inversion은 "path 변경으로 큐 순서가 뒤집힘" 문제.

둘 다 deadlock 원인일 수 있고 동시에 발생 가능. 이 작업(Phase C, v0.3.98+)은 변형 DZ 통합(v0.3.97) 후 별도 진행.

## 참고 파일

- `src/common/vehicle/logic/LockMgr/lock-handlers.ts`
  - `releaseOrphanedLocks:440` (기존 path 변경 처리)
  - `calcPhysicalDistToMerge:401` (거리 계산 helper, 참고)
  - `requestLockInternal:268` (FIFO push)
  - `handleLockWait:114` (정지 처리)
- `src/common/vehicle/logic/LockMgr/index.ts`
  - `processPathChange:177` (step 4.5 진입점)
- `src/common/vehicle/logic/LockMgr/deadlock-zone.ts`
  - 기존 zone-internal preemption 로직 참고
