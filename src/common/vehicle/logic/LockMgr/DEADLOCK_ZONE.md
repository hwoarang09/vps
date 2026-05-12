# Deadlock Zone (DZ) — 개념 / 검출 / 처리 정리

> Lock 시스템 전체는 [`README.md`](./README.md). 이 파일은 그 안의 DZ 부분만 깊게 다룬다.

---

## 1. 왜 DZ가 따로 필요한가

일반 merge에서는 단순 FIFO 큐로 충분하다. 먼저 도착한 차량이 lock 잡고, 통과 후 해제 → 다음 차량. 문제 없음.

**다이아몬드 구조**에서는 FIFO만으로 안 풀리는 영구 교착이 생긴다.

```
       N248 (분기)
       ↙        ↘
  E286(직선)  E549(곡선)
     ↓           ↓
   N249(합류)  N346(합류)
     ↑           ↑
  E722(곡선)  E397(직선)
       ↖     ↗
       N345 (분기)
```

### 교착 시나리오

```
1. veh:125 → E285 위 → N249 lock REQ → FIFO 1번 → grant 받음
2. 근데 veh:125는 아직 E285 위 (zone 외부) → 물리적으로 N249에 접근 못함
3. veh:14 → E722 위 (zone 내부) → N249 lock REQ → FIFO 2번 → 못 받음
4. veh:14는 zone 빠져나가려면 N249 통과해야 하는데 grant 못 받음
5. veh:125는 앞 차량 막힘 등으로 진행 못 함 → lock 영영 안 풀림
→ 영구 교착
```

**핵심 문제**: FIFO 1번이 *물리적으로 즉시 통과 불가능*한 차량인데 grant를 들고 있어서, *즉시 통과 가능*한 차량이 영원히 막힘.

이런 구조를 미리 알아내서 다르게 처리하는 게 DZ.

---

## 2. DZ 검출 — 정적 분석 (시뮬 시작 시 1회)

위치: `store/map/nodeStore.ts:detectDeadlockZones()`

### 조건

- 분기점 A, D 두 개 (각각 outgoing ≥ 2)
- 합류점 B, C 두 개 (각각 incoming ≥ 2)
- A의 reachable merges == D의 reachable merges == {B, C}

reachable 판정에 3가지 패턴 있음:

### 패턴 1 — 표준 (1-hop 직접)

```
A ──edge──► B (합류)
A ──edge──► C (합류)
```

분기점에서 곧바로 합류점으로. 가장 단순한 다이아몬드.

### 패턴 2 — 변형 DZ 2 (곡선 + 곡선 passthrough)

분기점과 합류점 사이에 *통과 노드 1개*가 끼어 있고, 그 통과 노드 양쪽 edge가 둘 다 곡선:

```
A ──curve──► [통과] ──curve──► B
        예: 90° + 90°, 90° + 180° 등
```

곡선이 짧고 곡률이 강해서 통과 노드 위에 차량 끼면 빠져나가기 어려움. 실질적으로 다이아몬드와 같은 deadlock 위험.

### 패턴 3 — 변형 DZ 1 (곡선 + 짧은 직선 passthrough)

통과 노드 양쪽이 비대칭 — 한쪽 곡선 + 다른쪽 짧은 직선 (≤ 2m):

```
A ──curve──► [통과] ──LINEAR 짧음──► B
A ──LINEAR 짧음──► [통과] ──curve──► B
```

곡선은 어차피 감속 + 짧은 직선은 대기 공간 부족 → deadlock 위험.

(둘 다 긴 LINEAR면 대기 공간 충분해서 DZ로 안 봄)

### 검출 결과

위 3패턴으로 찾은 합류점에 `node.isDeadlockMergeNode = true` 마킹. `LockMgr.init()` 시 `state.deadlockZoneMerges: Set<nodeName>`에 복사.

이후 시뮬 중 변하지 않음. **검출은 패턴별로 다른 알고리즘**, **마킹된 후엔 패턴 구분 안 함**.

---

## 3. Builder의 DZ 처리 — cp 위치 분기

builder는 path 따라가며 각 merge에 대해 cp를 박는데, *그 merge가 DZ인가*에 따라 위치가 다름.

### 일반 merge cp 위치

```
─────[E10 직선 ]──────────► merge N5
              ↑              ↑
              REQ 박힘        WAIT 박힘
              5.1m 전        1.89m 전
```

차량이 N5에 1.89m 앞에서 정지하면 끝. 뒤따라오는 차량은 다음 사이클에 다시 시도.

### DZ merge cp 위치

