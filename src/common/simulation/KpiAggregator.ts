import type { RoutingStrategy } from "@/common/vehicle/logic/Dijkstra";

// ─── Report Types ───

export interface FabKpiReport {
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

  // Lead time (seconds)
  lead_time_p50: number;
  lead_time_p95: number;
  lead_time_mean: number;

  // Oscillation
  total_path_changes: number;
  oscillation_rate: number; // changes / vehicle / minute
}

export interface RunReport {
  run_id: string; // ISO timestamp
  total_duration_sec: number;
  fabs: FabKpiReport[];
}

// ─── Aggregator ───

export class KpiAggregator {
  private leadTimes: number[] = [];
  private ordersCompleted = 0;
  private startTime = 0;

  /** Call at simulation start (or reset) */
  start(simulationTime: number): void {
    this.startTime = simulationTime;
    this.leadTimes = [];
    this.ordersCompleted = 0;
  }

  /** Record a completed order's lead time (seconds) */
  recordOrderComplete(leadTimeSec: number): void {
    this.leadTimes.push(leadTimeSec);
    this.ordersCompleted++;
  }

  /** Generate report for a single fab */
  generateFabReport(params: {
    fabIndex: number;
    currentSimTime: number;
    vehicleCount: number;
    totalPathChanges: number;
    strategy: RoutingStrategy;
    ewmaAlpha?: number;
    bprAlpha?: number;
    bprBeta?: number;
  }): FabKpiReport {
    const durationSec = params.currentSimTime - this.startTime;
    const durationMin = durationSec / 60;
    const durationHour = durationSec / 3600;

    // Sort lead times for percentile calculation
    const sorted = this.leadTimes.slice().sort((a, b) => a - b);

    return {
      fab_index: params.fabIndex,
      config: {
        strategy: params.strategy,
        ewma_alpha: params.ewmaAlpha,
        bpr_alpha: params.bprAlpha,
        bpr_beta: params.bprBeta,
        vehicle_count: params.vehicleCount,
      },
      duration_sec: round2(durationSec),
      orders_completed: this.ordersCompleted,
      throughput_per_hour: durationHour > 0 ? round2(this.ordersCompleted / durationHour) : 0,
      lead_time_p50: percentile(sorted, 0.5),
      lead_time_p95: percentile(sorted, 0.95),
      lead_time_mean: sorted.length > 0
        ? round2(sorted.reduce((a, b) => a + b, 0) / sorted.length)
        : 0,
      total_path_changes: params.totalPathChanges,
      oscillation_rate:
        durationMin > 0 && params.vehicleCount > 0
          ? round2(params.totalPathChanges / params.vehicleCount / durationMin)
          : 0,
    };
  }

  reset(): void {
    this.leadTimes = [];
    this.ordersCompleted = 0;
    this.startTime = 0;
  }
}

// ─── Helpers ───

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil(p * sorted.length) - 1;
  return round2(sorted[Math.max(0, idx)]);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─── Download Utility ───

export function downloadKpiReport(report: RunReport): void {
  const json = JSON.stringify(report, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const strategy = report.fabs[0]?.config.strategy ?? "unknown";
  a.href = url;
  a.download = `kpi_${report.run_id}_${strategy}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
