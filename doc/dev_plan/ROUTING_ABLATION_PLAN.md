# VPS Routing Ablation 작업지시서 (v2)

목표: Dijkstra 라우팅에 EWMA(Exponentially Weighted Moving Average) 기반 동적 비용 계산 strategy를 추가하고, 모든 strategy의 cost 단위를 **시간(seconds)** 으로 통일하여 ablation 비교가 공정하도록 만든다.

작업 기간 추정: 4~5일

**v2 변경점**: cost 단위를 시간으로 통일. EWMA cold fallback 옵션 제거(단일 fallback). BPR 식을 학술 표준(`freeFlowTime × (1 + α·ratio^β)`)에 맞게 정정.

---

## 코드 리뷰 결과 (작업 착수 전 필독)

> 아래는 현재 코드 상태를 검토한 결과입니다. 작업지시서의 가정과 다른 부분이 있으므로 반드시 확인하세요.

### ⚠️ 단위 결정: ms가 아닌 simulation-seconds

작업지시서는 "ms 권장"이라 했으나, **코드 전체가 simulation-seconds 단위**를 사용합니다:
- `linearMaxSpeed: 5.0` (m/s), `curveMaxSpeed: 1.0` (m/s) — `simulationConfig.json`
- `onEdgeTransit`의 `timestamp`, `enterTs`는 simulation time (seconds)
- `edge.distance`는 meters

**결정**: 내부 cost 계산은 **simulation-seconds** 사용. `freeFlowTime = distance / maxSpeed` → 단위 자연스러움 (m / (m/s) = s). KPI export 시에도 seconds 그대로 사용.

### ⚠️ 현재 BPR 공식 차이

현재 `bprCost` (Dijkstra.ts:66-78):
```
cost = distance * (1 + α * (volume/capacity)^β)
```
계획된 공식:
```
cost = freeFlowTime * (1 + α * ratio^β)
```

이 변경은 cost 단위를 meters→seconds로 바꾸는 것이므로 **α, β 기본값(4, 8)의 의미가 달라지지 않음** (무차원 multiplier). 단, cost 절대값이 변하므로 path 결정이 미세하게 달라질 수 있음.

### ⚠️ logOrderComplete 미사용

`SimLogger.logOrderComplete()`는 정의만 있고 **호출되는 곳이 없음** (dead code). Phase 5에서 KPI lead time 수집을 위해 TransferMgr의 dropoff 완료 시점에 호출 추가 필요.

### ✅ 재활용 가능 확인됨
- `RoutingStrategy` type (Dijkstra.ts:27) — `"EWMA"` 추가만 하면 됨
- `RoutingConfig` (fabConfigStore.ts:94-100) — `ewmaAlpha` 추가
- `RoutingContext` (Dijkstra.ts:42-46) — tracker, maxSpeed 필드 추가
- Per-fab override 패턴 (`getFabConfig()` merge) — 그대로 작동
- `AutoMgr.checkReroutes()` (AutoMgr.ts:442-505) — path change tracking hook 가능
- `isCurveEdge()` (checkpoint/utils.ts:41-43) — 직선/곡선 판별 OK
- `RoutingParamsPanel.tsx` — BprParamInput 패턴 참고하여 EWMA UI 추가

### ✅ menuLevel2Config 구조
Statistics 섹션에 "Export KPI" 추가 가능. 현재: Fab Stats, DB.

---

## 0. 컨텍스트

### 가설
관측 기반 동적 라우팅(EWMA로 추적한 edge 평균 transit time)이 밀도 기반(BPR)보다 throughput을 개선하는가? Trade-off는 무엇인가?

### 비교할 strategy (v2 — 단위 통일됨)

모든 cost 단위는 **simulation-seconds** 로 통일.

| ID | 이름 | 상태 | Cost 식 |
|---|---|---|---|
| S0 | DISTANCE | 기존 (수정 필요) | `edge.distance / maxSpeed`<br>= free-flow time |
| S1 | BPR | 기존 (수정 필요) | `freeFlowTime × (1 + α·(volume/capacity)^β)` |
| S2 | EWMA | **신규** | `EWMA(observed_transit_time)`<br>cold일 때: `edge.distance / maxSpeed` |