```
앞 edge      entry edge          분기점     zone 내부      target (DZ merge)
─────────►──[E285]──────────►──N248──[E286]──────────►──N249
              │                  ▲
              │                  │
              ▼                  │
          [REQ 박힘]         [WAIT 박힘]
          entry 안쪽 5.1m    entry 끝 = N248 진입 직전
          (또는 더 앞 edge로)  ≈ DZ_ENTRY_WAIT_OFFSET (보통 1.89m)
```

**핵심 차이**: WAIT를 **entry edge 끝**(다이아몬드 분기 노드 직전)에 박음. lock 못 받으면 **zone 진입 자체를 차단**. zone 안에 들어간 후 정지하면 이미 늦음 — 다른 차량들이 zone에서 빠져나갈 수 없게 됨.

### 코드 분기 (`builder.ts:474-562`)

```typescript
for each target edge in path:
  const targetIsDzMerge =
    isStartFromMergeNode &&
    isDeadLockMergeNode(targetEdge.from_node);

  if (dzEntry) {
    // ── DZ 패턴 ──
    // REQ를 entry edge 안쪽 (정적 DZ는 5.1m, 변형 DZ는 1m)
    // WAIT를 entry edge 끝 (분기 node 직전)
  }
  else if (곡선 incoming) {
    // ── 일반 + 곡선 합류 ──
  }
  else if (직선 + 곡선 target) {
    // ── REQ/PREP 분리 패턴 ──
  }
  else {
    // ── 일반 직선 합류 ──
  }
```

### 정적 DZ vs 변형 DZ — REQ 거리 다름

```typescript
const useShortDistance = !!variantDzEntry;
const dzReqPoint = findRequestPoint(
  dzEntry.pathIdx, ...,
  useShortDistance   // true → 1m, false → 5.1m
);
```

- **정적 DZ (패턴 1)**: 5.1m. 직선 충분히 있으니 멀리서 차단
- **변형 DZ (패턴 2, 3)**: 1m. 통과 노드 chain이 곧 곡선으로 이어져 차량이 이미 pre-brake 중 → 1m면 충분

### 곡선 만나면 거기서 stop

REQ 위치 계산 시 거꾸로 거슬러 올라가다가 곡선 만나면 더 안 가고 **곡선 ratio 0.5에서 REQ**:

```typescript
function findRequestPoint(...) {
  for (let i = targetPathIdx - 1; i >= 1; i--) {
    const cpEdge = edges[path[i]];
    if (isCurveEdge(cpEdge)) {
      return { edgeId, ratio: 0.5 };   // ★ 곡선 중간
    }
    // ... 직선이면 거리 누적
  }
}
```

**왜 ratio 0.5**:
- 곡선 위에서 정지 = 후속 차량 막힘
- REQ는 메모리 작업 (큐 push)이라 정지 안 함 — 어디서 발동되든 OK
- 곡선 중간이 가장 안전한 발동 지점

WAIT는 *반드시 정지 가능한 직선 위*에 박힘 — 곡선 끝난 후 entry edge에.

### waitRelocations — 변형 DZ 1 fallback

entry edge가 너무 짧거나 정적 마킹이 안 잡힌 케이스. main thread의 `buildShortEdgeWaitRelocation`이 사전 분석으로 *"이 incoming edge로 들어오면 WAIT를 어느 edge로 옮길 것인지"* 매핑을 만들어 둠.

```typescript
waitRelocations: Map<string, WaitRelocationEntry>   // edge_name → reloc info
```

builder가 `staticDzEntry = null`인 경우 `findVariantDzEntry(waitRelocations)`로 fallback. 처리는 정적 DZ랑 동일하게 통합 (`dzEntry`로 합쳐서 같은 로직).

---

## 4. 런타임 3종 안전망 — DZ 전용

builder가 cp를 잘 박았다고 해도 race condition / corner case로 cp 처리가 실패할 수 있음. 런타임에 추가 안전망 3개. **DZ로 마킹된 노드만** 적용. 일반 merge는 cp 흐름 + FIFO 큐로 충분.

### (a) Auto gate — 매 step 위치 기반 강제 처리

위치: `deadlock-zone.ts:updateDeadlockZoneGates`

```
매 step, 모든 차량 순회:
  if (currentEdge.to_node ∈ DZ merge):       // 곧 DZ 진입할 차량
    if (내가 holder) continue;
    if (큐에 없음) → 자동 REQ + 큐 push       // ★ cp 발화 없이
    if (holder 없음) → grant 시도
    if (lock 못 받음) → 강제 STOP

  if (currentEdge.from_node ∈ DZ merge):     // 방금 DZ 통과한 차량
    if (내가 holder) → 자동 RELEASE          // ★ cp 발화 없이
```

**역할**: cp가 어떤 race로 발화 안 해도 *물리적 위치*만 보고 강제 처리. cp 시스템 보강 안전망.

### (b) Approaching-edge priority grant — grant 결정 시점

