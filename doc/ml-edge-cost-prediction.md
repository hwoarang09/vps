# ML 기반 Edge Cost 시계열 예측 — 설계 논의 정리

> AMHS 시뮬레이터의 라우팅을 EWMA → ML 예측 기반으로 바꾸는 프로젝트.
> 이 문서는 설계 논의 전체(의문 → 답변)를 정리한 것.
>
> **v2 (2026-05-16)**: 피어 리뷰 반영 — oscillation 완화 기법 구체화, projected_demand
> ablation 실험 설계, TDSP FIFO violation 측정, graph topology static feature 추가.

---

## 0. 한 줄 요약

현재 EWMA로 계산하는 Dijkstra edge cost를, **시계열 ML 모델이 예측한 미래 transit time**으로 교체한다.
edge별로 10/30/60/120/180초 뒤 transit time을 예측하고, Dijkstra는 경로상 누적 ETA에
맞는 horizon 값을 골라 쓴다(Time-Dependent Shortest Path).

핵심: **ML은 길을 찾지 않는다. Dijkstra가 찾는다. ML은 Dijkstra가 먹는 cost 숫자를 공급할 뿐이다.**
즉 ML은 Dijkstra가 아니라 EWMA를 대체한다.

```
EWMA 라우팅 = Dijkstra( cost = EWMA가 계산한 edge transit time )   ← 과거 회고(lagging)
ML   라우팅 = Dijkstra( cost = ML이 예측한 edge transit time )      ← 미래 예측(leading)
```

---

## 1. 의문 → 답변 정리

### Q1. 30K(또는 100K) 차량이면 추론 비용이 폭발하지 않나?

**아니다. 추론은 차량당이 아니라 edge당 × horizon당 한다.**

```
매 1 sim-초마다 1회 추론:
  입력  = [900 edges × feature_dim]   (현재 상태)
  출력  = [900 edges × 5 horizons]    (transit time 예측)
→ 이 테이블을 SharedArrayBuffer에 저장
→ 차량들이 Dijkstra 돌릴 때 그 테이블을 O(1) lookup
```

추론 비용은 **차량 수와 무관**. 30K든 100K든 동일. 1초에 1번, 900×5 batch forward.

### Q2. 900개 edge를 개별 모델로 학습?

**하지 마라.** 이유:
- 데이터 희소성: edge별 통행 빈도 격차 큼 → 희소 edge 모델은 노이즈 학습
- 정보 공유 0: 인접 edge 간 전파(spillback)를 못 배움
- 운영 악몽: 900개 artifact 버전 관리/배포
- 모델 크기 폭증

→ **단일 모델 하나.** edge_id는 categorical feature로 1컬럼만 넣는다.

### Q3. "시간축으로 stationary하다"가 무슨 뜻?

**언제 들여다봐도 시스템의 통계적 성질(평균/분산/출렁임 패턴)이 같다.**

값이 안 변한다는 게 아니라, 출렁임의 *규칙*이 시간이 지나도 안 변한다는 뜻.

- Non-stationary 예: warm-up 구간, 도중 차량 수 변경, 시간대별 job 패턴 변화, recipe 변경
- Stationary 예: warm-up 후 차량 수 고정 + job 생성이 고정 확률과정

**왜 중요한가:**
예측에 쓸 수 있는 정보는 두 종류 —
1. 절대 시각 정보 ("지금 50000초니 곧 바빠짐") — stationary면 **무가치**
2. 현재 상태의 관성(autocorrelation) — 시간이 지나면 사라짐

stationary면 긴 horizon 예측은 historical mean으로 수렴 → 짧은 horizon만 의미.
non-stationary면 긴 horizon에도 신호가 생김.

→ **stage 0에서 transit time의 autocorrelation decay를 lag 10/30/60/120/180초로 찍어
의미 있는 horizon 개수를 먼저 정한다.**

### Q4. "horizon이 길어질수록 (신호가) 사라진다"?

용어는 **autocorrelation(자기상관) decay**. 신호가 자기 과거와 닮은 정도가
시간 간격(lag)이 커질수록 떨어진다 = 시스템의 "기억"이 사라진다.

