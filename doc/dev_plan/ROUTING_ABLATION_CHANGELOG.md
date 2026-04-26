# Routing Ablation — 구현 변경 로그

작업지시서: `doc/dev_plan/ROUTING_ABLATION_PLAN.md`
빌드 확인: `npx tsc --noEmit` 통과

---

## Phase 1: EdgeStatsTracker (완료)

**새 파일**: `src/common/vehicle/logic/EdgeStatsTracker.ts`

### 역할
edge별 평균 통과 시간을 EWMA(지수가중이동평균)로 추적하는 저장소.
Dijkstra가 EWMA strategy일 때 이 값을 edge cost로 사용한다.

### 왜 만들었나
EWMA routing은 "이 edge를 실제로 통과하는 데 얼마나 걸렸는지"를 기반으로 cost를 매기는 전략이다.
이 관측 데이터를 저장하고 평활화(smoothing)하는 저장소가 필요해서 만들었다.

### EWMA 초기값 전략 (seed)

관측 데이터가 없는 edge는 이론적 free-flow time (`distance / maxSpeed`)으로 seed된다.
이후 실제 차량이 통과하면 observe()로 실측값이 α 비율만큼 반영.

**왜 seed를 쓰나?**
seed 없이 첫 관측값을 그대로 사용하면, 그 차량 1대가 운 좋게 빠르거나 운 나쁘게 느렸을 때
EWMA가 비현실적인 값에서 출발한다. seed(이론값)를 깔아두면 첫 관측의 영향이 α(=10%)로 제한되어 안정적.

```
예시 (α=0.1, edge 길이 10m, maxSpeed 5m/s):

  [cold] Dijkstra가 이 edge 처음 참조
         → seed(edge, 2.0)            ewma = 2.0  (이론값 10m / 5m/s)

  [1st]  차량 A가 실제 통과 (3.2초 소요)
         → observe(edge, 3.2)         ewma = 0.1×3.2 + 0.9×2.0 = 2.12

  [2nd]  차량 B가 통과 (5.0초 — 혼잡)
         → observe(edge, 5.0)         ewma = 0.1×5.0 + 0.9×2.12 = 2.408

  → 이론값에서 점진적으로 실측 쪽으로 수렴.
```

### 주요 메서드

| 메서드 | 설명 |
|--------|------|
| `seed(edgeIndex, freeFlowTimeSec)` | 이론적 초기값 설정 (이미 값 있으면 무시) |
| `observe(edgeIndex, transitSec)` | 실측 관측값 반영 (α·new + (1-α)·old) |
| `getEwma(edgeIndex)` | 현재 EWMA 값 반환 (없으면 undefined) |
| `reset()` | 시뮬 리셋 시 전체 초기화 |
| `updateConfig({ewmaAlpha})` | 런타임 α 변경 |
| `snapshot()` | 디버그용 전체 EWMA 맵 복사본 |

### Fab별 독립
- Fab 1과 Fab 2는 별도 EdgeStatsTracker 인스턴스 사용 (Phase 3에서 FabContext에 생성)

---

## Phase 2: Dijkstra cost 함수 통일 + EWMA 분기 (완료)

**수정 파일**: `src/common/vehicle/logic/Dijkstra.ts`

### 왜 바꿨나
기존 cost 단위가 **미터(거리)**였다. EWMA의 관측값은 **초(시간)**이므로 직접 비교 불가.
3개 strategy 모두 **simulation-seconds** 단위로 통일해야 같은 Dijkstra 알고리즘 안에서 공정하게 경쟁할 수 있다.

### 변경 상세

| 변경 | 위치 | Before → After | 근거 |
|------|------|----------------|------|
| RoutingStrategy | `:29` | `"DISTANCE" \| "BPR"` → `+ "EWMA"` | 새 strategy 추가 |
| RoutingConfig | `:31-39` | `ewmaAlpha: number` 추가 | EWMA smoothing factor 설정 |
| RoutingContext | `:44-55` | `linearMaxSpeed`, `curveMaxSpeed`, `edgeStatsTracker?` 추가 | free-flow time 계산에 maxSpeed 필요, EWMA에 tracker 필요 |
| DEFAULT_ROUTING_CONFIG | `:58` | `ewmaAlpha: 0.1` 추가 | 논문 표준 α=0.1 |
| cost 함수 | `:69-111` | `bprCost()` → `edgeCost()` + `freeFlowTime()` 헬퍼 | 함수 하나에 3개 strategy를 넣으면서 이름이 bprCost는 부적절 |
| 캐시 조건 | `:270, 314` | `isBpr` → `isDynamic` (DISTANCE만 캐시) | EWMA도 동적이므로 캐시 스킵 필요 |
| 호출부 | `:332` | `bprCost(...)` → `edgeCost(...)` | 함수명 변경에 따른 호출부 수정 |