위치: `deadlock-zone.ts:grantNextInQueue`

```typescript
function grantNextInQueue(nodeName) {
  let nextVeh = queue[0];   // 기본: FIFO head

  if (isDeadlockZoneMerge(nodeName)) {
    for (const veh of queue) {
      if (veh.currentEdge.to_node === nodeName) {   // 즉시 통과 가능
        nextVeh = veh;
        break;
      }
    }
  }
  state.locks.set(nodeName, nextVeh);
}
```

**역할**: FIFO 1번이 물리적으로 못 오는 경우 → 큐 안에서 *지금 즉시 통과 가능한* 차량을 우선 grant. §1의 교착 시나리오 직접 해결.

일반 merge는 그냥 FIFO head. 분기 자체가 `isDeadlockZoneMerge(nodeName)` 안에서만.

### (c) Stuck holder swap — 2초 후 강제 이전

위치: `deadlock-zone.ts:detectAndSwapDeadlockedHolders`

```
매 step, 모든 DZ merge에 대해:
  if (holder.velocity == 0):
    if (holder가 incoming edge 위면): skip   // 단순 감속 false positive 회피
    if (stuck 시간 < 2초): skip
    if (stuck 시간 >= 2초):
      큐에서 ready 차량 찾기:
        STOP_REASON.LOCKED && currentEdge.to_node === merge
      찾으면 → performHolderSwap(oldHolder, newHolder)
```

**역할**: (a)(b)가 corner case로 실패한 경우의 마지막 안전망.

### 셋이 DZ 전용임을 코드로 확인

```typescript
// (a)
export function updateDeadlockZoneGates(...) {
  if (!state.deadlockZoneMerges || state.deadlockZoneMerges.size === 0) return;
  // DZ merge만 체크
}

// (b)
if (isDeadlockZoneMerge(nodeName, state)) {   // DZ 분기 안에서만 priority
  // approaching-edge 우선
}

// (c)
for (const nodeName of state.deadlockZoneMerges) {   // DZ만 순회
  // stuck swap
}
```

---

## 5. Stuck holder swap 상세

### 왜 단순 timeout RELEASE 안 쓰나

순진한 방법: "holder가 2초 이상 진행 못 하면 RELEASE → 다음 grant"

**문제**: oldHolder가 *큐 밖*으로 나가 버림. 그 차량 입장에선 cp 흐름에서 LOCK_REQUEST cp는 이미 지나간 후라 다시 큐 진입할 cp가 없음 → wedge.

**Swap의 핵심**: holder *권리만* 다른 차량에게 이전. 큐와 cp 흐름은 그대로. oldHolder는 그냥 lock만 잃을 뿐, 다음 사이클에 자연스럽게 다시 REQ 가능.

### 왜 2초인가

- 너무 짧으면 (1초): false positive — 단순 감속, 앞차 따라 잠깐 멈춤 → swap 발동 → 큐 꼬임
- 너무 길면 (5초): deadlock 해소 시간 길어져 throughput 저하
- 2초 = sweet spot

추가 false positive 방어 (`deadlock-zone.ts:309-316`):
```typescript
// holder가 incoming edge 위면 skip
// (곡선 진입 직후 일시적 감속일 수 있음)
if (holderEdge.to_node === nodeName) {
  stuckHolderSince.delete(nodeName);
  continue;
}
```

### Swap target 자격

큐에 있는 차량 중 **즉시 통과 가능**한 차량:
- `STOP_REASON.LOCKED` bit set (현재 lock 때문에 정지 중)
- `currentEdge.to_node === merge` (merge 통과 직전 위치)

이 두 조건이 보장되어야 swap 후 newHolder가 막힘 없이 진행. 조건 만족하는 차량 없으면 swap 안 함.

### Swap 동작

```typescript
function performHolderSwap(state, nodeName, oldHolder, newHolder) {
  queue.splice(oldIdx, 1);   // oldHolder 큐에서 제거
  queue.splice(newIdx, 1);   // newHolder 큐에서 제거
  state.locks.set(nodeName, newHolder);   // holder 이전

  // newHolder 정지 해제
  data[ptr + STOP_REASON] &= ~StopReason.LOCKED;
  data[ptr + MOVING_STATUS] = MovingStatus.MOVING;
  // LOCK_WAIT cp flag도 클리어 (이미 holder니까 더 안 대기)

  // 이벤트 emit (로그용)
  emit RELEASE(oldHolder), GRANT(newHolder), DEADLOCK_SWAP detail
}
```

---

## 6. 자주 묻는 후속 Q/A

### Q: stuck swap 2초 동안이나 멈춰야 발현되면 시뮬 throughput 떨어지지 않아?

