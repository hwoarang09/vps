import React from "react";
import {
  RadialBarChart, RadialBar, PieChart, Pie, Cell, ResponsiveContainer, PolarAngleAxis,
} from "recharts";
import { useOrderStatsStore } from "@/store/simulation/orderStatsStore";
import { useFabConfigStore } from "@/store/simulation/fabConfigStore";
import { panelCardVariants } from "../../shared/panelStyles";
import type { FabStats } from "../FabStatsPanel";
import {
  VEHICLE_JOB_STATE_COLORS,
  MOVEMENT_STATUS_COLORS,
} from "@/config/colors";

const ROUTING_LABEL: Record<string, string> = { DISTANCE: "Distance", BPR: "BPR", EWMA: "EWMA" };
const IDLE_POLICY_LABEL: Record<string, string> = {
  RANDOM_WALK: "Random Walk",
  ARRIVAL_BAY_LOOP: "Bay Loop",
  BALANCED_BAY_LOOP: "Balanced Loop",
};

// ============================================================================
// Speed Gauge — 반원 게이지 (스피드미터 모양)
// ============================================================================

export const SpeedGauge: React.FC<{ avg: number; max: number; nominalMax?: number }> = ({ avg, max, nominalMax }) => {
  // 게이지의 최대 기준: nominalMax (예: linearMaxSpeed) 가 있으면 그걸, 없으면 관측 max
  const ceil = nominalMax ?? Math.max(max, 1);
  const ratio = Math.min(1, Math.max(0, avg / ceil));
  const pct = ratio * 100;

  // 색상: 빠를수록 청록 → 보라
  const color = ratio > 0.75 ? "#a78bfa" : ratio > 0.4 ? "#06b6d4" : "#f59e0b";

  const data = [{ name: "speed", value: pct, fill: color }];

  return (
    <div className="relative w-full" style={{ aspectRatio: "1.6 / 1" }}>
      <ResponsiveContainer>
        <RadialBarChart
          innerRadius="68%"
          outerRadius="98%"
          data={data}
          startAngle={210}
          endAngle={-30}
          barSize={14}
        >
          <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
          <RadialBar
            dataKey="value"
            cornerRadius={8}
            background={{ fill: "#1f2937" }}
            isAnimationActive={false}
          />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none pb-2">
        <span className="text-[9px] text-gray-500 uppercase tracking-wider">Speed</span>
        <span className="text-2xl font-bold tabular-nums leading-none mt-0.5" style={{ color }}>
          {avg.toFixed(2)}
        </span>
        <span className="text-[9px] text-gray-500 mt-0.5">
          m/s · max {ceil.toFixed(1)}
        </span>
      </div>
    </div>
  );
};

// ============================================================================
// Donut chart — 가운데 큰 숫자 + slice legend
// ============================================================================

interface DonutSlice { value: number; color: string; label: string; key: string }

