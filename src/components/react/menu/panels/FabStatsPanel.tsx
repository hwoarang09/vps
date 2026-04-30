import React, { useState, useEffect, useRef, useCallback } from "react";
import { useShmSimulatorStore } from "@/store/vehicle/shmMode/shmSimulatorStore";
import {
  VEHICLE_DATA_SIZE,
  MovementData,
  LogicData,
  SensorData,
  StopReason,
  JobState,
  TrafficState,
  HitZone,
} from "@/common/vehicle/initialize/constants";
import {
  BarChart, Bar, Cell, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer,
  LineChart, Line,
} from "recharts";
import FloatingPanel from "../shared/FloatingPanel";
import { panelCardVariants, panelTextVariants } from "../shared/panelStyles";
import { useOrderStatsStore } from "@/store/simulation/orderStatsStore";
import { useFabConfigStore } from "@/store/simulation/fabConfigStore";

// ============================================================================
// Types
// ============================================================================

interface FabStats {
  fabId: string;
  vehicleCount: number;
  avgSpeed: number;
  maxSpeed: number;
  minSpeed: number;
  movingCount: number;
  stoppedCount: number;
  pausedCount: number;
  jobIdle: number;
  jobMoveToLoad: number;
  jobLoading: number;
  jobMoveToUnload: number;
  jobUnloading: number;
  jobError: number;
  jobInitializing: number;
  trafficFree: number;
  trafficWaiting: number;
  trafficAcquired: number;
  stopLocked: number;
  stopSensored: number;
  stopIdle: number;
  stopPathBlocked: number;
  stopDestReached: number;
  stopLoadOnOff: number;
  sensorCollisionCount: number;
  avgPathRemaining: number;
  maxPathRemaining: number;
}

interface HistoryPoint {
  t: number; // seconds since start
  [key: string]: number; // fabId -> value
}

// ============================================================================
// Compute
// ============================================================================

function computeFabStats(
  fabId: string,
  fullData: Float32Array,
  workerStartOffset: number,
  vehicleCount: number,
): FabStats {
  const startIdx = workerStartOffset / (VEHICLE_DATA_SIZE * Float32Array.BYTES_PER_ELEMENT);

  const stats: FabStats = {
    fabId, vehicleCount,
    avgSpeed: 0, maxSpeed: 0, minSpeed: Infinity,
    movingCount: 0, stoppedCount: 0, pausedCount: 0,
    jobIdle: 0, jobMoveToLoad: 0, jobLoading: 0,
    jobMoveToUnload: 0, jobUnloading: 0, jobError: 0, jobInitializing: 0,
    trafficFree: 0, trafficWaiting: 0, trafficAcquired: 0,
    stopLocked: 0, stopSensored: 0, stopIdle: 0,
    stopPathBlocked: 0, stopDestReached: 0, stopLoadOnOff: 0,
    sensorCollisionCount: 0,
    avgPathRemaining: 0, maxPathRemaining: 0,
  };

  if (vehicleCount === 0) return stats;

  let totalSpeed = 0;
  let totalPath = 0;

  for (let i = 0; i < vehicleCount; i++) {
    const ptr = (startIdx + i) * VEHICLE_DATA_SIZE;

    const velocity = fullData[ptr + MovementData.VELOCITY];
    totalSpeed += velocity;
    if (velocity > stats.maxSpeed) stats.maxSpeed = velocity;
    if (velocity >= 0.01 && velocity < stats.minSpeed) stats.minSpeed = velocity;

    const ms = fullData[ptr + MovementData.MOVING_STATUS];
    if (ms === 0) stats.stoppedCount++;
    else if (ms === 1) stats.movingCount++;
    else if (ms === 2) stats.pausedCount++;

    const js = fullData[ptr + LogicData.JOB_STATE];
    if (js === JobState.IDLE) stats.jobIdle++;
    else if (js === JobState.MOVE_TO_LOAD) stats.jobMoveToLoad++;
    else if (js === JobState.LOADING) stats.jobLoading++;
    else if (js === JobState.MOVE_TO_UNLOAD) stats.jobMoveToUnload++;
    else if (js === JobState.UNLOADING) stats.jobUnloading++;
    else if (js === JobState.ERROR) stats.jobError++;
    else if (js === JobState.INITIALIZING) stats.jobInitializing++;

    const ts = fullData[ptr + LogicData.TRAFFIC_STATE];
    if (ts === TrafficState.FREE) stats.trafficFree++;
    else if (ts === TrafficState.WAITING) stats.trafficWaiting++;
    else if (ts === TrafficState.ACQUIRED) stats.trafficAcquired++;

    const sr = fullData[ptr + LogicData.STOP_REASON];
    if (sr & StopReason.LOCKED) stats.stopLocked++;
    if (sr & StopReason.SENSORED) stats.stopSensored++;
    if (sr & StopReason.IDLE) stats.stopIdle++;
    if (sr & StopReason.PATH_BLOCKED) stats.stopPathBlocked++;
    if (sr & StopReason.DESTINATION_REACHED) stats.stopDestReached++;
    if ((sr & StopReason.LOAD_ON) || (sr & StopReason.LOAD_OFF)) stats.stopLoadOnOff++;

    const hitZone = fullData[ptr + SensorData.HIT_ZONE];
    if (hitZone !== HitZone.NONE) stats.sensorCollisionCount++;

    const pathRem = fullData[ptr + LogicData.PATH_REMAINING];
    totalPath += pathRem;
    if (pathRem > stats.maxPathRemaining) stats.maxPathRemaining = pathRem;
  }

  stats.avgSpeed = totalSpeed / vehicleCount;
  stats.avgPathRemaining = totalPath / vehicleCount;
  if (stats.minSpeed === Infinity) stats.minSpeed = 0;

  return stats;
}

