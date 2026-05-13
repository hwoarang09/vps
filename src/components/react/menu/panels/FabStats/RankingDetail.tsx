import React, { useMemo } from "react";
import { useFabStatsUIStore, type DetailTabKey } from "./store";
import type { FabStats } from "../FabStatsPanel";
import { useOrderStatsStore } from "@/store/simulation/orderStatsStore";
import { useFabConfigStore } from "@/store/simulation/fabConfigStore";
import { panelCardVariants } from "../../shared/panelStyles";
import { SpeedGauge } from "./FabDetailCard";
import { SpeedHistogram } from "./charts/SpeedHistogram";
import { TimingHistogram } from "./charts/TimingHistogram";
import { OrderLifecycleBar } from "./OrderLifecycleBar";
import { ParametersTab } from "./ParametersTab";
import { VEHICLE_JOB_STATE_COLORS, MOVEMENT_STATUS_COLORS } from "@/config/colors";

const ROUTING_LABEL: Record<string, string> = { DISTANCE: "Distance", BPR: "BPR", EWMA: "EWMA" };

const DETAIL_TABS: { key: DetailTabKey; label: string }[] = [
  { key: "distribution", label: "Distribution" },
  { key: "parameters", label: "Parameters" },
];

// ============================================================================
// Throughput card (좌상단)
// ============================================================================

const ThroughputCard: React.FC<{ fabId: string }> = ({ fabId }) => {
  const stats = useOrderStatsStore((s) => s.fabStats[fabId]);

  return (
    <div className={panelCardVariants({ variant: "default", padding: "sm" })}>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-[10px] text-gray-500 uppercase tracking-wider">Throughput</span>
        <span className="text-[10px] text-gray-500 uppercase tracking-wider">Completed</span>
      </div>
      {stats && stats.completed > 0 ? (
        <div className="flex items-baseline gap-2">
          <div className="flex items-baseline gap-1">
            <span className="text-3xl font-bold text-green-300 leading-none tabular-nums">
              {stats.throughputPerHour.toFixed(0)}
            </span>
            <span className="text-[11px] text-gray-400">/hr</span>
          </div>
          <div className="flex items-baseline gap-1 ml-auto">
            <span className="text-3xl font-bold text-accent-cyan leading-none tabular-nums">
              {stats.completed.toLocaleString()}
            </span>
          </div>
        </div>
      ) : (
        <span className="text-xs text-gray-500">—</span>
      )}
    </div>
  );
};

// ============================================================================
// Job State Bar — 차량 상태 분포 (가로 stacked bar 한 줄)
// 우측에 sensor 정지 (movement=stopped) 차량 별도 표시
// ============================================================================