### 단위 통일의 의미
- 같은 fab에서 strategy 전환해도 cost 절대값 스케일 일관됨
- DISTANCE의 cold 값과 BPR의 free-flow 값과 EWMA의 cold fallback이 **모두 동일** (= `distance / maxSpeed`)
- BPR이 학술 표준 BPR 식 (`t₀ × (1 + α·v^β)`)에 정확히 일치함

### 측정할 KPI
- Throughput (carries/hour) — fab별
- Lead time (load → unload 완료): p50, p95
- Lock wait total (sec)
- Oscillation rate (path 변경 횟수 / 차량 / 분) — EWMA 약점 정량화
- Vehicle idle ratio

---

## 1. 현재 코드 상태 (참고)

작업 시작 전 다음 파일들 먼저 읽어서 구조 파악할 것:

- `src/common/vehicle/logic/Dijkstra.ts` — `RoutingStrategy`, `RoutingConfig`, `RoutingContext`, `bprCost` 함수 위치
- `src/store/simulation/fabConfigStore.ts` (line ~92~99) — `RoutingConfig` interface, per-fab override
- `src/components/react/menu/panels/params/RoutingParamsPanel.tsx` — 기존 UI 패턴
- `src/shmSimulator/core/FabContext/simulation-step.ts` (line ~136~155) — `onEdgeTransit` 콜백
- `src/logger/SimLogger.ts` — `logEdgeTransit`, `logOrderComplete`
- `src/logger/protocol.ts` — `ML_EDGE_TRANSIT`, `ML_ORDER_COMPLETE` 스키마
- `src/common/vehicle/logic/checkpoint/utils.ts:41` — `isCurveEdge(edge)` 헬퍼 (직선/곡선 판별, 활용)
- `src/config/worker/simulationConfig.ts` — `linearMaxSpeed`, `curveMaxSpeed` 위치

### 이미 잘 되어 있는 것 (재활용)
- Strategy 추상화 (`RoutingContext.config.strategy` 분기)
- Per-fab routing override (`fabConfigStore.fabConfigs[fabIndex].routing`)
- `onEdgeTransit` 콜백 (transit_time 관측 가능)
- `isCurveEdge(edge)` — 직선/곡선 판별

### 새로 만들어야 하는 것
- EdgeStatsTracker (EWMA 저장소)
- EWMA cost 분기 + 시간 단위 통일
- Path 변경 카운터 (oscillation 측정)
- KPI 자동 export

---

## Phase 1: EdgeStatsTracker (Day 1)

### 새 파일
`src/common/vehicle/logic/EdgeStatsTracker.ts`

### 책임
- edge별 EWMA(transit_time) 저장
- 관측치 들어오면 EWMA 갱신
- Dijkstra cost 함수에 cost 제공 (관측 없으면 undefined)
- 단위는 **simulation-seconds** 사용

### 인터페이스
```ts
export interface EdgeStatsTrackerConfig {
  ewmaAlpha: number;    // 0.0 ~ 1.0, default 0.1
}

export class EdgeStatsTracker {
  constructor(config: EdgeStatsTrackerConfig);
  
  /** 차량이 edge 통과 완료 시 호출. transitSec는 enterTs ~ exitTs 차이 (simulation seconds) */
  observe(edgeIndex1Based: number, transitSec: number): void;
  
  /** Dijkstra가 호출. 관측 없으면 undefined 반환 (호출자가 fallback 처리) */
  getEwma(edgeIndex1Based: number): number | undefined;
  
  /** 디버깅/리포트용 — 모든 edge의 현재 EWMA snapshot */
  snapshot(): Map<number, number>;
  
  /** 시뮬 reset 시 호출 */
  reset(): void;
  
  /** 설정 변경 (런타임 α 변경 가능) */
  updateConfig(config: Partial<EdgeStatsTrackerConfig>): void;
}
```