> *"2초는 안전망 임계값이지 deadlock 해결 평균 시간이 아닙니다. 대부분 케이스는 (a) auto gate와 (b) approaching priority가 0초 또는 grant 시점에 즉시 처리해요. swap까지 가는 건 (a)(b)가 race로 실패한 corner case고, 빈도가 낮아야 정상입니다. DEV_LOCK_DETAIL 로그의 DEADLOCK_SWAP event로 빈도 모니터링하고, 자주 발현되면 임계값 줄이는 게 아니라 builder cp 위치나 검출 알고리즘을 보강하는 방향입니다."*

### Q: 3종 메커니즘이 모든 merge에 적용되나?

> *"DZ 전용입니다. 일반 merge는 cp 흐름 + FIFO 큐로 충분해요. DZ는 다이아몬드 구조 때문에 FIFO 순서와 물리적 통과 가능성이 어긋날 수 있어서 추가 메커니즘이 필요했고, 정적 분석으로 DZ 노드만 식별해서 거기에만 안전망 깔았습니다. 모든 merge에 깔면 매 step 전체 차량 순회 cost가 늘어나는데 일반 merge에는 그게 필요 없습니다."*

### Q: 왜 timeout 후 RELEASE 안 하고 굳이 swap?

> *"단순 RELEASE는 oldHolder를 큐 밖으로 빼버리는데, 그 차량 입장에선 cp 흐름에서 LOCK_REQUEST cp 이미 지나간 후라 다시 큐 진입할 수 없어요. swap은 큐와 cp 흐름은 그대로 두고 holder 권리만 옮기는 게 핵심입니다. oldHolder는 그냥 다음 사이클에 자연스럽게 다시 REQ."*

### Q: 변형 DZ 1, 2가 정확히 뭐예요?

> *"표준 DZ는 분기점에서 곧바로 합류점으로 가는 1-hop 다이아몬드. 그 사이에 통과 노드가 끼어 있는 경우도 deadlock 위험이 똑같아서 변형으로 잡습니다. 변형 DZ 2는 통과 노드 양쪽이 다 곡선(90+90 같은), 변형 DZ 1은 한쪽 곡선 + 다른쪽 짧은 직선(2m 이하). 검출 알고리즘은 패턴별로 다르게 잡지만 일단 DZ로 마킹되면 런타임 메커니즘은 패턴 구분 없이 똑같이 적용됩니다."*

### Q: DZ에서 lock 거는 위치는 어떻게 정해요?

> *"builder가 path 따라가며 각 merge가 DZ인지 isDeadlockMergeNode로 체크해요. DZ면 WAIT를 entry edge 끝(분기 노드 진입 직전)에 박아서 zone 진입 자체를 차단합니다. REQ는 entry edge 안쪽 5.1m (변형 DZ면 1m). 거꾸로 거슬러 가다가 곡선 만나면 그 곡선 ratio 0.5에서 stop — 곡선 위에서 정지 안 시키려고요."*

### Q: 곡선 위에서는 왜 정지 안 시켜요?

> *"곡선 위에서 정지하면 후속 차량 막힘 + 곡선 진입 후 추가 감속 어려움. 그래서 REQ는 곡선 ratio 0.5에서 발동(메모리 작업이라 정지 안 함)하고, WAIT는 반드시 직선 위 또는 정지 가능한 위치에 박습니다. builder가 거꾸로 거슬러 가다 곡선 만나면 더 안 가고 거기서 멈춰요."*

### Q: lock 못 받았을 때 부드럽게 멈춰요?

> *"lock 시스템은 '여기서 정지' 신호만 줍니다. 실제 감속은 movement-update가 별도로 처리해요 — 곡선/feature 도달 N미터 전이면 linearPreBrakeDeceleration로 미리 감속하고, lock cp 도달 순간 STOP_REASON.LOCKED bit set되면 vel=0. lock cp 위치 + pre-brake 거리만 잘 맞으면 자연스럽게 멈춥니다."*

---

## 7. 개발 진화 (회고)

> *"처음엔 단순 FIFO였는데 다이아몬드 구조에서 deadlock이 자주 났어요. 합류 노드에 isDeadlockMergeNode 플래그 박고 분기 처리 시작했고, 곡선 끼인 변형이나 짧은 직선 끼인 변형도 발견될 때마다 검출 알고리즘에 패턴 추가했습니다. 그러다가 런타임 분기 로직(zone-internal vs zone-external preemption, priority escalation 등)이 누적되면서 starvation이 생겼고, 'DZ 검출은 패턴별로 정교하게 / 런타임은 패턴 구분 없이 같은 3종 메커니즘으로 통합'으로 정리한 게 현재 버전입니다."*

핵심: **복잡도 누적 → 의식적 단순화**. 검출은 정교하게 패턴별 분리, 런타임은 단일 path로 통합.