const JobStateBar: React.FC<{ fab: FabStats }> = ({ fab }) => {
  const total = fab.vehicleCount;
  if (total === 0) {
    return (
      <div className="flex items-center justify-center h-full text-[10px] text-gray-600 italic">
        No vehicles
      </div>
    );
  }

  const stopped = fab.stoppedCount;
  const stoppedPct = (stopped / total) * 100;

  const segments = [
    { count: fab.jobIdle, color: "#6b7280", label: "Idle" },
    { count: fab.jobMoveToLoad, color: VEHICLE_JOB_STATE_COLORS.MOVE_TO_LOAD, label: "→Load" },
    { count: fab.jobLoading, color: VEHICLE_JOB_STATE_COLORS.LOADING, label: "Loading" },
    { count: fab.jobMoveToUnload, color: VEHICLE_JOB_STATE_COLORS.MOVE_TO_UNLOAD, label: "→Drop" },
    { count: fab.jobUnloading, color: VEHICLE_JOB_STATE_COLORS.UNLOADING, label: "Unloading" },
  ];

  return (
    <div className="flex flex-col gap-1 h-full">
      <div className="flex items-baseline justify-between text-[10px] shrink-0">
        <span className="text-gray-400 uppercase tracking-wider font-semibold">Job State</span>
        <span style={{ color: MOVEMENT_STATUS_COLORS.stopped }}>
          stopped <span className="tabular-nums font-bold">{stopped}</span>
          <span className="text-gray-500 ml-0.5">({stoppedPct.toFixed(0)}%)</span>
        </span>
      </div>
      <div className="flex h-3 rounded overflow-hidden bg-panel-bg-solid shrink-0">
        {segments.map((s, i) => {
          const pct = (s.count / total) * 100;
          if (pct < 0.5) return null;
          return (
            <div
              key={i}
              title={`${s.label}: ${s.count} (${pct.toFixed(0)}%)`}
              className="h-full"
              style={{ width: `${pct}%`, background: s.color }}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[9px] mt-0.5">
        {segments.map((s, i) => {
          if (s.count === 0) return null;
          return (
            <span key={i} className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: s.color }} />
              <span className="text-gray-400">{s.label}</span>
              <span className="tabular-nums text-gray-300">{s.count}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
};

// ============================================================================
// Speed card (좌하단) — Gauge + (Histogram + JobStateBar 위아래 절반)
// ============================================================================

const SpeedCard: React.FC<{ fab: FabStats; nominalMax: number }> = ({ fab, nominalMax }) => {
  return (
    <div className={panelCardVariants({ variant: "default", padding: "sm" }) + " flex flex-col flex-1 min-h-0"}>
      <div className="shrink-0 mb-1">
        <SpeedGauge avg={fab.avgSpeed} max={fab.maxSpeed} nominalMax={nominalMax} />
      </div>
      <div className="flex-1 min-h-0 grid grid-rows-2 gap-1.5 border-t border-gray-700/50 pt-1.5">
        <div className="min-h-0">
          <SpeedHistogram fab={fab} />
        </div>
        <div className="min-h-0 border-t border-gray-700/50 pt-1.5">
          <JobStateBar fab={fab} />
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// Distribution Tab — lifecycle bar + 좌측 KPI + 우측 timing histogram
// ============================================================================

const DistributionTab: React.FC<{ fab: FabStats; fabIndex: number }> = ({ fab }) => {
  const baseLinearMaxSpeed = useFabConfigStore((s) => s.baseConfig.movement.linear.maxSpeed);

  return (
    <div className="h-full flex flex-col gap-2 overflow-auto vps-scrollbar">
      <OrderLifecycleBar fabId={fab.fabId} />

      <div className="flex-1 min-h-0 grid grid-cols-[1fr_2fr] gap-2">
        {/* 좌측: Throughput + Speed (gauge + histogram) — 콘텐츠 위에서 쌓이고 아래는 빈 영역 */}
        <div className="flex flex-col gap-2 min-h-0">
          <ThroughputCard fabId={fab.fabId} />
          <SpeedCard fab={fab} nominalMax={baseLinearMaxSpeed} />
        </div>

        {/* 우측: Timing histogram (Lead/Waiting/Delivery — lifecycle bar 클릭으로 전환) */}
        <div className={panelCardVariants({ variant: "default", padding: "sm" }) + " min-h-0"}>
          <TimingHistogram fabId={fab.fabId} />
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// Main: RankingDetail
// ============================================================================

export const RankingDetail: React.FC<{ fabStatsList: FabStats[] }> = ({ fabStatsList }) => {
  const selectedFabId = useFabStatsUIStore((s) => s.selectedFabId);
  const detailTab = useFabStatsUIStore((s) => s.detailTab);
  const setDetailTab = useFabStatsUIStore((s) => s.setDetailTab);

  const globalRouting = useFabConfigStore((s) => s.routingConfig);
  const fabOverrides = useFabConfigStore((s) => s.fabOverrides);

  const selected = useMemo(() => {
    if (!selectedFabId) return null;
    const idx = fabStatsList.findIndex((f) => f.fabId === selectedFabId);
    if (idx < 0) return null;
    return { fab: fabStatsList[idx], fabIndex: idx };
  }, [fabStatsList, selectedFabId]);

  if (!selected) {
    return (
      <div className="h-full flex items-center justify-center text-[12px] text-gray-500">
        Select a fab from the list.
      </div>
    );
  }

  const { fab, fabIndex } = selected;
  const ovr = fabOverrides[fabIndex];
  const strategy = ovr?.routing?.strategy ?? globalRouting.strategy;
  const bprAlpha = ovr?.routing?.bprAlpha ?? globalRouting.bprAlpha;
  const bprBeta = ovr?.routing?.bprBeta ?? globalRouting.bprBeta;
  const ewmaAlpha = ovr?.routing?.ewmaAlpha ?? globalRouting.ewmaAlpha;
  let strategyText = ROUTING_LABEL[strategy] ?? strategy;
  if (strategy === "BPR") strategyText = `BPR α=${bprAlpha} β=${bprBeta}`;
  else if (strategy === "EWMA") strategyText = `EWMA α=${ewmaAlpha}`;

  return (
    <div className="h-full min-h-0 flex flex-col p-2 gap-2 overflow-hidden">
      {/* Header */}
      <div className="shrink-0 flex items-baseline gap-2 px-1 pb-1 border-b border-gray-700/50">
        <span className="text-base font-bold text-accent-orange">{fab.fabId}</span>
        <span className="text-xs font-semibold text-purple-300 truncate">{strategyText}</span>
        <span className="text-[10px] text-gray-500 ml-auto shrink-0">{fab.vehicleCount} vehicles</span>
      </div>

      {/* Detail 내부 탭 */}
      <div className="shrink-0 flex border-b border-gray-700/50 px-1">
        {DETAIL_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setDetailTab(t.key)}
            className={`px-3 py-1 text-[11px] font-medium border-b-2 transition-colors ${
              detailTab === t.key
                ? "border-accent-cyan text-accent-cyan"
                : "border-transparent text-gray-500 hover:text-gray-300"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content — 각 탭이 독립 스크롤 */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {detailTab === "distribution" && <DistributionTab fab={fab} fabIndex={fabIndex} />}
        {detailTab === "parameters" && <ParametersTab fabIndex={fabIndex} />}
      </div>
    </div>
  );
};