### EWMA 갱신 로직
```ts
observe(edgeIndex, transitSec) {
  const prev = this.ewma.get(edgeIndex);
  if (prev === undefined) {
    this.ewma.set(edgeIndex, transitSec);  // 첫 관측은 그대로
  } else {
    const alpha = this.config.ewmaAlpha;
    this.ewma.set(edgeIndex, alpha * transitSec + (1 - alpha) * prev);
  }
}
```

### Fab별 인스턴스
- Tracker는 **fab별로 독립 인스턴스** (Fab 1과 Fab 2의 EWMA 분리)
- `FabContext`에서 fab당 1개 생성하여 보관

### 테스트 (선택)
- observe 한 번 → 그 값 그대로
- observe 두 번 (5.0, 10.0) α=0.1 → 5.5
- reset 후 새 관측 → 첫 값 그대로

---

## Phase 2: Cost 함수 단위 통일 + EWMA 추가 (Day 1~2)

### 수정 파일
`src/common/vehicle/logic/Dijkstra.ts`

### 핵심 변경: 모든 cost를 시간 단위(simulation-seconds)로 통일

**1. RoutingStrategy 타입 확장**
```ts
export type RoutingStrategy = "DISTANCE" | "BPR" | "EWMA";
```
> 이름 "DISTANCE" 유지 (기존 호환). 의미만 "free-flow time"으로 변경.

**2. RoutingConfig 확장**
```ts
export interface RoutingConfig {
  strategy: RoutingStrategy;
  bprAlpha: number;
  bprBeta: number;
  bprMinCapacity: number;
  ewmaAlpha: number;    // default 0.1 (신규)
  rerouteInterval: number;  // 기존
}
```

`DEFAULT_ROUTING_CONFIG`에 `ewmaAlpha: 0.1` 추가.

**3. RoutingContext에 maxSpeed 정보 + tracker 주입**
```ts
export interface RoutingContext {
  config: RoutingConfig;
  edgeVehicleQueue: IEdgeVehicleQueue;
  vehicleSpacing: number;
  /** 직선 edge 최대속도 (m/s) */
  linearMaxSpeed: number;
  /** 곡선 edge 최대속도 (m/s) */
  curveMaxSpeed: number;
  /** EWMA strategy 시 필수 */
  edgeStatsTracker?: EdgeStatsTracker;
}
```

**4. 헬퍼: free-flow time 계산**
```ts
function freeFlowTime(edge: Edge, ctx: RoutingContext): number {
  const maxSpeed = isCurveEdge(edge) ? ctx.curveMaxSpeed : ctx.linearMaxSpeed;
  return edge.distance / maxSpeed;  // meters / (m/s) = seconds
}
```

`isCurveEdge`는 `src/common/vehicle/logic/checkpoint/utils.ts`에서 import.

**5. cost 함수 통합 + 단위 통일**
기존 `bprCost` 함수를 `edgeCost`로 일반화하고 모든 strategy를 시간 단위로:

```ts
function edgeCost(edge: Edge, edgeIndex1Based: number): number {
  if (!activeCtx) return edge.distance;  // fallback (호출 컨텍스트 없을 때)
  
  const ctx = activeCtx;
  const t0 = freeFlowTime(edge, ctx);  // 모든 strategy 공통 baseline
  
  switch (ctx.config.strategy) {
    case 'DISTANCE':
      return t0;  // free-flow time (정적)
    
    case 'BPR': {
      // BPR 표준 공식: t = t0 * (1 + α * (v/c)^β)
      const { bprAlpha, bprBeta, bprMinCapacity } = ctx.config;
      const volume = ctx.edgeVehicleQueue.getCount(edgeIndex1Based);
      const capacity = Math.max(bprMinCapacity, Math.floor(edge.distance / ctx.vehicleSpacing));
      const ratio = volume / capacity;
      return t0 * (1 + bprAlpha * Math.pow(ratio, bprBeta));
    }
    
    case 'EWMA': {
      const ewma = ctx.edgeStatsTracker?.getEwma(edgeIndex1Based);
      if (ewma !== undefined) return ewma;
      return t0;  // cold fallback = free-flow time (단일 fallback)
    }
  }
}
```