```
상관도
1.0 ┤●
    │ ●●●
    │    ●●●●
0.0 ┤        ●●●●●●●●●●●  ← 여기부터 과거가 미래를 못 알려줌
    └──┬───┬───┬────┬────
      10s 30s 60s 120s 180s   lag
```

### Q5. 어떤 모델로 시작? 딥러닝?

**딥러닝 아님. LightGBM(또는 XGBoost)으로 시작.**

이유:
- edge_id를 categorical feature로 그냥 넣으면 됨 (embedding 직접 안 짜도 됨)
- 트리가 혼잡/이웃 feature로 치는 split은 모든 edge가 공유 → cold edge도 혜택
- 학습 수 초~수십 초, 하이퍼파라미터 부담 거의 없음
- tabular multi-horizon regression에서 작은 MLP를 보통 이김
- ONNX export 가능 (onnxmltools/skl2onnx), worker 추론 가벼움
- **포폴 관점: LightGBM도 못 이기는 딥러닝 모델은 마이너스.** baseline 재고
  GBM으로 feature 검증하고 그래도 부족해서 DL 갔다 = 강한 스토리

추가 기법:
- **Quantile regression**: P50뿐 아니라 P90도 예측 → 분산 큰 edge 회피하는 risk-averse 라우팅
  - Dijkstra cost 활용 방식 (stage 2에서 택일·튜닝):
    - `cost = α·P50 + (1−α)·P90` — α로 보수성 조절 (균형)
    - `cost = P50, 단 P90 > 임계값이면 회피` — 조건부 회피
    - `cost = P90` — 완전 보수적
  - 어떤 방식을 쓰느냐가 모델 출력 활용법을 정함 → stage 2에서 명시해야 막히지 않음
- 5개 head 만들지 말고 **horizon h를 입력 feature로** → 단일 모델로 임의 horizon 쿼리 (TDSP 보간에 유리)

딥러닝은 stage 4~5: spatio-temporal 모델(Graph WaveNet 계열)이 다단계 전파를
자동 학습. LightGBM이 hand-craft feature로 한계 보일 때 간다.

### Q6. LightGBM이 그래프 자료구조를 학습하나?

**아니다.** LightGBM은 평평한 표(row 모음)만 본다. edge 연결 관계를 모른다.

대신 그래프 정보를 **사람이 미리 컬럼으로 씹어서 먹인다**:
- `upstream_count`, `downstream_count` = 1-hop 그래프 정보
- 2-hop 원하면 이웃의 이웃까지 집계
- `projected_demand` 자체가 그래프 연산 (차량 경로를 그래프 위에서 walk)

이게 "hand-crafted graph feature". GNN은 이 전파를 자동/임의 hop으로 학습 = 차이점.
→ 시작은 LightGBM + 1-hop hand-craft feature. 그래프 학습은 다음.

### Q7. Input으로 뭘 넣나? node/edge 데이터를 어떻게 "조합"하나?

**조합하지 않는다. 전부 컬럼으로 나열한다. 조합은 트리가 한다.**

학습 샘플 1개 = (edge i, 예측시점 t, horizon h) 하나 = 한 행.

| 분류 | feature | 타입 |
|---|---|---|
| 정적 | length, max_speed(직선5/곡선1), station_count | 수치 |
| 정적 | is_merge, is_junction, deadlock_zone_type, is_curve | 범주 |
| 정적(topology) | betweenness_centrality, dist_to_nearest_merge, dist_to_nearest_station, on_loop_vs_highway | 수치/범주 |
| 동적(t) | cur_vehicle_count, cur_avg_speed, lock_wait_count | 수치 |
| 동적(t) | last_transit_time, ewma_transit_time | 수치 |
| 의도 | **projected_demand(i, h)** | 수치 |
| 이웃(1-hop) | upstream/downstream_count, upstream/downstream_projected_demand | 수치 |
| 전역 | total_active_vehicles | 수치 |
| horizon | h (10/30/60/120/180) | 수치 |
| 정체성(보조) | edge_id | 범주 |
| **정답** | actual transit_time(i, t+h) | 수치 |

topology feature는 그래프에서 **한 번 계산하고 끝**(networkx 등). edge의 그래프상 위치
자체가 정적 정보 — betweenness가 높으면 critical edge, merge/station 거리는 혼잡 prior.
비용 거의 0인데 LightGBM에 강한 구조 prior를 줌.

