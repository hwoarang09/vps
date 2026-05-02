# Short-Edge Wait Point Relocation (논의 기록)

## 1. 요약
- **베이스 버전**: v0.3.91 (`c6d71fa`) — 0.3.92~0.3.102는 reset됨
- **날짜**: 2026-05-02
- **상태**: 논의 단계 (구현 X)

짧은 직선 edge가 끼어 있는 변형 데드락 zone에서, **merge 직전(tn)에 wait를 거는 대신 한 단계 위(diverge node, fn)에서 wait를 걸자**는 제안. 코드 수정은 보류, 논의만 정리.

## 2. 문제 토폴로지

```
                    e143
        n134 ─────────────→ n135 ───→ ... ───→ n340 ───→ ...
         │                    ↑                  ↑
         │ e391 (분기)        │ merge            │ merge
         ↓                    │                  │
        n340                 n255                │
                              ↑                  │
                         e292 (짧음, 직선)        │
                              │                  │
                            n254 ──→ ... ───────→ ┘
                              (n254는 n340으로도 가는 분기)
```

핵심:
- **n134, n254가 두 분기점** — 둘 다 n135 / n340 양쪽 merge로 갈 수 있음
- **n135, n340이 두 합류점** — 양 분기점에서 들어옴
- **e292 (n254→n255)가 너무 짧음** — n255 직전에 wait 영역이 안 들어감
- e292는 직선이고 그 끝에서 곡선 합류로 들어가는 패턴

## 3. 관찰된 데드락 cycle (3-way)

| 차량 | 위치 | 보유 lock | 대기 lock | 막힌 이유 |
|------|------|-----------|-----------|-----------|
| A | n134 → n135 진입 직전 | **n135** | n340 (다음 merge) | 앞차 B 막힘 |
| B | n135 통과 후 n340 직전 | (이전 lock) | **n340** | C가 잡음 |
| C | n254-side, n340 향함 | **n340** | n135 (n255 거쳐 가야) | A가 n135 잡음 |

**Logical cycle: A→n340→C→n135→A**

발현 매개체는 **물리적 blocking**:
- B가 wait point 못 잡아 e292에 어정쩡하게 정지 → e292 봉쇄
- → C(B 뒤차)가 n254 통과 못 함 → C 못 움직임 → C의 lock 안 풀림
- → cycle 발현

## 4. 제안: Wait Point Relocation

### 4.1 룰 (1차)

```
For each diverge node n1 (out_degree ≥ 2):
  For each outgoing edge e (n1 → n2) where e is straight:
    If e.length < threshold:
      If 차량이 n2 다음에서 merge에 합류해야 한다면:
        wait point: n2 → n1로 한 단계 위로 옮김
```

`threshold ≈ lockWaitDistanceFromMergingStr + bodyLength + edgeMargin`
(wait 영역 + 차량 길이 + 안전 여유가 안 들어가면 짧음)

### 4.2 작동 원리

물리적 blocking 제거가 핵심. wait를 n254 entry edge로 올리면:
- B는 n254 진입 edge에서 멈춤 (e292 위가 아니라)
- e292 비어있음 → C는 n254 통과해서 n340 방향으로 자유롭게 진행
- C가 n340 lock 풀림 → A 진행 → A가 n135 lock 풀림 → B 진행

**Logical cycle은 그대로 존재**하지만, blocking이 없으면 holder가 결국 움직여서 release하므로 발현되지 않음.

### 4.3 정적 DZ 시스템과의 차이

| | 기존 정적 DZ | 본 제안 |
|---|---|---|
| 개념 | diverge-merge 묶음을 critical zone으로 처리, BRANCH_FIFO/ZONE_YIELD gate | wait 위치만 옮김 |
| Lock 의미 변경 | 있음 (gate 추가) | 없음 |
| 침습도 | 높음 | 낮음 |
| 구현 복잡도 | 중~높 | 낮음 |

## 5. 빈틈 검토