### 단위 일관성 체크리스트
- [ ] `t0` = `distance(m) / maxSpeed(m/s)` = seconds ✓
- [ ] BPR cost = t0 × multiplier → seconds ✓
- [ ] EWMA observed = `exitTs - enterTs` → simulation seconds ✓
- [ ] EWMA cold = t0 → seconds ✓
- [ ] **3개 strategy의 cost 단위 동일** ← 검증 필수

### 호환성 주의
- 기존 `bprAlpha`, `bprBeta` 튜닝값은 단위 변경의 영향을 받지 않음 (multiplier `(1 + α·ratio^β)` 자체는 무차원)
- 단 cost 절대값 변하므로 path 결정이 미세하게 달라질 수 있음. 회귀 테스트로 확인.

---

## Phase 3: 관측 hook 연결 (Day 2)

### 수정 파일
`src/shmSimulator/core/FabContext/simulation-step.ts`

기존 `onEdgeTransit` 콜백 (line ~136~155)에 tracker.observe 호출 추가:

```ts
onEdgeTransit: (vehId, fromEdgeIndex, toEdgeIndex, timestamp) => {
  const fromEdge = fromEdgeIndex >= 1 ? edges[fromEdgeIndex - 1] : undefined;
  if (fromEdge) {
    const enterTs = edgeEnterTimes.get(vehId) ?? 0;
    const transitSec = timestamp - enterTs;
    
    // 신규: EWMA tracker 갱신
    if (fabContext.edgeStatsTracker && transitSec > 0) {
      fabContext.edgeStatsTracker.observe(fromEdgeIndex, transitSec);
    }
    
    // 기존 로깅
    if (logger) {
      logger.logEdgeTransit(timestamp, vehId, fromEdgeIndex, enterTs, timestamp, fromEdge.distance);
    }
  }
  // ... 기존 로직 유지
}
```

> `transitSec > 0` 가드: 첫 edge 진입 시 enterTs=0이라 timestamp 그대로 큰 값이 들어가 EWMA 오염될 수 있음. 0 이하 또는 비정상 큰 값(예: 시뮬 시작 직후)은 스킵.

### FabContext에 tracker 통합
`src/shmSimulator/core/FabContext/index.ts` (또는 init):

- Fab 초기화 시 `EdgeStatsTracker` 인스턴스 생성
- `RoutingConfig.ewmaAlpha`로 tracker config 초기화
- Fab reset 시 `tracker.reset()`
- Strategy 변경 시 (런타임) tracker config update

### Dijkstra 호출부에 tracker 전달
`findShortestPath` 호출 시 `RoutingContext.edgeStatsTracker`로 fab의 tracker 전달.

### maxSpeed 주입
`RoutingContext` 생성 시 fab의 `movement.linear.maxSpeed`, `movement.curve.maxSpeed`를 함께 전달. fab override 우선, 없으면 default.

---

## Phase 4: UI 노출 (Day 2~3)

### 수정 파일
`src/components/react/menu/panels/params/RoutingParamsPanel.tsx`

### 작업
기존 RoutingParamsPanel에 EWMA 옵션 추가:

1. **Strategy 셀렉터에 "EWMA" 옵션 추가** (radio 또는 dropdown — 기존 패턴 따라)
2. **Strategy === "EWMA"일 때만 추가 노출**:
   - EWMA Alpha 슬라이더 (0.01 ~ 0.5, step 0.01, default 0.1)
   - 작은 도움말: "낮을수록 천천히 반응 (안정적), 높을수록 빨리 반응 (노이즈에 민감)"
3. **Per-fab override 패턴 그대로 유지** (기존 BPR 파라미터처럼)

> v1에서 있던 "Cold Fallback" 라디오는 제거. 단일 fallback (free-flow time)이라 사용자 선택 필요 없음.

기존 BprParamInput 컴포넌트 패턴 따라가면 됨.