// ============================================================================
// Sub-components (Card view)
// ============================================================================

const Stat: React.FC<{ label: string; value: string | number; color?: string }> = ({
  label, value, color = "text-gray-300",
}) => (
  <div className="flex justify-between">
    <span className="text-gray-500 text-[11px]">{label}</span>
    <span className={`font-mono text-[11px] ${color}`}>{value}</span>
  </div>
);

const RatioBar: React.FC<{ ratio: number; color: string; label?: string }> = ({ ratio, color, label }) => (
  <div className="flex items-center gap-1.5">
    {label && <span className="text-[10px] text-gray-500 w-14 shrink-0">{label}</span>}
    <div className="flex-1 h-1.5 bg-panel-bg-solid rounded-full overflow-hidden">
      <div className={`h-full ${color} rounded-full transition-all duration-300`}
        style={{ width: `${Math.min(100, ratio * 100)}%` }} />
    </div>
    <span className="text-[10px] text-gray-500 w-8 text-right">{(ratio * 100).toFixed(0)}%</span>
  </div>
);

const DistributionBar: React.FC<{ items: { count: number; color: string; label: string }[]; total: number }> = ({ items, total }) => {
  if (total === 0) return null;
  return (
    <div>
      <div className="flex h-2.5 rounded-full overflow-hidden bg-panel-bg-solid">
        {items.map((item, i) => {
          const pct = (item.count / total) * 100;
          if (pct < 0.5) return null;
          return (
            <div key={i} className={`${item.color} transition-all duration-300`}
              style={{ width: `${pct}%` }}
              title={`${item.label}: ${item.count} (${pct.toFixed(0)}%)`} />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
        {items.filter(it => it.count > 0).map((item, i) => (
          <span key={i} className="text-[10px] text-gray-500">
            <span className={`inline-block w-1.5 h-1.5 rounded-full ${item.color} mr-0.5`} />
            {item.label} {item.count}
          </span>
        ))}
      </div>
    </div>
  );
};

// ============================================================================
// Fab Card
// ============================================================================

const ROUTING_LABEL: Record<string, string> = { DISTANCE: "Distance", BPR: "BPR", EWMA: "EWMA" };
const MODE_LABEL: Record<string, string> = {
  SIMPLE_LOOP: "Simple Loop", LOOP: "Loop", RANDOM: "Random",
  MQTT_CONTROL: "MQTT", AUTO_ROUTE: "Auto Route",
};

const FabCard: React.FC<{ fab: FabStats }> = ({ fab }) => {
  const n = fab.vehicleCount;
  const orderStats = useOrderStatsStore((s) => s.fabStats[fab.fabId]);
  const routingConfig = useFabConfigStore((s) => s.routingConfig);
  const transferModeConfig = useFabConfigStore((s) => s.transferModeConfig);
  const transferRateConfig = useFabConfigStore((s) => s.transferRateConfig);
  if (n === 0) return null;

  return (
    <div className={panelCardVariants({ variant: "default", padding: "sm" })}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold text-accent-orange">{fab.fabId}</span>
        <span className="text-[10px] text-gray-500">{n} vehicles</span>
      </div>

      {/* Transfer KPI */}
      {orderStats && orderStats.completed > 0 && (
        <div className="mb-2 p-1.5 rounded bg-panel-bg-solid/50 border border-green-900/30">
          <span className="text-[10px] text-green-400 font-medium">Transfer KPI</span>
          <div className="grid grid-cols-2 gap-x-3 mt-1">
            <Stat label="Completed" value={orderStats.completed} color="text-green-300" />
            <Stat label="Throughput" value={`${orderStats.throughputPerHour.toFixed(0)}/hr`} color="text-green-300 font-bold" />
          </div>
          <div className="grid grid-cols-3 gap-x-3 mt-1">
            <Stat label="LT p50" value={`${orderStats.leadTimeP50.toFixed(1)}s`} color="text-accent-cyan" />
            <Stat label="LT p95" value={`${orderStats.leadTimeP95.toFixed(1)}s`} color="text-amber-400" />
            <Stat label="LT mean" value={`${orderStats.leadTimeMean.toFixed(1)}s`} color="text-gray-300" />
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-x-3 mb-2">
        <Stat label="Avg" value={`${fab.avgSpeed.toFixed(2)} m/s`} color="text-accent-cyan font-bold" />
        <Stat label="Max" value={`${fab.maxSpeed.toFixed(2)}`} color="text-white" />
        <Stat label="Min" value={`${fab.minSpeed.toFixed(2)}`} color="text-gray-400" />
      </div>

      <RatioBar ratio={fab.avgSpeed / Math.max(fab.maxSpeed, 1)} color="bg-accent-cyan" label="Speed" />

      <div className="mt-2">
        <DistributionBar
          total={n}
          items={[
            { count: fab.movingCount, color: "bg-accent-green", label: "Moving" },
            { count: fab.stoppedCount, color: "bg-amber-500", label: "Stopped" },
            { count: fab.pausedCount, color: "bg-gray-500", label: "Paused" },
          ]}
        />
      </div>

      <div className="mt-2">
        <span className="text-[10px] text-gray-600 font-medium">Job State</span>
        <DistributionBar
          total={n}
          items={[
            { count: fab.jobIdle, color: "bg-gray-500", label: "Idle" },
            { count: fab.jobMoveToLoad, color: "bg-blue-500", label: "→Load" },
            { count: fab.jobLoading, color: "bg-accent-cyan", label: "Loading" },
            { count: fab.jobMoveToUnload, color: "bg-accent-purple", label: "→Unload" },
            { count: fab.jobUnloading, color: "bg-accent-orange", label: "Unloading" },
            { count: fab.jobError, color: "bg-red-500", label: "Error" },
            { count: fab.jobInitializing, color: "bg-gray-700", label: "Init" },
          ]}
        />
      </div>

      <div className="mt-2 p-1.5 rounded bg-panel-bg-solid/50 border border-purple-900/30">
        <span className="text-[10px] text-purple-400 font-medium">Routing & Mode</span>
        <div className="grid grid-cols-2 gap-x-3 mt-1">
          <Stat label="Mode" value={MODE_LABEL[transferModeConfig] ?? transferModeConfig} color="text-cyan-300" />
          <Stat label="Rate" value={
            transferRateConfig.mode === "utilization"
              ? `${transferRateConfig.utilizationPercent}% util`
              : `${transferRateConfig.throughputPerHour}/hr`
          } color="text-cyan-300" />
          <Stat label="Routing" value={ROUTING_LABEL[routingConfig.strategy] ?? routingConfig.strategy} color="text-purple-300" />
          {routingConfig.strategy === "BPR" && (
            <Stat label="BPR" value={`α${routingConfig.bprAlpha} β${routingConfig.bprBeta}`} color="text-purple-300" />
          )}
          {routingConfig.strategy === "EWMA" && (
            <Stat label="EWMA" value={`α${routingConfig.ewmaAlpha}`} color="text-purple-300" />
          )}
          {routingConfig.rerouteInterval > 0 && (
            <Stat label="Reroute" value={`${routingConfig.rerouteInterval} edges`} color="text-gray-400" />
          )}
        </div>
      </div>

      {fab.stoppedCount > 0 && (
        <div className="mt-2 grid grid-cols-3 gap-x-3 gap-y-0.5">
          <Stat label="Locked" value={fab.stopLocked} color={fab.stopLocked > 0 ? "text-amber-400" : "text-gray-600"} />
          <Stat label="Sensor" value={fab.stopSensored} color={fab.stopSensored > 0 ? "text-red-400" : "text-gray-600"} />
          <Stat label="Idle" value={fab.stopIdle} color="text-gray-500" />
          <Stat label="PathBlk" value={fab.stopPathBlocked} color={fab.stopPathBlocked > 0 ? "text-red-400" : "text-gray-600"} />
          <Stat label="DestArr" value={fab.stopDestReached} color="text-gray-500" />
          <Stat label="Load" value={fab.stopLoadOnOff} color={fab.stopLoadOnOff > 0 ? "text-accent-cyan" : "text-gray-600"} />
        </div>
      )}

      <div className="mt-2 grid grid-cols-2 gap-x-3">
        <Stat label="Collision" value={fab.sensorCollisionCount} color={fab.sensorCollisionCount > 0 ? "text-red-400" : "text-gray-600"} />
        <Stat label="Avg Path" value={`${fab.avgPathRemaining.toFixed(0)}m`} color="text-gray-300" />
      </div>
    </div>
  );
};

// ============================================================================
// Compare Tab (Bar Chart)
// ============================================================================

const COMPARE_METRICS = [
  { key: "avgSpeed", label: "Avg Speed", unit: "m/s" },
  { key: "movingRate", label: "Moving %", unit: "%" },
  { key: "stoppedRate", label: "Stopped %", unit: "%" },
  { key: "waitingRate", label: "Waiting %", unit: "%" },
  { key: "stopLocked", label: "Locked", unit: "" },
  { key: "stopSensored", label: "Sensor Stop", unit: "" },
  { key: "sensorCollisionCount", label: "Collision", unit: "" },
  { key: "avgPathRemaining", label: "Avg Path", unit: "m" },
] as const;

type MetricKey = typeof COMPARE_METRICS[number]["key"];

const FAB_COLORS = [
  "#06b6d4", "#f59e0b", "#8b5cf6", "#22c55e", "#ef4444",
  "#ec4899", "#14b8a6", "#f97316", "#6366f1", "#84cc16",
];

function buildCompareData(fabStatsList: FabStats[]): Record<string, number | string>[] {
  return fabStatsList.map((fab, i) => {
    const n = fab.vehicleCount || 1;
    return {
      name: fab.fabId,
      avgSpeed: +fab.avgSpeed.toFixed(2),
      movingRate: +((fab.movingCount / n) * 100).toFixed(1),
      stoppedRate: +((fab.stoppedCount / n) * 100).toFixed(1),
      waitingRate: +((fab.trafficWaiting / n) * 100).toFixed(1),
      stopLocked: fab.stopLocked,
      stopSensored: fab.stopSensored,
      sensorCollisionCount: fab.sensorCollisionCount,
      avgPathRemaining: +fab.avgPathRemaining.toFixed(0),
      _color: FAB_COLORS[i % FAB_COLORS.length],
    };
  });
}

const CompareTab: React.FC<{ fabStatsList: FabStats[] }> = ({ fabStatsList }) => {
  const [metric, setMetric] = useState<MetricKey>("avgSpeed");
  const data = buildCompareData(fabStatsList);
  const metricInfo = COMPARE_METRICS.find(m => m.key === metric)!;

  return (
    <div className="h-full flex flex-col">
      {/* Metric selector */}
      <div className="flex flex-wrap gap-1 mb-3 shrink-0">
        {COMPARE_METRICS.map((m) => (
          <button key={m.key}
            onClick={() => setMetric(m.key)}
            className={`px-2 py-1 rounded text-[11px] border transition-all ${
              metric === m.key
                ? "bg-accent-cyan text-white border-accent-cyan font-bold"
                : "bg-panel-bg-solid text-gray-500 border-panel-border hover:text-gray-300"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Chart */}
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
            <XAxis dataKey="name" tick={{ fill: "#9ca3af", fontSize: 11 }} />
            <YAxis tick={{ fill: "#9ca3af", fontSize: 11 }} width={45}
              tickFormatter={(v) => metricInfo.unit === "%" ? `${v}%` : String(v)} />
            <Tooltip
              contentStyle={{ background: "#1f2937", border: "1px solid #374151", borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: "#fff", fontWeight: "bold" }}
              formatter={(value) => [`${value}${metricInfo.unit ? ` ${metricInfo.unit}` : ""}`, metricInfo.label]}
            />
            <Bar dataKey={metric} radius={[4, 4, 0, 0]} maxBarSize={60}>
              {data.map((entry, i) => (
                <Cell key={i} fill={entry._color as string} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

// ============================================================================
// Trend Tab (Line Chart with history buffer)
// ============================================================================

const TREND_METRICS = [
  { key: "avgSpeed", label: "Avg Speed", unit: "m/s" },
  { key: "movingRate", label: "Moving %", unit: "%" },
  { key: "stoppedRate", label: "Stopped %", unit: "%" },
  { key: "waitingRate", label: "Waiting %", unit: "%" },
  { key: "collisionCount", label: "Collision", unit: "" },
] as const;

type TrendMetricKey = typeof TREND_METRICS[number]["key"];

const MAX_HISTORY = 120; // 120 * 500ms = 60 seconds

const TrendTab: React.FC<{
  fabStatsList: FabStats[];
  history: React.MutableRefObject<Map<TrendMetricKey, HistoryPoint[]>>;
  elapsed: number;
}> = ({ fabStatsList, history, elapsed }) => {
  const [metric, setMetric] = useState<TrendMetricKey>("avgSpeed");
  const metricInfo = TREND_METRICS.find(m => m.key === metric)!;
  const data = history.current.get(metric) ?? [];

  return (
    <div className="h-full flex flex-col">
      {/* Metric selector */}
      <div className="flex flex-wrap gap-1 mb-3 shrink-0">
        {TREND_METRICS.map((m) => (
          <button key={m.key}
            onClick={() => setMetric(m.key)}
            className={`px-2 py-1 rounded text-[11px] border transition-all ${
              metric === m.key
                ? "bg-accent-purple text-white border-accent-purple font-bold"
                : "bg-panel-bg-solid text-gray-500 border-panel-border hover:text-gray-300"
            }`}
          >
            {m.label}
          </button>
        ))}
        <span className="text-[10px] text-gray-600 self-center ml-2">
          {elapsed.toFixed(0)}s / {(MAX_HISTORY * 0.5).toFixed(0)}s window
        </span>
      </div>

      {/* Chart */}
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
            <XAxis dataKey="t" tick={{ fill: "#9ca3af", fontSize: 10 }}
              tickFormatter={(v) => `${v}s`} />
            <YAxis tick={{ fill: "#9ca3af", fontSize: 11 }} width={45}
              tickFormatter={(v) => metricInfo.unit === "%" ? `${v}%` : String(v)} />
            <Tooltip
              contentStyle={{ background: "#1f2937", border: "1px solid #374151", borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: "#fff", fontWeight: "bold" }}
              labelFormatter={(v) => `${v}s`}
              formatter={(value, name) => [`${(+(value ?? 0)).toFixed(2)}${metricInfo.unit ? ` ${metricInfo.unit}` : ""}`, name]}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {fabStatsList.map((fab, i) => (
              <Line key={fab.fabId} type="monotone" dataKey={fab.fabId}
                stroke={FAB_COLORS[i % FAB_COLORS.length]}
                strokeWidth={2} dot={false} isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

// ============================================================================
// Main Panel
// ============================================================================

type TabKey = "cards" | "compare" | "trend";

const TABS: { key: TabKey; label: string }[] = [
  { key: "cards", label: "Cards" },
  { key: "compare", label: "Compare" },
  { key: "trend", label: "Trend" },
];

function getCenterDefaults() {
  const w = Math.round(window.innerWidth * 0.65);
  const h = Math.round(window.innerHeight * 0.65);
  const x = Math.round((window.innerWidth - w) / 2);
  const y = Math.round((window.innerHeight - h) / 2);
  return { x, y, w, h };
}

const FabStatsPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const controller = useShmSimulatorStore((s) => s.controller);
  const isRunning = useShmSimulatorStore((s) => s.isRunning);
  const [fabStatsList, setFabStatsList] = useState<FabStats[]>([]);
  const [tab, setTab] = useState<TabKey>("cards");
  const [defaults] = useState(getCenterDefaults);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(Date.now());
  const [elapsed, setElapsed] = useState(0);

  // History buffer for trend
  const historyRef = useRef<Map<TrendMetricKey, HistoryPoint[]>>(new Map(
    TREND_METRICS.map(m => [m.key, []])
  ));

  const pushHistory = useCallback((statsList: FabStats[]) => {
    const t = +((Date.now() - startTimeRef.current) / 1000).toFixed(1);
    setElapsed(t);

    for (const m of TREND_METRICS) {
      const buf = historyRef.current.get(m.key)!;
      const point: HistoryPoint = { t };
      for (const fab of statsList) {
        const n = fab.vehicleCount || 1;
        if (m.key === "avgSpeed") point[fab.fabId] = +fab.avgSpeed.toFixed(2);
        else if (m.key === "movingRate") point[fab.fabId] = +((fab.movingCount / n) * 100).toFixed(1);
        else if (m.key === "stoppedRate") point[fab.fabId] = +((fab.stoppedCount / n) * 100).toFixed(1);
        else if (m.key === "waitingRate") point[fab.fabId] = +((fab.trafficWaiting / n) * 100).toFixed(1);
        else if (m.key === "collisionCount") point[fab.fabId] = fab.sensorCollisionCount;
      }
      buf.push(point);
      if (buf.length > MAX_HISTORY) buf.shift();
    }
  }, []);

  useEffect(() => {
    startTimeRef.current = Date.now();
    // Clear history on mount
    for (const m of TREND_METRICS) {
      historyRef.current.set(m.key, []);
    }
  }, []);

  useEffect(() => {
    const update = () => {
      if (!controller) { setFabStatsList([]); return; }

      const fullData = controller.getVehicleFullData();
      const workerLayout = controller.getWorkerLayout();
      const fabIds = controller.getFabIds();

      if (!fullData || !workerLayout) { setFabStatsList([]); return; }

      const stats: FabStats[] = [];
      for (const fabId of fabIds) {
        const assignment = workerLayout.fabAssignments.get(fabId);
        if (!assignment) continue;
        const vehicleCount = controller.getActualNumVehicles(fabId);
        stats.push(computeFabStats(fabId, fullData, assignment.vehicleRegion.offset, vehicleCount));
      }
      setFabStatsList(stats);
      pushHistory(stats);
    };

    update();
    if (isRunning) {
      intervalRef.current = setInterval(update, 500);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [controller, isRunning, pushHistory]);

  const total = fabStatsList.reduce(
    (acc, f) => ({
      vehicles: acc.vehicles + f.vehicleCount,
      moving: acc.moving + f.movingCount,
      stopped: acc.stopped + f.stoppedCount,
    }),
    { vehicles: 0, moving: 0, stopped: 0 },
  );

  const tabBar = (
    <div className="flex border-b border-gray-700 bg-gray-800/40 px-4">
      {TABS.map(t => (
        <button
          key={t.key}
          onClick={() => setTab(t.key)}
          className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${
            tab === t.key
              ? "border-accent-cyan text-accent-cyan"
              : "border-transparent text-gray-500 hover:text-gray-300"
          }`}
        >{t.label}</button>
      ))}
    </div>
  );

  return (
    <FloatingPanel
      title="Fab Stats"
      onClose={onClose}
      dragResizeOpts={{
        defaultX: defaults.x, defaultY: defaults.y,
        defaultW: defaults.w, defaultH: defaults.h,
        minW: 500, minH: 300,
      }}
      bgClass="bg-gray-900/80"
      headerExtra={
        fabStatsList.length > 0 ? (
          <div className="flex items-center gap-3 text-[11px] text-gray-400">
            <span>Total <span className="text-white font-bold">{total.vehicles}</span></span>
            <span>Moving <span className="text-accent-green font-bold">{total.moving}</span></span>
            <span>Stopped <span className="text-amber-400 font-bold">{total.stopped}</span></span>
            <button
              onClick={() => {
                controller?.resetOrderStats();
                useOrderStatsStore.getState().resetAll();
              }}
              className="px-2 py-0.5 rounded text-[10px] text-gray-400 border border-gray-600 hover:text-white hover:border-gray-400 transition-colors"
            >
              Reset KPI
            </button>
          </div>
        ) : undefined
      }
      subHeader={tabBar}
    >
      {fabStatsList.length === 0 ? (
        <div className={panelTextVariants({ variant: "muted", size: "sm" })}>
          No simulation running.
        </div>
      ) : (
        <>
          {tab === "cards" && (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
              {fabStatsList.map((fab) => (
                <FabCard key={fab.fabId} fab={fab} />
              ))}
            </div>
          )}
          {tab === "compare" && <CompareTab fabStatsList={fabStatsList} />}
          {tab === "trend" && (
            <TrendTab fabStatsList={fabStatsList} history={historyRef} elapsed={elapsed} />
          )}
        </>
      )}
    </FloatingPanel>
  );
};

export default FabStatsPanel;
