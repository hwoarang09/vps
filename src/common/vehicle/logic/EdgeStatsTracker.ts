export interface EdgeStatsTrackerConfig {
  ewmaAlpha: number; // 0.0 ~ 1.0, default 0.1
}

/**
 * Per-fab EWMA tracker for edge transit times.
 * Unit: simulation-seconds (consistent with Dijkstra cost).
 *
 * ## 초기값 전략 (seed)
 *
 * 각 edge의 EWMA 초기값은 이론적 free-flow time (= distance / maxSpeed)으로
 * seed된다. Dijkstra의 edgeCost()가 EWMA strategy에서 해당 edge를 처음 참조할 때
 * seed()를 호출하여 설정.
 *
 * 이후 실제 차량이 통과하면 observe()로 실측값이 α 비율로 반영된다.
 *
 * 예시 (α=0.1, edge 길이 10m, maxSpeed 5m/s):
 *   seed(edge, 2.0)         → ewma = 2.0  (이론값: 10/5)
 *   observe(edge, 3.2)      → ewma = 0.1*3.2 + 0.9*2.0 = 2.12
 *   observe(edge, 5.0)      → ewma = 0.1*5.0 + 0.9*2.12 = 2.408
 *
 * 이렇게 하면 첫 관측값 1개에 과도하게 의존하지 않고,
 * 이론값 기반으로 점진적으로 실측 쪽으로 수렴한다.
 */
export class EdgeStatsTracker {
  private ewma: Map<number, number> = new Map(); // edgeIndex1Based → EWMA (sim-seconds)
  private seeded: Set<number> = new Set(); // seed된 edge 추적
  private config: EdgeStatsTrackerConfig;

  constructor(config: EdgeStatsTrackerConfig) {
    this.config = { ...config };
  }

  /**
   * edge의 EWMA 초기값을 이론적 free-flow time으로 설정.
   * 이미 seed되었거나 observe된 edge는 무시.
   */
  seed(edgeIndex1Based: number, freeFlowTimeSec: number): void {
    if (this.ewma.has(edgeIndex1Based)) return; // 이미 값 있으면 스킵
    this.ewma.set(edgeIndex1Based, freeFlowTimeSec);
    this.seeded.add(edgeIndex1Based);
  }

  /** 차량이 edge 통과 완료 시 호출. transitSec = exitTs - enterTs (simulation seconds) */
  observe(edgeIndex1Based: number, transitSec: number): void {
    const prev = this.ewma.get(edgeIndex1Based);
    if (prev === undefined) {
      // seed 안 된 상태에서 관측 → 그대로 저장 (fallback)
      this.ewma.set(edgeIndex1Based, transitSec);
    } else {
      const alpha = this.config.ewmaAlpha;
      this.ewma.set(edgeIndex1Based, alpha * transitSec + (1 - alpha) * prev);
    }
  }

  /** Dijkstra가 호출. 값 없으면 undefined (호출자가 seed 또는 fallback 처리) */
  getEwma(edgeIndex1Based: number): number | undefined {
    return this.ewma.get(edgeIndex1Based);
  }

  /** 디버깅/리포트용 snapshot */
  snapshot(): Map<number, number> {
    return new Map(this.ewma);
  }

  /** 시뮬 reset / dispose 시 호출 */
  reset(): void {
    this.ewma.clear();
    this.seeded.clear();
  }

  /** 런타임 α 변경 */
  updateConfig(config: Partial<EdgeStatsTrackerConfig>): void {
    if (config.ewmaAlpha !== undefined) {
      this.config.ewmaAlpha = config.ewmaAlpha;
    }
  }
}