---

## Phase 5: KPI 자동 집계 + Export (Day 3~4)

### 새 파일
`src/common/simulation/KpiAggregator.ts`

### 책임
- 시뮬 실행 동안 KPI 누적
- 명시적 export 시 JSON 생성

### 측정 항목 (fab별)
```ts
interface FabKpiReport {
  fab_index: number;
  config: {
    strategy: RoutingStrategy;
    ewma_alpha?: number;
    bpr_alpha?: number;
    bpr_beta?: number;
    vehicle_count: number;
  };
  duration_sec: number;
  
  // Throughput
  orders_completed: number;
  throughput_per_hour: number;
  
  // Lead time (sec)
  lead_time_p50: number;
  lead_time_p95: number;
  lead_time_mean: number;
  
  // Lock wait
  total_lock_wait_sec: number;
  lock_wait_per_order_sec: number;
  
  // Oscillation
  total_path_changes: number;
  oscillation_rate: number;  // changes / vehicle / minute
  
  // Vehicle utilization
  vehicle_idle_ratio: number;
}

interface RunReport {
  run_id: string;       // ISO timestamp
  map_name?: string;
  total_duration_sec: number;
  fabs: FabKpiReport[];
}
```

### 데이터 source
- **Lead time**: `ML_ORDER_COMPLETE` 이벤트의 `moveToPickupTs` ~ `dropDoneTs` 차이
  - **⚠️ 사전 작업 필수**: `logOrderComplete`가 현재 어디서도 호출되지 않음. TransferMgr의 dropoff 완료 시점에서 호출 추가 필요.
- **Throughput**: 단위 시간당 완료 order 수
- **Lock wait**: `ML_LOCK` 이벤트에서 누적 (이미 있는 데이터)
- **Path changes (oscillation)**: 차량별 last_path_signature 추적, Dijkstra 재호출 시 path 비교 (Phase 6)
- **Vehicle idle**: stop reason 추적 또는 velocity == 0 누적시간

### Export 방식
1. **수동 트리거**: 메뉴에 "Export KPI Report" 버튼 → JSON 다운로드
2. 파일명: `kpi_${ISO_timestamp}_${strategy}.json`
3. Download 방식은 기존 SimLogger 다운로드 패턴 참고

수동 우선. OPFS 자동 저장은 추후.

### Export 위치
- 새 메뉴 항목: `menuLevel2Config.tsx`의 Statistics 섹션에 "Export KPI" 추가

---

## Phase 6: Path Change Tracker (Day 4)

Oscillation 측정용. EWMA strategy의 약점 정량화에 필수.

### 위치
`AutoMgr.ts` — `checkReroutes()` (line ~442-505) 내부에 path change 감지 추가

### 로직
```ts
// 차량별 마지막 path 저장
private lastPath: Map<vehId, edgeIdx[]> = new Map();
private pathChangeCount: Map<vehId, number> = new Map();

onPathRecalculated(vehId, newPath) {
  const prev = this.lastPath.get(vehId);
  if (prev && !pathsEqual(prev, newPath)) {
    this.pathChangeCount.set(vehId, (this.pathChangeCount.get(vehId) ?? 0) + 1);
  }
  this.lastPath.set(vehId, newPath);
}

getOscillationRate(durationMin: number, vehicleCount: number): number {
  const total = Array.from(this.pathChangeCount.values()).reduce((a, b) => a + b, 0);
  return total / vehicleCount / durationMin;
}
```

KpiAggregator에서 이 값 가져와서 report에 포함.

---

## Phase 7: 검증 및 데모 (Day 5)