### cost 계산 로직 (3-way switch)

```
edgeCost(edge, edgeIndex):
  t0 = freeFlowTime(edge)  // = distance / maxSpeed (직선 5m/s, 곡선 1m/s)

  switch (strategy):
    DISTANCE → t0                                    // 정적 free-flow time
    BPR      → t0 × (1 + α × (volume/capacity)^β)   // 학술 BPR (혼잡 반영)
    EWMA     → tracker.getEwma(edge) ?? seed(t0)     // 실측 기반 (cold면 t0으로 seed)
```

### BPR 공식 변경 (distance → time 기반)

```
Before: cost = distance × (1 + α·ratio^β)        ← 단위: 미터
After:  cost = freeFlowTime × (1 + α·ratio^β)    ← 단위: 초 (학술 표준 BPR)
```

**왜**: 학술 BPR 원형은 `t = t₀(1 + α(v/c)^β)` 이고 t₀는 free-flow travel time이다. 기존 코드는 distance를 t₀ 대신 쓰고 있었다. 직선/곡선 maxSpeed가 다르므로 (5:1) 시간 기반이 더 정확한 cost를 준다.

α(4), β(8)는 무차원 배수(multiplier)이므로 기존 값 그대로 유효.
단, cost 절대값이 바뀌므로 직선/곡선 비율 차이에 의해 path 결정이 미세하게 달라질 수 있음.
(직선 10m → 2초, 곡선 10m → 10초. 기존엔 둘 다 10m으로 동일했음)

### EWMA seed 흐름

```
1. Dijkstra가 EWMA strategy로 edgeCost(edge42) 호출
2. tracker.getEwma(42) → undefined (아직 관측도 seed도 없음)
3. tracker.seed(42, t0=2.0) → ewma[42] = 2.0 설정 (이후 seed 재호출 무시)
4. return 2.0

... 차량이 edge42 통과 후 ...

5. tracker.observe(42, 3.2) → ewma[42] = 0.1×3.2 + 0.9×2.0 = 2.12
6. 다음 Dijkstra 호출 → tracker.getEwma(42) = 2.12 반환 (seed 스킵)
```

---

## Phase 3: FabContext + 관측 hook 연결 (완료)

**수정 파일 2개**:
- `src/shmSimulator/core/FabContext/index.ts`
- `src/shmSimulator/core/FabContext/simulation-step.ts`

### FabContext/index.ts 변경

| 변경 | 위치 | 근거 |
|------|------|------|
| import `EdgeStatsTracker` 추가 | `:11` | tracker 인스턴스 생성에 필요 |
| `edgeStatsTracker` 프로퍼티 추가 | `:77` | fab별 1개 인스턴스 보관 |
| constructor에서 tracker 생성 | `:108` | `config.routingEwmaAlpha ?? 0.1`로 초기화 |
| routingContext에 `linearMaxSpeed`, `curveMaxSpeed`, `edgeStatsTracker` 주입 | `:140-154` | Phase 2에서 RoutingContext 확장한 필드를 실제로 채움 |
| `updateRoutingConfig`에 `ewmaAlpha?` 파라미터 추가 | `:255` | UI에서 런타임 α 변경 시 tracker에도 반영 |
| `dispose()`에 `edgeStatsTracker.reset()` 추가 | `:368` | 메모리 정리 |
| `step()`에서 ctx에 `edgeStatsTracker` 전달 | `:316` | simulation-step이 tracker에 접근 가능하도록 |

### simulation-step.ts 변경 (핵심)

**문제**: 기존 `onEdgeTransit` 콜백은 `logger`가 있을 때만 설정됐다.
```ts
// Before: logger 없으면 onEdgeTransit = undefined → EWMA 관측 안 됨
onEdgeTransit: logger ? (...) => { ... } : undefined,
```

**해결**: onEdgeTransit을 항상 설정. EWMA 관측은 logger 유무와 무관하게 동작.
```ts
// After: 항상 실행
onEdgeTransit: (vehId, fromEdgeIndex, toEdgeIndex, timestamp) => {
  // EWMA tracker: 항상 관측 (핵심)
  if (enterTs > 0 && transitSec > 0) {
    ctx.edgeStatsTracker.observe(fromEdgeIndex, transitSec);
  }
  // Logger: 있을 때만 기록
  if (logger) { logger.logEdgeTransit(...); }
  // edgeEnterTimes: 항상 기록
  edgeEnterTimes.set(vehId, timestamp);
},
```

