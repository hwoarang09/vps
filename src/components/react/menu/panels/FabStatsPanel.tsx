import React, { useState, useEffect, useRef } from "react";
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
import FloatingPanel from "../shared/FloatingPanel";
import { panelCardVariants, panelTextVariants } from "../shared/panelStyles";

// ============================================================================
// Types
// ============================================================================

interface FabStats {
  fabId: string;
  vehicleCount: number;
  // Speed
  avgSpeed: number;
  maxSpeed: number;
  minSpeed: number;   // 움직이는 차량 중 최소
  // Movement Status
  movingCount: number;
  stoppedCount: number;
  pausedCount: number;
  // Job State 분포
  jobIdle: number;
  jobMoveToLoad: number;
  jobLoading: number;
  jobMoveToUnload: number;
  jobUnloading: number;
  jobError: number;
  jobInitializing: number;
  // Traffic State 분포
  trafficFree: number;
  trafficWaiting: number;
  trafficAcquired: number;
  // Stop Reason 주요 항목
  stopLocked: number;
  stopSensored: number;
  stopIdle: number;
  stopPathBlocked: number;
  stopDestReached: number;
  stopLoadOnOff: number;
  // Sensor
  sensorCollisionCount: number;  // HIT_ZONE != NONE
  // Path
  avgPathRemaining: number;
  maxPathRemaining: number;
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

    // Speed
    const velocity = fullData[ptr + MovementData.VELOCITY];
    totalSpeed += velocity;
    if (velocity > stats.maxSpeed) stats.maxSpeed = velocity;
    if (velocity >= 0.01 && velocity < stats.minSpeed) stats.minSpeed = velocity;

    // Moving Status
    const ms = fullData[ptr + MovementData.MOVING_STATUS];
    if (ms === 0) stats.stoppedCount++;
    else if (ms === 1) stats.movingCount++;
    else if (ms === 2) stats.pausedCount++;

    // Job State
    const js = fullData[ptr + LogicData.JOB_STATE];
    if (js === JobState.IDLE) stats.jobIdle++;
    else if (js === JobState.MOVE_TO_LOAD) stats.jobMoveToLoad++;
    else if (js === JobState.LOADING) stats.jobLoading++;
    else if (js === JobState.MOVE_TO_UNLOAD) stats.jobMoveToUnload++;
    else if (js === JobState.UNLOADING) stats.jobUnloading++;
    else if (js === JobState.ERROR) stats.jobError++;
    else if (js === JobState.INITIALIZING) stats.jobInitializing++;

    // Traffic State
    const ts = fullData[ptr + LogicData.TRAFFIC_STATE];
    if (ts === TrafficState.FREE) stats.trafficFree++;
    else if (ts === TrafficState.WAITING) stats.trafficWaiting++;
    else if (ts === TrafficState.ACQUIRED) stats.trafficAcquired++;

    // Stop Reason (bitmask)
    const sr = fullData[ptr + LogicData.STOP_REASON];
    if (sr & StopReason.LOCKED) stats.stopLocked++;
    if (sr & StopReason.SENSORED) stats.stopSensored++;
    if (sr & StopReason.IDLE) stats.stopIdle++;
    if (sr & StopReason.PATH_BLOCKED) stats.stopPathBlocked++;
    if (sr & StopReason.DESTINATION_REACHED) stats.stopDestReached++;
    if ((sr & StopReason.LOAD_ON) || (sr & StopReason.LOAD_OFF)) stats.stopLoadOnOff++;

    // Sensor collision
    const hitZone = fullData[ptr + SensorData.HIT_ZONE];
    if (hitZone !== HitZone.NONE) stats.sensorCollisionCount++;

    // Path remaining
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
// Sub-components
// ============================================================================

/** 작은 수치 표시 */
const Stat: React.FC<{ label: string; value: string | number; color?: string }> = ({
  label, value, color = "text-gray-300",
}) => (
  <div className="flex justify-between">
    <span className="text-gray-500 text-[11px]">{label}</span>
    <span className={`font-mono text-[11px] ${color}`}>{value}</span>
  </div>
);

/** 비율 바 */
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

/** 가로 분포 바 */
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

const FabCard: React.FC<{ fab: FabStats }> = ({ fab }) => {
  const n = fab.vehicleCount;
  if (n === 0) return null;

  return (
    <div className={panelCardVariants({ variant: "default", padding: "sm" })}>
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold text-accent-orange">{fab.fabId}</span>
        <span className="text-[10px] text-gray-500">{n} vehicles</span>
      </div>

      {/* Speed */}
      <div className="grid grid-cols-3 gap-x-3 mb-2">
        <Stat label="Avg" value={`${fab.avgSpeed.toFixed(2)} m/s`} color="text-accent-cyan font-bold" />
        <Stat label="Max" value={`${fab.maxSpeed.toFixed(2)}`} color="text-white" />
        <Stat label="Min" value={`${fab.minSpeed.toFixed(2)}`} color="text-gray-400" />
      </div>

      {/* Speed bar */}
      <RatioBar ratio={fab.avgSpeed / Math.max(fab.maxSpeed, 1)} color="bg-accent-cyan" label="Speed" />

      {/* Moving / Stopped */}
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

      {/* Job State */}
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

      {/* Traffic State */}
      <div className="mt-2">
        <span className="text-[10px] text-gray-600 font-medium">Traffic</span>
        <DistributionBar
          total={n}
          items={[
            { count: fab.trafficFree, color: "bg-accent-green", label: "Free" },
            { count: fab.trafficWaiting, color: "bg-amber-500", label: "Waiting" },
            { count: fab.trafficAcquired, color: "bg-accent-cyan", label: "Acquired" },
          ]}
        />
      </div>

      {/* Stop Reasons */}
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

      {/* Sensor & Path */}
      <div className="mt-2 grid grid-cols-2 gap-x-3">
        <Stat label="Collision" value={fab.sensorCollisionCount} color={fab.sensorCollisionCount > 0 ? "text-red-400" : "text-gray-600"} />
        <Stat label="Avg Path" value={`${fab.avgPathRemaining.toFixed(0)}m`} color="text-gray-300" />
      </div>
    </div>
  );
};

// ============================================================================
// Main Panel
// ============================================================================

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
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [defaults] = useState(getCenterDefaults);

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
    };

    update();
    if (isRunning) {
      intervalRef.current = setInterval(update, 500);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [controller, isRunning]);

  // 전체 합산
  const total = fabStatsList.reduce(
    (acc, f) => ({
      vehicles: acc.vehicles + f.vehicleCount,
      moving: acc.moving + f.movingCount,
      stopped: acc.stopped + f.stoppedCount,
    }),
    { vehicles: 0, moving: 0, stopped: 0 },
  );

  return (
    <FloatingPanel
      title="Fab 실시간 통계"
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
          </div>
        ) : undefined
      }
    >
      {fabStatsList.length === 0 ? (
        <div className={panelTextVariants({ variant: "muted", size: "sm" })}>
          시뮬레이션이 실행중이지 않습니다.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {fabStatsList.map((fab) => (
            <FabCard key={fab.fabId} fab={fab} />
          ))}
        </div>
      )}
    </FloatingPanel>
  );
};

export default FabStatsPanel;