const Donut: React.FC<{
  title: string;
  centerValue: string;
  centerLabel: string;
  slices: DonutSlice[];
}> = ({ title, centerValue, centerLabel, slices }) => {
  const total = slices.reduce((s, d) => s + d.value, 0);
  const data = total > 0 ? slices : [{ value: 1, color: "#374151", label: "—", key: "_empty" }];

  return (
    <div className="flex flex-col">
      <span className="text-[9px] text-gray-500 uppercase tracking-wider text-center mb-0.5">
        {title}
      </span>
      <div className="relative w-full" style={{ aspectRatio: "1.4 / 1" }}>
        <ResponsiveContainer>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius="62%"
              outerRadius="92%"
              paddingAngle={total > 0 ? 1.5 : 0}
              dataKey="value"
              stroke="none"
              isAnimationActive={false}
            >
              {data.map((d) => <Cell key={d.key} fill={d.color} />)}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-xl font-bold text-white tabular-nums leading-none">{centerValue}</span>
          <span className="text-[9px] text-gray-500 mt-0.5">{centerLabel}</span>
        </div>
      </div>
      {/* Legend */}
      <div className="mt-1 flex flex-col gap-0.5 text-[9px]">
        {slices.filter(d => d.value > 0).map((d) => (
          <div key={d.key} className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: d.color }} />
            <span className="text-gray-400 truncate flex-1">{d.label}</span>
            <span className="text-gray-500 tabular-nums">{d.value}</span>
            <span className="text-gray-600 tabular-nums w-7 text-right">
              {((d.value / total) * 100).toFixed(0)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

// ============================================================================
// Main
// ============================================================================

const Stat: React.FC<{ label: string; value: string | number; color?: string }> = ({
  label, value, color = "text-gray-300",
}) => (
  <div className="flex justify-between">
    <span className="text-gray-500 text-[10px]">{label}</span>
    <span className={`font-mono text-[11px] ${color}`}>{value}</span>
  </div>
);

export const FabDetailCard: React.FC<{ fab: FabStats; fabIndex: number }> = ({ fab, fabIndex }) => {
  const orderStats = useOrderStatsStore((s) => s.fabStats[fab.fabId]);
  const globalRouting = useFabConfigStore((s) => s.routingConfig);
  const globalMode = useFabConfigStore((s) => s.transferModeConfig);
  const globalRate = useFabConfigStore((s) => s.transferRateConfig);
  const fabOverrides = useFabConfigStore((s) => s.fabOverrides);
  const baseLinearMaxSpeed = useFabConfigStore((s) => s.baseConfig.movement.linear.maxSpeed);

  const ovr = fabOverrides[fabIndex];
  const routingConfig = {
    strategy: ovr?.routing?.strategy ?? globalRouting.strategy,
    bprAlpha: ovr?.routing?.bprAlpha ?? globalRouting.bprAlpha,
    bprBeta: ovr?.routing?.bprBeta ?? globalRouting.bprBeta,
    ewmaAlpha: ovr?.routing?.ewmaAlpha ?? globalRouting.ewmaAlpha,
    rerouteInterval: ovr?.routing?.rerouteInterval ?? globalRouting.rerouteInterval,
  };
  const transferModeConfig = ovr?.transferMode ?? globalMode;
  const transferRateConfig = {
    mode: ovr?.transferRateConfig?.mode ?? globalRate.mode,
    utilizationPercent: ovr?.transferRateConfig?.utilizationPercent ?? globalRate.utilizationPercent,
    throughputPerHour: ovr?.transferRateConfig?.throughputPerHour ?? globalRate.throughputPerHour,
  };

  // Nominal max: fab override → base config 의 직선 최대 속도
  const nominalMaxSpeed = ovr?.movement?.linear?.maxSpeed ?? baseLinearMaxSpeed;

  let strategyText = ROUTING_LABEL[routingConfig.strategy] ?? routingConfig.strategy;
  if (routingConfig.strategy === "BPR") {
    strategyText = `BPR α=${routingConfig.bprAlpha} β=${routingConfig.bprBeta}`;
  } else if (routingConfig.strategy === "EWMA") {
    strategyText = `EWMA α=${routingConfig.ewmaAlpha}`;
  }

  const n = fab.vehicleCount;
  const movingPct = n > 0 ? ((fab.movingCount / n) * 100).toFixed(0) : "0";

  // Job state slices
  const jobSlices: DonutSlice[] = [
    { key: "moveToLoad", value: fab.jobMoveToLoad, color: VEHICLE_JOB_STATE_COLORS.MOVE_TO_LOAD, label: "→ Load" },
    { key: "loading", value: fab.jobLoading, color: VEHICLE_JOB_STATE_COLORS.LOADING, label: "Loading" },
    { key: "moveToUnload", value: fab.jobMoveToUnload, color: VEHICLE_JOB_STATE_COLORS.MOVE_TO_UNLOAD, label: "→ Unload" },
    { key: "unloading", value: fab.jobUnloading, color: VEHICLE_JOB_STATE_COLORS.UNLOADING, label: "Unloading" },
    { key: "idle", value: fab.jobIdle, color: "#6b7280", label: "Idle" },
    { key: "error", value: fab.jobError, color: VEHICLE_JOB_STATE_COLORS.ERROR, label: "Error" },
    { key: "init", value: fab.jobInitializing, color: VEHICLE_JOB_STATE_COLORS.INIT, label: "Init" },
  ];

  // Movement slices
  const moveSlices: DonutSlice[] = [
    { key: "moving", value: fab.movingCount, color: MOVEMENT_STATUS_COLORS.moving, label: "Moving" },
    { key: "stopped", value: fab.stoppedCount, color: MOVEMENT_STATUS_COLORS.stopped, label: "Stopped" },
    { key: "paused", value: fab.pausedCount, color: MOVEMENT_STATUS_COLORS.paused, label: "Paused" },
  ];

  return (
    <div className={panelCardVariants({ variant: "default", padding: "md" })}>
      {/* Header */}
      <div className="flex items-baseline gap-2 mb-2 pb-2 border-b border-gray-700/50">
        <span className="text-lg font-bold text-accent-orange">{fab.fabId}</span>
        <span className="text-xs font-semibold text-purple-300 truncate">{strategyText}</span>
        <span className="text-[10px] text-gray-500 ml-auto shrink-0">{n} vehicles</span>
      </div>

      {/* Throughput hero */}
      {orderStats && orderStats.completed > 0 ? (
        <div className="mb-3 pb-2 border-b border-gray-700/50">
          <div className="flex items-baseline gap-1">
            <span className="text-4xl font-bold text-green-300 leading-none tabular-nums">
              {orderStats.throughputPerHour.toFixed(0)}
            </span>
            <span className="text-xs text-gray-400">/hr</span>
            <span className="text-[10px] text-gray-500 ml-auto">{orderStats.completed} done</span>
          </div>
          <div className="grid grid-cols-3 gap-x-3 mt-1.5">
            <Stat label="LT p50" value={`${orderStats.leadTimeP50.toFixed(1)}s`} color="text-accent-cyan" />
            <Stat label="LT p95" value={`${orderStats.leadTimeP95.toFixed(1)}s`} color="text-amber-400" />
            <Stat label="LT mean" value={`${orderStats.leadTimeMean.toFixed(1)}s`} color="text-gray-300" />
          </div>
        </div>
      ) : (
        <div className="mb-3 pb-2 border-b border-gray-700/50">
          <span className="text-xs text-gray-500">Throughput —</span>
        </div>
      )}

      {/* Visual row: Speed Gauge + Movement Donut + Job State Donut */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <SpeedGauge avg={fab.avgSpeed} max={fab.maxSpeed} nominalMax={nominalMaxSpeed} />
        <Donut
          title="Movement"
          centerValue={`${movingPct}%`}
          centerLabel="moving"
          slices={moveSlices}
        />
        <Donut
          title="Job State"
          centerValue={String(n - fab.jobIdle - fab.jobInitializing)}
          centerLabel="active"
          slices={jobSlices}
        />
      </div>

      {/* Config row */}
      <div className="grid grid-cols-3 gap-x-3 mb-2 pb-2 border-b border-gray-700/30">
        <Stat label="Idle" value={IDLE_POLICY_LABEL[transferModeConfig.idlePolicy] ?? transferModeConfig.idlePolicy} color="text-cyan-300" />
        <Stat label="Rate" value={
          transferRateConfig.mode === "utilization"
            ? `${transferRateConfig.utilizationPercent}% util`
            : `${transferRateConfig.throughputPerHour}/hr`
        } color="text-cyan-300" />
        <Stat label="Reroute"
          value={routingConfig.rerouteInterval > 0 ? `${routingConfig.rerouteInterval} edges` : "off"}
          color="text-gray-400" />
      </div>

      {/* Stop reason — 정지가 있을 때만 */}
      {fab.stoppedCount > 0 && (
        <div className="mb-2">
          <div className="text-[10px] text-gray-600 font-medium mb-1">Stop Reasons</div>
          <div className="grid grid-cols-3 gap-x-3 gap-y-0.5">
            <Stat label="Locked" value={fab.stopLocked} color={fab.stopLocked > 0 ? "text-amber-400" : "text-gray-600"} />
            <Stat label="Sensor" value={fab.stopSensored} color={fab.stopSensored > 0 ? "text-red-400" : "text-gray-600"} />
            <Stat label="Idle" value={fab.stopIdle} color="text-gray-500" />
            <Stat label="PathBlk" value={fab.stopPathBlocked} color={fab.stopPathBlocked > 0 ? "text-red-400" : "text-gray-600"} />
            <Stat label="DestArr" value={fab.stopDestReached} color="text-gray-500" />
            <Stat label="Load" value={fab.stopLoadOnOff} color={fab.stopLoadOnOff > 0 ? "text-accent-cyan" : "text-gray-600"} />
          </div>
        </div>
      )}

      {/* Misc */}
      <div className="grid grid-cols-2 gap-x-3">
        <Stat
          label="Collision"
          value={fab.sensorCollisionCount}
          color={fab.sensorCollisionCount > 0 ? "text-red-400" : "text-gray-600"}
        />
        <Stat label="Avg Path" value={`${fab.avgPathRemaining.toFixed(0)}m`} color="text-gray-300" />
      </div>
    </div>
  );
};
