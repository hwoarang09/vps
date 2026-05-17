# ML Routing Agent - AI Context

## 역할

VPS 시뮬레이터의 라우팅을 **EWMA → ML 예측 기반**으로 교체하는 프로젝트 전담 에이전트.
EWMA로 계산하는 Dijkstra edge cost를, 시계열 ML 모델이 예측한 미래 transit time으로 바꾼다.

> **ML은 Dijkstra가 아니라 EWMA를 대체한다.** Dijkstra가 길을 찾고, ML은 cost 숫자만 공급한다.

## 1순위 참조 문서

**`doc/ml-edge-cost-prediction.md`** — 설계 논의 전체(의문→답변 13개 + 로드맵 + 용어집 + TODO).
설계 결정·근거는 전부 거기 있다. 이 파일은 **현재 진행 상태 + 코드 포인터**만 들고 간다.
설계 내용을 여기 복붙하지 말 것 — doc이 single source of truth.

## 현재 상태 (2026-05-18)

**로그 인프라 구현 완료** — Transition / Lock / Route(committed path) 로깅 모두 동작.
다음은 Static dump export 확인 + offline 변환 스크립트(로드맵 stage 0).

### 로드맵 (doc §4)
| stage | 목표 |
|---|---|
| 0 | autocorrelation decay 측정 + baseline 3개 (persistence/historical mean/EWMA) |
| 0.5 | conditional lookup table sanity check |
| 1 | projected_demand feature + LightGBM, 단일 horizon(30s) |
| 2 | multi-horizon(5) + quantile(P90) |
| 3 | 1-hop 이웃 feature |
| 4 | TDSP 통합 + routing oscillation 측정/완화 |
| 5 | (선택) GNN |

## 코드 위치 포인터

| 대상 | 위치 |
|---|---|
| 로그 프로토콜 (EventType enum) | `src/logger/protocol.ts` |
| Worker 로거 | `src/logger/` (SimLogger) |
| 라우팅/Dijkstra | `src/shmSimulator/managers/` (RoutingManager 계열) |
| edge cost (EWMA) | RoutingManager 내부 — ML cost 테이블이 대체할 지점 |
| offline 분석 스크립트 | `scripts/log_parser/` 패턴 따라 신규 추가 예정 |

## 로그 현황

`src/logger/protocol.ts` 기준:
- ✅ **Transition** — `ML_EDGE_TRANSIT = 3` (24B). 정답 transit_time 추출 가능.
- ✅ **Route** — `ML_ROUTE = 2` (412B 고정: ts, vehId, pathLen + edge u32×100, `ROUTE_MAX_EDGES=100`).
  committed path 전체 edge 순서(1-based) 기록 → projected_demand 계산 가능.
  Dijkstra 경로 산출 시 `AutoMgr.onPathFound` → `SimLogger.logRoute`. 파서는 `log_parser.py` `parse_route_file`.
  (`DEV_PATH=11`은 메타만 남기는 별도 로그로 잔존.)
- ✅ **Lock** — `ML_LOCK = 4`.
- ✅ **orderComplete** — `ML_ORDER_COMPLETE = 1` (40B, 반송 6 타임스탬프). 반송 완주 시 1건.
- ⚠️ veh_state / edge_queue 는 불필요로 판단되어 제거됨 (offline 복원 가능 — doc Q10).
- 바이너리 파싱은 `log_parser.py` 단일 소스 (analyze.py가 import). UI 다운로드 목록은 `simLogUtils.ts` 가
  `protocol.ts`에서 suffix↔recordSize 자동 생성.
- 로그 설정(어떤 이벤트 남길지)은 Log Settings 패널 → Play 시점에 확정, 진행 중 잠금.

## 다음 스텝 (doc §6 TODO)

1. [x] Transition 로그 존재 확인 → `ML_EDGE_TRANSIT` 있음
2. [x] **Route 로그(committed path)** → `ML_ROUTE` 구현 완료 (v0.4.73)
3. [ ] Static dump (edge/node 정적 표) export 확인 ← **다음 작업**
4. [ ] 데이터 수집 리라우팅 빈도 1개 확정 (5 edge마다 권장)
5. [ ] Python offline: raw → 슬라이딩 윈도우 → feature/label parquet 변환 스크립트
6. [ ] stage 0: autocorrelation decay 측정 스크립트 + baseline 3개
7. [ ] graph topology static feature (betweenness centrality 등, networkx)
8. [ ] stage 1: LightGBM 단일 horizon + projected_demand ablation 실험
9. [ ] oscillation metric 3종 + FIFO violation rate 측정 코드

## 작업 원칙 (doc §7)

1. ML은 EWMA를 대체 — cost 숫자 공급기
2. 단일 LightGBM 모델 + edge_id는 categorical 1컬럼 (900개 개별 모델 금지)
3. 시작은 LightGBM, 딥러닝은 baseline 한계 확인 후
4. config는 고정하거나 feature로 — 숨기고 섞으면 학습 망함
5. projected_demand로 정책 의존성을 input feature로 빼낸다
6. raw 이벤트만 로깅 → offline 변환 (2단계)
7. train/test는 시간순 split (random = leakage)
8. 모든 stage throughput A/B 측정 — baseline 못 이기면 무의미

## 아키텍처 제약 (CLAUDE.md 준수)

- ML 추론은 **차량당이 아니라 edge당 × horizon당** — 매 1 sim-초 1회 batch forward.
  결과를 SharedArrayBuffer cost 테이블에 저장, Dijkstra가 O(1) lookup.
- Worker 안에 Three.js 금지. 추론 엔진(onnxruntime-web 등)은 worker에서.
- raw 로그는 worker에서 OPFS 직접 append (가볍게).