트리의 뿌리→잎 경로가 곧 feature 조합 (`if is_merge AND proj_demand>10 AND length<5 → ...`).
범주형은 one-hot 안 함 — LightGBM categorical 네이티브 지원 (edge_id one-hot 하면 900컬럼 폭발).

### Q8. 데이터 규모는?

- **컬럼**: 수십 개 (30~50). 맞음.
- **행**: 수만 아님. 수백만~억.
  ```
  행 = (시간/t샘플간격) × edge수 × horizon수
  예: 300시간, 30초마다, 900 edge, 5 horizon = 1.6억 행
  ```
- 실무: free-flow 샘플 다운샘플 + 혼잡 샘플 importance sampling → 수백만 행으로 정리
- 행끼리 독립 아님(같은 edge 인접 시각은 거의 동일) → train/test는 **무조건 시간순 split**
  (random split = leakage)

### Q9. 이게 supervised learning 맞나? 정답은 어디서?

**맞다. 미세먼지 보정 프로젝트와 똑같은 구조.**

```
좌측(입력 = t까지 아는 것)  →  우측(정답 = 미래 실제값)
edge 정적/동적/이웃/의도 feature  →  transit(t+10/30/60/120/180)
```

정답의 출처:
- 미세먼지: 비싼 레퍼런스 측정기
- 이 프로젝트: **완료된 시뮬 로그의 미래.** 시뮬은 이미 끝났으니 t+180초가
  실제로 어떻게 됐는지 로그에 적혀 있음. t를 슬라이딩하며 (입력, 정답) 쌍 생성.
- 시뮬레이터라 정답이 공짜로 무한정 나옴 (미세먼지보다 유리)

정답 컬럼 = edge별 time-bin 집계 평균 transit time. 빈 edge는 결측 아니라 free-flow 값.

**Leakage 함정**: 학습 땐 미래가 보이지만 입력(좌측)에는 t까지 정보만.
좌측=t까지 / 우측=t이후 경계 절대 안 넘김.

### Q10. 학습 데이터를 로그로 직접 못 남기나?

**못 남긴다. 2단계 파이프라인.**

```
[시뮬 worker]  raw 이벤트를 OPFS에 append  (가볍게)
      ↓
[Python offline]  raw → 슬라이딩 윈도우 → feature/label 테이블  (무겁게, 반복)
```

직접 못 남기는 이유:
1. 정답이 미래에 있음 (t 시점엔 t+180초를 모름)
2. feature를 수십 번 갈아엎으며 실험 → raw만 있으면 offline 재가공 공짜
3. 시뮬 속도 — worker는 가벼운 raw 이벤트만

**쌓을 raw 데이터 (최소 4종):**

| 로그 | 내용 | 기록 시점 | 신규? |
|---|---|---|---|
| Transition | veh_id, edge_id, enter_ts, exit_ts | edge 진입/이탈 | 확인 필요 |
| **Route** | veh_id, ts, committed path(edge 순서) | Dijkstra 새 경로 산출 시 | **신규 — 핵심** |
| Lock | node/edge, event type, ts | lock 이벤트 | 있음 |
| Static dump | edge/node 표(length, max_speed, is_curve, station수, merge, deadlock_zone) | 세션 시작 1회 | 부분 존재 |

raw 이벤트 스트림만으로 offline에서 임의 시각 t 상태 전부 복원 가능:
- edge별 차량수 = Transition (진입−이탈) 누적
- projected_demand = Route 로그 경로를 nominal 속도로 forward walk
- lock 대기수 = Lock 로그
- 정답 transit_time = Transition (exit−enter)

timestamp는 **simulationTime** 기준(wall clock 아님).

### Q11. 리라우팅 빈도가 config다 (1edge/5edge/10edge/안함). 학습 괜찮나?

리라우팅 빈도는 두 가지에 영향:
1. **projected_demand 신뢰도**: 자주 리라우팅 → committed path 곧 바뀜 → 먼 horizon
   projected_demand가 노이즈. 안 함 → path 확정적 → feature 최강.
2. **학습 가능성**

**ML 철칙**:
> 결과에 영향 주는 config는 → ① 고정하거나 ② feature로 넣거나.
> 숨긴 채 섞으면 학습 망함 (모델이 못 보는 변수가 결과를 흔들면 그건 노이즈).