| # | 빈틈 | 심각도 | 대응 |
|---|------|-------|------|
| 1 | 다단계 짧은 edge (n1→n2→n3→merge, n2→n3도 짧음) | 중 | 룰을 재귀화: "wait 영역 들어가는 edge가 나올 때까지 거슬러 올라감" |
| 2 | n1 진입 edge도 짧으면 n1에서 wait도 못 잡음 | 중 | 빈틈 1과 동일하게 재귀로 |
| 3 | 곡선 짧을 때 동일 문제 (룰은 직선만 다룸) | 중 | "직선/곡선 무관, 짧으면 옮김"으로 일반화 |
| 4 | n1 entry edge에서 다른 branch 차량 head-of-line blocking | 토폴로지 의존 | 실측 throughput 측정 필요 |
| 5 | Lock 보유 시간 증가 (n254 → n135 통과까지) | 낮음 | e292 짧으니 거의 무시 (≈0.3초) |
| 6 | REQ 시점도 옮겨야 하나? | 낮음 | WAIT/REQ 둘 다 옮기는 게 안전. REQ는 5.1m 전 발동이라 자연스럽게 옮겨질 가능성 큼 |
| 7 | Detection 비용 | 낮음 | 정적 1회 (map load 시), edge 길이+토폴로지 기반 |
| 8 | n2 자체가 merge인 케이스 (n1→e_short→n2_merge) | 낮음 | 룰 자연스럽게 처리. diverge 조건 약화 가능 |
| 9 | 순수 logical deadlock (물리 blocking 없는 cycle) | 희귀 | 본 룰로 못 잡음. 별도 fallback (timeout)이 필요할 수 있음 |

## 6. 룰 최종형 (일반화)

```
정적 분석 (map load 시):

1. 모든 merge node M에 대해 각 진입 edge e_in (∗ → M):
2.   유효 wait 영역 길이 = e_in.length - lockWaitDistance
3.   if 유효 영역 < bodyLength + safetyMargin:
        # 이 edge에선 wait 못 들어감
        # 한 단계 위로
        n_pre = e_in.from_node
        e_prev = (∗ → n_pre)
        for each e_prev:
            recurse (재귀 1번 단계로)
        # 충분한 길이 edge 찾으면 그 위에 wait 위치 마킹
4. 차량별 path 추적: 마킹된 위치에 도달하면 거기서 lock 대기
```

## 7. 부가 컨텍스트

### 7.1 0.3.92~0.3.102 시도의 의미 재평가
- **0.3.92** debug 로그 — 이 패턴 detect되는지 확인용
- **0.3.93** runtime deadlock detection (timeout 기반 force-release) — 정적 detection이 이 케이스 못 잡으니 fallback
- **0.3.94** 정적 DZ 시스템 통째 제거 — 너무 공격적 (다른 케이스도 깨짐)
- **0.3.96~0.3.98** 정적 DZ 제거 후 발생한 lock 타이밍 엣지케이스 줄줄이 fix
- **0.3.99** holder stuck detection — runtime detection 빈틈 (waiter timeout만으론 안 잡힘) 보강
- → 본질은 **정적 detection 휴리스틱이 좁다**는 것. 0.3.91 base 위에서 detection을 보강하는 게 정공법.

### 7.2 0.3.99 holder stuck force-release의 추가 버그 (참고)
`deadlock-zone.ts:322-324`에 가드:
```js
if (!queue || queue.length <= 1) continue;
```
holder force-release가 "큐에 다른 차량이 대기 중일 때만" 발동. 본 토폴로지에선 후속 차량이 물리 blocking으로 REQ도 못 보내서 큐가 항상 비어있음 → force-release 영원히 안 발동. 0.3.91엔 무관하지만 0.3.99 이후 살릴 거면 이 가드도 손봐야.

## 8. 다음 단계 (구현 보류)

- A. 0.3.91의 `findDeadlockZonePairs` / `detectDeadlockZones` 휴리스틱 정독 → 본 토폴로지 잡는지/놓치는지 확인
- B. 0.3.92 디버그 로그를 0.3.91에 임시 적용 → DZ detection 결과 콘솔 확인
- C. 본 룰 (wait point relocation)을 정적 DZ system과 별개로 경량 구현 → 짧은 edge만 보호

당장은 코드 수정 없이 본 문서로 논의 기록만 남김.

## 9. 별건: 0.3.95 cherry-pick 후보
- 본 lock 이슈와 무관한 비-lock 변경: U-TURN 센서 stop 범위 0.1m → 0.25m (`src/common/vehicle/collision/sensorPresets.ts`)
- 0.3.91 base에 cherry-pick 가능 (`git cherry-pick 202135e`)