**왜 `enterTs > 0` 가드?**
차량이 시뮬 시작 직후 첫 edge에 있을 때 enterTs가 0이다 (아직 set 안 됨).
이때 `transitSec = timestamp - 0 = timestamp` → 수백초 같은 비현실적 값이 들어가서 EWMA를 오염시킴.

| 변경 | 위치 | 근거 |
|------|------|------|
| `SimulationStepContext`에 `edgeStatsTracker` 필드 추가 | `:52` | step에서 tracker 접근 |
| `onEdgeTransit`을 항상 활성화 | `:136-155` | EWMA가 logger 없이도 관측 수집 |
| `enterTs > 0` 가드 | `:143` | 시뮬 시작 직후 오염 방지 |

---

## Phase 4: 메시지 파이프라인 (완료)

UI에서 EWMA alpha 값을 워커까지 전달하는 경로에 `ewmaAlpha` 추가.

```
RoutingParamsPanel (UI)
  → fabConfigStore.setRoutingConfig({ewmaAlpha: 0.1})
    → controller.setRoutingConfig(..., ewmaAlpha)
      → postMessage({type: "SET_ROUTING_CONFIG", ..., ewmaAlpha})
        → worker.entry.ts
          → FabContext.updateRoutingConfig(..., ewmaAlpha)
            → edgeStatsTracker.updateConfig({ewmaAlpha})
```

| 파일 | 변경 | 근거 |
|------|------|------|
| `src/store/simulation/fabConfigStore.ts` `:92-101` | `RoutingStrategy`에 `'EWMA'` 추가, `RoutingConfig`에 `ewmaAlpha: number` 추가, default `0.1` | UI store에서 EWMA 설정 보관 |
| `src/shmSimulator/types.ts` `:154` | `SimulationConfig.routingStrategy`에 `'EWMA'` 추가 | 워커 초기화 시 전달 |
| `src/shmSimulator/types.ts` `:159` | `SimulationConfig.routingEwmaAlpha?` 추가 | fab 초기화 시 α 전달 |
| `src/shmSimulator/types.ts` `:353` | `WorkerMessage SET_ROUTING_CONFIG`에 `ewmaAlpha?` 추가 | 런타임 변경 메시지 |
| `src/shmSimulator/MultiWorkerController.ts` `:556` | `setRoutingConfig` 시그니처에 `ewmaAlpha?` 추가 | 멀티 워커 → postMessage |
| `src/shmSimulator/index.ts` `:402` | 동일 (single worker controller) | 싱글 워커 → postMessage |
| `src/shmSimulator/worker.entry.ts` `:214-228` | `message.ewmaAlpha`를 `updateRoutingConfig`에 전달 | 워커 수신 → FabContext 전달 |

---

## Phase 5: RoutingParamsPanel UI 확장 (완료)

**수정 파일**: `src/components/react/menu/panels/params/RoutingParamsPanel.tsx`

### 변경

| 변경 | 근거 |
|------|------|
| `StrategyToggle`: 2버튼 → 3버튼 (EWMA 추가, 초록색) | 사용자가 3개 strategy 선택 가능해야 함 |
| DISTANCE 라벨 `edge.distance` → `free-flow time` | cost 단위가 시간으로 바뀌었으므로 |
| BPR 수식 라벨 `d*(...)` → `t0*(...)` | 동일 이유 |
| BPR 버튼 `rounded-r` → border 없음 (가운데) | 3개 버튼이므로 양끝만 rounded |
| `EwmaParams` 컴포넌트 추가 | EWMA alpha 조절 UI. 기존 `BprParamInput` 재사용 |
| `FullRouting` 타입에 `ewmaAlpha` 추가 | 설정 객체에 alpha 포함 |
| `pushToWorker`에 `cfg.ewmaAlpha` 전달 | controller까지 alpha 값 전달 |
| `getEffective`에 `ewmaAlpha` 반영 | per-fab override 시 alpha 값 반영 |
| 글로벌 + Per-fab 패널 모두에 EWMA 섹션 추가 | 양쪽 모두에서 EWMA 파라미터 조절 가능 |
| Override summary에 EWMA alpha 표시 | per-fab override 확인 |
| INFO 섹션에 EWMA 설명 추가 | 사용자 안내 |

### UI 동작
- Strategy === "EWMA"일 때만 EWMA params 활성 (나머지 전략이면 회색 비활성)
- Strategy === "BPR"일 때만 BPR params 활성

---

## Phase 6: Path Change Tracker (완료)

**수정 파일**: `src/common/vehicle/logic/AutoMgr.ts`