- 빈도 고정 → 잘 됨
- 빈도 섞고 안 알려줌 → 망함
- 빈도 섞고 `reroute_interval`을 feature로 → 됨 (복잡, stage 4+)

**추천**: stage 1은 한 값으로 고정. **5 edge마다 권장** (ML cost가 주기적으로 라우팅에
반영되면서 projected_demand lookahead도 살아있고 oscillation도 관리 가능).
"안 함"은 미래 cost 예측을 쓸 데가 없어 프로젝트를 무력화 → deploy 대상 아님,
projected_demand가 완벽한 control baseline으로만 사용.
**train 빈도 = deploy 빈도** 반드시 일치.

### Q12. (핵심 혼동) EWMA 데이터로 학습한 모델을, 모델 라우팅에 쓰면 다른 상황 아닌가?

**맞다 — 이 지적은 옳다.** `transit(t+30s)`는 30초간 차들이 어디로 갔냐로 정해지고,
그건 라우팅 정책이 정한다. → **미래 예측은 정책 의존적이다.**

구분:
| | 정책 의존? |
|---|---|
| 순간 물리: "지금 이만큼 몰림 → 지금 transit time" | ❌ 무관 |
| 미래 예측: "지금 상태 → 30초 뒤 transit time" | ✅ **의존** |

**해법 = projected_demand로 정책 의존성을 input feature로 빼낸다.**

- 입력이 현재 상태뿐이면 → 모델이 "차들이 앞으로 어디 갈지"를 내부 추측 →
  학습 데이터가 EWMA니 EWMA식 추측에 갇힘 → 문제 발생
- 입력에 projected_demand를 주면 → "어디 갈지"를 숫자로 직접 알려줌 →
  배포 시 그 숫자를 새 정책의 경로로 다시 계산해 주입 →
  모델이 배우는 잔여 함수(`proj_demand + 상태 → transit`)는 거의 정책 무관

잔여 shift는 남음(committed path 부정확, 도중 리라우팅 등) → **재학습 루프(DAgger)**:
```
v1: EWMA 데이터 학습 → 모델 라우팅 배포 → 그 런 로그 재수집
v2: 합쳐서 재학습 → 배포 → 한두 바퀴면 모델 정책에서 안정
```
projected_demand가 큰 덩어리를 흡수해놔서 루프가 빨리 수렴.

(완전 정책 무관: 1-step 전이 모델을 30번 굴리며 매 스텝 정책 재적용 = world model
방식. 복잡 + 오차 누적 → stage 5+ 얘기.)

### Q13. projected_demand가 정확히 뭐냐?

**앞으로 그 edge에 몇 대 몰려올지 미리 세어본 숫자.** ML 아님, 산수.

계산 예 (t=1000초, edge E50):
```
차량 #7:  E12 위, 8초 뒤 이탈, path E12→E33→E50→E51, E33 nominal 20초
          → E50 도착 = 1000+8+20 = t+28초
차량 #22: → E50 도착 t+34초
차량 #41: → E50 도착 t+55초
차량 #58: → E50 도착 t+61초

projected_demand(E50, 30s) = t+30초 근처 도착 = #7,#22 = 2
projected_demand(E50, 60s) = t+60초 근처 도착 = #41,#58 = 2
```

"입력에 넣는다" = 학습 행에 `proj_demand_30s` 컬럼을 추가하고 값 `2`를 넣는다.
length, 현재차량수 옆에 그냥 숫자 컬럼 하나. 모델은 "proj_demand 크면 transit 길다"를 학습.

⚠️ projected_demand는 모델의 **출력(예측)이 아니라 입력**. 사람이 경로 걸어서 계산해 먹임.

**모델 무관 / 동적 값:**
- 계산 절차(walk + count)는 어떤 모델을 쓰든 동일 = 모델 무관
- 그 안에 들어가는 경로는 그때 라우팅이 만든 것 = 값은 현재 정책을 자연히 반영
- 학습 땐 로그에서 offline, 배포 땐 worker에서 live로 계산
- → **라우팅 정책과 학습 모델 사이를 잇는 다리**

---

## 2. 추가로 짚은 리스크 — Routing Oscillation