### 동작 검증
- [ ] Strategy="DISTANCE" 선택 → cost = free-flow time. 시뮬 동작은 distance 기반과 사실상 동일 (단조변환).
- [ ] Strategy="BPR" 선택 → 표준 BPR 식. 차량 몰리는 edge cost 증가, 분산 동작 확인.
- [ ] Strategy="EWMA" 선택 → 초기 1~2분 cold 동안 free-flow 사용, 이후 EWMA 값으로 cost 계산. console.log로 EWMA snapshot 확인.
- [ ] Per-fab strategy 다르게 설정 가능 (Fab1=BPR, Fab2=EWMA)
- [ ] EWMA alpha 변경 시 즉시 반영 (런타임)
- [ ] 3 strategy 모두 cost 단위 동일 (디버그 로그로 검증)
- [ ] KPI Export 클릭 시 JSON 다운로드, 위 스키마대로 채워짐
- [ ] Path change count가 0이 아님 (EWMA 시), DISTANCE 시 0 또는 매우 작음

### 비교 실험 (사용자가 직접 수행)
사용자가 같은 시나리오에서 strategy만 바꿔가며 3번 (DISTANCE / BPR / EWMA) 돌려서 KPI JSON 3개 비교. 비교 자동화는 작업 범위 외.

---

## 절대 하지 말 것 (Out of scope)

- ❌ DES (Discrete Event Simulation) 도입
- ❌ Hysteresis / oscillation 완화 로직 (S2 결과 보고 추후)
- ❌ ML/RL 라우팅
- ❌ NodeLockTracker (락 대기는 transit_time에 이미 포함됨)
- ❌ Cross-run 자동 비교 리포트 (수동 비교로 충분)
- ❌ EWMA cold fallback 사용자 옵션 (단일 fallback 고정)
- ❌ Strategy 이름 변경 ("DISTANCE" → "FREE_FLOW" 등 — 기존 호환)
- ❌ UI 전면 개편 — RoutingParamsPanel만 확장

---

## 변경 파일 요약

### 신규
- `src/common/vehicle/logic/EdgeStatsTracker.ts`
- `src/common/simulation/KpiAggregator.ts`

### 수정
- `src/common/vehicle/logic/Dijkstra.ts` — strategy 분기 + 시간 단위 통일 + RoutingContext에 maxSpeed
- `src/store/simulation/fabConfigStore.ts` — RoutingConfig에 ewmaAlpha 추가
- `src/components/react/menu/panels/params/RoutingParamsPanel.tsx` — EWMA UI
- `src/shmSimulator/core/FabContext/index.ts` — tracker 인스턴스 생성, RoutingContext maxSpeed 주입
- `src/shmSimulator/core/FabContext/simulation-step.ts` — onEdgeTransit에서 tracker.observe
- `src/common/vehicle/logic/AutoMgr.ts` — path change tracker hook (`checkReroutes` 내부)
- `src/components/react/menu/data/menuLevel2Config.tsx` — Export KPI 메뉴 추가
- (필요) TransferMgr 또는 order 완료 시점 — `logOrderComplete` 호출 추가

---

## 작업 순서

| Day | 작업 |
|---|---|
| 1 | EdgeStatsTracker 구현, 단위 테스트 |
| 1~2 | Dijkstra cost 함수 통합 (단위 통일), RoutingConfig 확장 |
| 2 | onEdgeTransit hook 연결, FabContext에 tracker + maxSpeed 통합 |
| 2~3 | RoutingParamsPanel UI 확장 |
| 3 | 동작 검증 (3 strategy 단위 일관성, EWMA 값 dump) |
| 3~4 | KpiAggregator 구현, lead time / throughput / lock wait 집계 |
| 4 | Path change tracker (oscillation), Export JSON |
| 5 | 검증, 사용자 비교 실험 1회 |

---

## 완료 기준

1. RoutingParamsPanel에서 strategy를 DISTANCE/BPR/EWMA 중 선택 가능
2. EWMA 선택 시 alpha 슬라이더 표시
3. 3 strategy의 cost가 모두 시간 단위로 일관됨 (디버그 검증)
4. EWMA 선택 시 워밍업 후 차량들이 점차 다른 경로로 분산되는 것 시각 확인
5. "Export KPI" 메뉴로 JSON 다운로드. 3 strategy 결과 비교 가능.
6. 기존 BPR 동작 회귀 없음 (path 결정 동일하거나 미세한 차이만)