### 왜 만들었나
EWMA의 알려진 약점은 **oscillation** — 관측값이 변하면서 path를 자주 바꾸는 것.
이걸 정량화하려면 "차량이 경로를 몇 번 바꿨는지" 카운트가 필요하다.
나중에 KPI report에서 oscillation rate (path변경/차량/분)으로 표시.

### 변경

| 변경 | 위치 | 근거 |
|------|------|------|
| `lastPath: Map<number, number[]>` 추가 | `:112` | 차량별 마지막 경로 저장 |
| `pathChangeCount: Map<number, number>` 추가 | `:113` | 차량별 경로 변경 횟수 |
| `checkReroutes()`에서 path 비교 로직 | `:493-497` | `findShortestPath` 결과가 이전과 다르면 카운트 증가 |
| `getTotalPathChanges(): number` 공개 메서드 | `:788` | KpiAggregator가 호출 |
| `getPathChangeCount(): Map` 공개 메서드 | `:793` | 디버그/상세 분석용 |
| `dispose()`에 clear 추가 | `:807-808` | 메모리 정리 |
| `pathsEqual()` 헬퍼 함수 (클래스 밖) | `:893` | 배열 비교 유틸리티 |

### 동작 흐름
```
1. checkReroutes()에서 reroute interval 도달
2. findShortestPath(current, dest) 호출 → newPath
3. lastPath.get(vehId)와 비교 (pathsEqual)
4. 다르면 pathChangeCount[vehId]++
5. lastPath.set(vehId, newPath)
```

---

## Phase 7: KpiAggregator + Export (완료)

### 새 파일: `src/common/simulation/KpiAggregator.ts`

### 왜 만들었나
3개 strategy를 비교하려면 동일한 KPI를 JSON으로 뽑아서 나란히 놓아야 한다.
throughput, lead time, oscillation rate를 자동 집계하는 클래스.

### KpiAggregator 메서드

| 메서드 | 설명 |
|--------|------|
| `start(simulationTime)` | 집계 시작점 기록 |
| `recordOrderComplete(leadTimeSec)` | order 완료 시 lead time 기록 |
| `generateFabReport(params)` | FabKpiReport JSON 생성 (p50, p95, throughput 등 계산) |
| `reset()` | 전체 초기화 |

### downloadKpiReport 유틸
`Blob → URL.createObjectURL → anchor click` 패턴으로 JSON 파일 다운로드.
기존 SimLogger 다운로드 패턴(`src/logger/simLogUtils.ts:43-56`) 참고.

### Export KPI 메뉴 항목

**수정 파일**: `src/components/react/menu/data/menuLevel2Config.tsx`

Statistics 섹션에 `{ id: "stats-kpi-export", label: "Export KPI" }` 추가.
lucide-react `FileCheck` 아이콘 사용 (기존 Logs 메뉴와 동일 패턴).

### 알려진 미완성
- `logOrderComplete` 호출이 아직 없음 — order 완료 시점(TransferMgr dropoff 완료)에서 호출 추가 필요
- KPI Export 패널 컴포넌트 아직 미구현 — 메뉴 항목만 추가됨. 패널에서 KpiAggregator를 호출하는 UI 필요
- Vehicle idle ratio 미구현 — velocity=0 누적시간 추적 필요

---

## 전체 변경 파일 요약

### 신규 (3개)
| 파일 | 역할 |
|------|------|
| `src/common/vehicle/logic/EdgeStatsTracker.ts` | EWMA 저장소 |
| `src/common/simulation/KpiAggregator.ts` | KPI 집계 + JSON export |
| `doc/dev_plan/ROUTING_ABLATION_CHANGELOG.md` | 이 문서 |

### 수정 (10개)
| 파일 | 변경 요약 |
|------|-----------|
| `src/common/vehicle/logic/Dijkstra.ts` | strategy 타입, config, context 확장. cost 단위 시간 통일. bprCost→edgeCost |
| `src/common/vehicle/logic/AutoMgr.ts` | path change tracker (oscillation), order 타임스탬프 기록, orderStats 누적, resetOrderStats |
| `src/store/simulation/fabConfigStore.ts` | RoutingStrategy + RoutingConfig에 EWMA 추가 |
| `src/shmSimulator/core/FabContext/index.ts` | EdgeStatsTracker 생성, routingContext에 maxSpeed/tracker 주입 |
| `src/shmSimulator/core/FabContext/simulation-step.ts` | onEdgeTransit 항상 활성화, EWMA 관측 |
| `src/shmSimulator/types.ts` | SimulationConfig + WorkerMessage에 EWMA 필드 추가 |
| `src/shmSimulator/MultiWorkerController.ts` | setRoutingConfig에 ewmaAlpha 전달 |
| `src/shmSimulator/index.ts` | 동일 (single worker) |
| `src/shmSimulator/worker.entry.ts` | message.ewmaAlpha → updateRoutingConfig 전달 |
| `src/components/react/menu/panels/params/RoutingParamsPanel.tsx` | EWMA 토글/params UI, alpha 도움말 보강 |
| `src/components/react/menu/data/menuLevel2Config.tsx` | Export KPI 메뉴 항목 |
| `src/store/simulation/orderStatsStore.ts` | (신규) fab별 order 통계 Zustand store |
| `src/store/vehicle/shmMode/shmSimulatorStore.ts` | ORDER_STATS 콜백 등록 |
| `src/components/react/menu/panels/FabStatsPanel.tsx` | Transfer KPI 섹션 + Reset KPI 버튼 |