모든 차량이 같은 예측으로 라우팅 → 다들 "혼잡 예측 edge" 회피 → 그 edge는 안 막히고
우회로가 막힘 → 다음 cycle 반대로. 고전적 dynamic traffic assignment 진동.
예측이 자기부정적이 됨. 리라우팅 잦을수록 feedback 강 → 위험 큼.

### 완화 기법 (구체)

```
방법 1 (path-level stochastic): 차량별 top-K 경로 sample.
  softmax(−cost/τ) 분포에서 선택 → 같은 OD pair여도 차량마다 다른 path
방법 2 (cost-level noise): cost 조회 시 차량마다 N(0, σ) 노이즈 추가
  → 같은 예측 cost를 차량마다 다르게 해석
방법 3 (damping): deployed_cost = β·EWMA + (1−β)·ML
  → β로 ML 영향력 조절. 배포 초기 β 크게 시작, oscillation 약하면 β 줄임
```

### Oscillation 측정 metric (반드시 같이 계산)

- **edge load variance over time**: edge별 차량수 시계열의 시간 분산
- **path 안정성**: 같은 OD pair의 연속 Dijkstra 호출 결과 경로의 Jaccard 유사도
  (낮으면 경로가 매번 출렁임 = 진동)
- **throughput rolling std**: 낮을수록 안정

metric 정의 없이 "완화했다"고 말할 수 없음 — 측정 지표부터 깔아둔다.

---

## 3. Dijkstra 변형 — Time-Dependent Shortest Path (TDSP)

"가까운 edge는 짧은 horizon, 먼 edge는 긴 horizon" = TDSP. 직관 맞음.
단, 버킷 키는 **hop 거리가 아니라 출발지로부터 누적 ETA**.

```
Dijkstra가 노드 u를 settle할 때 누적도착시각 a(u)를 들고 있음
edge (u,v) relax 시 → cost = predicted_cost(edge, horizon = a(u))
a(u)가 anchor 사이면 두 horizon 예측값 보간
a(u) > 180이면 180s 예측으로 clamp
```

→ 그래서 horizon을 입력 feature로 두면 임의 a(u)를 바로 쿼리 가능.
**주의 — FIFO 속성:** TDSP가 최적해를 보장하려면 FIFO(늦게 출발해 먼저 도착 불가)가
성립해야 한다. 정확한 조건은 "출발시각 τ + cost(τ)"가 τ에 대해 단조 비감소, 즉
`cost'(τ) ≥ −1`. **smoothing만으로는 보장 안 됨.** 실용 옵션:
- (a) 예측 cost 후처리로 단조 보정 강제 (arrival = τ+cost(τ)를 단조 clamp)
- (b) FIFO violation rate를 실측해서 충분히 낮으면 그냥 진행 (대부분 이쪽)
- (c) 비FIFO TDSP 알고리즘 (비쌈)

어느 쪽이든 **FIFO violation rate 측정**을 먼저 깔아둔다 (§4 검증·측정 설계).

---

## 4. 단계별 로드맵

| stage | 목표 | 내용 |
|---|---|---|
| 0 | baseline + 측정 | autocorrelation decay 측정, persistence/historical mean/EWMA 3개 baseline |
| 0.5 | sanity | conditional lookup table (학습 0, 비교용) |
| 1 | simple lift | projected_demand feature + LightGBM, 단일 horizon(30s), 시간순 split |
| 2 | multi-horizon | 5 horizon (horizon을 입력 feature로, 모델 하나) + quantile(P90) |
| 3 | spatial | 1-hop(필요시 2-hop) 이웃 feature |
| 4 | TDSP 통합 | 누적 ETA로 horizon 쿼리 + 보간, routing oscillation 측정/완화 |
| 5 | (선택) GNN | spatio-temporal 모델, non-stationary 시나리오 도입 후 |

각 stage마다 throughput / cycle time A/B 측정. **측정 안 하면 portfolio 가치 없음.**
ML이 baseline 3개를 못 이기면 ML 안 한 것만 못함.

### 검증·측정 설계 (이론 주장마다 증거를 붙인다)

- **stage 0 — autocorrelation decay 스크립트**: edge transit time 시계열을 lag
  10/30/60/120/180s로 ACF 계산 + persistence skill 곡선. Python 한 페이지 분량.
  이 곡선이 "의미 있는 horizon 개수"의 근거.
- **stage 1 — projected_demand ablation** ← 이 프로젝트의 핵심 증거:
  - 실험 A: projected_demand **빼고** 학습 → 배포 → throughput 측정
  - 실험 B: projected_demand **넣고** 학습 → 배포 → throughput 측정
  - A ≈ B → projected_demand가 분포 shift를 못 메움 → §1 Q12 가설 자체가 틀림
  - A < B → 이론 확증. portfolio narrative의 실증 근거 (면접에서 "증거?"에 대한 답)
  - 측정은 throughput뿐 아니라 §2의 oscillation metric도 함께
- **stage 4 — oscillation metric**: §2의 3개 metric 정의·계산. 완화 기법 적용 전후 비교
- **TDSP — FIFO violation rate 측정**: §3의 (b) 옵션 판단 근거
- **deploy 시 projected_demand cold-start**:
  - projected_demand는 *이미 존재하는* committed path(과거 reroute 시점 결정)에서
    계산됨 → 매 추론마다 즉시 풀어야 하는 순환(fixpoint)이 **아님**. ML 예측 → 새 path
    → 미래 projected_demand 변화로 이어지는 **시간 지연 feedback** (oscillation과 동류)
  - 진짜 문제는 t=0 **cold-start** 하나: 배포 직후엔 committed path가 없음
    → 첫 N분은 EWMA 라우팅으로 path를 채운 뒤 ML로 전환
  - 운영 중에는 stale snapshot(직전 tick의 path)으로 계산해도 충분

---

## 5. 용어집

- **stationary**: 언제 봐도 통계 성질이 같은 시계열
- **autocorrelation decay**: 신호가 자기 과거와 닮은 정도가 lag 커질수록 떨어짐
- **projected_demand(edge, horizon)**: 차량 committed path를 forward walk해 센,
  "앞으로 그 edge에 몰려올 차량 수". 모델 무관 동적 입력 feature
- **off-policy / distribution shift**: 학습 데이터를 만든 정책(EWMA)과 배포 정책(ML)이
  달라 입력 분포가 이동하는 문제
- **TDSP (Time-Dependent Shortest Path)**: edge cost가 시간 함수인 Dijkstra
- **leakage**: 입력에 미래 정보가 섞여 학습 점수만 좋고 실전 폭망하는 현상
- **DAgger 류 재학습 루프**: 새 정책으로 굴린 데이터를 재수집해 재학습 반복
- **routing oscillation**: 모두가 같은 예측으로 라우팅해 예측이 자기부정적이 되는 진동

---

## 6. 다음 스텝 (TODO)

1. [ ] **Transition 로그** 존재 여부 코드 확인 (없으면 추가)
2. [ ] **Route 로그(committed path)** 설계·추가 — projected_demand의 전제, 신규
3. [ ] Static dump (edge/node 정적 표) export 확인
4. [ ] 데이터 수집용 **리라우팅 빈도 1개 확정** (5 edge마다 권장)
5. [ ] Python offline: raw → 슬라이딩 윈도우 → feature/label parquet 변환 스크립트
6. [ ] stage 0: autocorrelation decay 측정 스크립트 + baseline 3개
7. [ ] graph topology static feature 계산 (betweenness centrality 등, networkx)
8. [ ] stage 1: LightGBM 단일 horizon + **projected_demand ablation 실험**(§4 검증 설계)
9. [ ] oscillation metric 3종 + FIFO violation rate 측정 코드 (stage 4 전 준비)

---

## 7. 핵심 원칙 (요약)

1. ML은 Dijkstra가 아니라 EWMA를 대체한다 — cost 숫자 공급기
2. 단일 모델 + edge_id는 categorical 1컬럼 (900개 개별 모델 금지)
3. 시작은 LightGBM. 딥러닝은 baseline·GBM 한계 확인 후
4. config는 고정하거나 feature로 넣거나 — 숨기고 섞으면 학습 망함
5. 미래 예측은 정책 의존적 — projected_demand로 그 의존성을 input feature로 빼낸다
6. raw 이벤트만 로깅 → offline에서 학습 테이블로 변환 (2단계)
7. train/test는 시간순 split (random split = leakage)
8. 모든 stage throughput A/B 측정 — baseline 못 이기면 무의미