---

## Phase 8: 실시간 Throughput + Lead Time + Reset (완료)

### 왜 만들었나
EWMA routing ablation에서 가장 중요한 KPI는 **시간당 반송량(throughput)**과 **반송 소요시간(lead time)**이다.
기존 Fab Stats에는 속도/정지 통계만 있어서 strategy 비교가 불가능했다.
또한 시뮬 초반 워밍업 구간은 의미 없으므로 **Reset** 버튼으로 특정 시점부터 통계를 다시 쌓을 수 있어야 한다.

### 구조

```
Worker Thread                                Main Thread
─────────────                                ───────────
AutoMgr                                      orderStatsStore (Zustand)
  ↓ 상태전이 시 타임스탬프 기록                    ↑ updateFabStats()
  ↓ UNLOADING→IDLE에서 leadTime 수집             │
  ↓ orderStats.completed++                       │
FabContext.step()                                 │
  ↓ 1초마다 percentile 계산                       │
  ↓ postMessage(ORDER_STATS)                     │
  ────── Worker→Main ──────→                     │
MultiWorkerController                            │
  ↓ handleWorkerMessage                          │
  ↓ onOrderStatsCallback ──→ shmSimulatorStore ──┘
                                              FabStatsPanel
                                                ↓ useOrderStatsStore() 읽기
                                                ↓ Transfer KPI 표시

Reset 흐름:
  UI "Reset KPI" 클릭
    → controller.resetOrderStats() → postMessage(RESET_ORDER_STATS) → Worker
    → orderStatsStore.resetAll() → UI 초기화
```

### AutoMgr 변경 (`src/common/vehicle/logic/AutoMgr.ts`)

| 시점 | 코드 위치 | 기록 필드 | 근거 |
|------|-----------|-----------|------|
| order 할당 | `:331` | `MOVE_TO_PICKUP_TS = simulationTime` | lead time 시작점 |
| pickup 도착 + LOADING 시작 | `:186-187` | `PICKUP_ARRIVE_TS`, `PICKUP_START_TS` | 대기시간 분석 |
| LOADING 완료 | `:194-195` | `PICKUP_DONE_TS`, `MOVE_TO_DROP_TS` | 픽업-드롭 구간 분리 |
| drop 도착 + UNLOADING 시작 | `:221-222` | `DROP_ARRIVE_TS`, `DROP_START_TS` | 드롭 대기 분석 |
| UNLOADING 완료 | `:227-232` | `DROP_DONE_TS` + **leadTime 수집** | lead time 종료점 |

**lead time** = `DROP_DONE_TS - MOVE_TO_PICKUP_TS` (order 할당부터 완료까지 전체 시간)

### FabContext 변경 (`src/shmSimulator/core/FabContext/index.ts`)

- `lastOrderStatsFlush` 타이머 → 1초마다 `flushOrderStats()` 호출
- `flushOrderStats()`: AutoMgr.getOrderStats() → percentile 계산 → postMessage(ORDER_STATS)
- `resetOrderStats(simTime)`: AutoMgr.resetOrderStats() + flush 타이머 리셋

### FabStatsPanel 변경 (`src/components/react/menu/panels/FabStatsPanel.tsx`)

FabCard에 **Transfer KPI** 섹션 추가:
- Completed: 완료된 order 수
- Throughput: 시간당 반송량 (X/hr)
- Lead Time p50 / p95 / mean (초)

헤더에 **Reset KPI** 버튼: 클릭 시 Worker + Store 동시 초기화

### EWMA alpha 도움말 (`RoutingParamsPanel.tsx`)

```
Before: "낮을수록 안정적, 높을수록 민감"
After:  "α가 클수록 최근 통과 차량의 소요시간이 더 크게 반영 (민감)
         작을수록 과거 값 유지 (안정)"
```
