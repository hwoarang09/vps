import React, { useState, useEffect, useRef } from "react";
import { useShmSimulatorStore } from "@/store/vehicle/shmMode/shmSimulatorStore";
import { VEHICLE_DATA_SIZE, MovementData } from "@/common/vehicle/initialize/constants";
import {
  panelTitleVariants,
  panelCardVariants,
  panelTextVariants,
} from "../shared/panelStyles";

interface FabStats {
  fabId: string;
  vehicleCount: number;
  avgSpeed: number;
  maxSpeed: number;
  stoppedCount: number;
  movingCount: number;
}

function computeFabStats(
  fabId: string,
  fullData: Float32Array,
  workerStartOffset: number, // byte offset
  vehicleCount: number,
): FabStats {
  const startIdx = workerStartOffset / (VEHICLE_DATA_SIZE * Float32Array.BYTES_PER_ELEMENT);

  let totalSpeed = 0;
  let maxSpeed = 0;
  let stoppedCount = 0;
  let movingCount = 0;

  for (let i = 0; i < vehicleCount; i++) {
    const ptr = (startIdx + i) * VEHICLE_DATA_SIZE;
    const velocity = fullData[ptr + MovementData.VELOCITY];

    totalSpeed += velocity;
    if (velocity > maxSpeed) maxSpeed = velocity;
    if (velocity < 0.01) stoppedCount++;
    else movingCount++;
  }

  return {
    fabId,
    vehicleCount,
    avgSpeed: vehicleCount > 0 ? totalSpeed / vehicleCount : 0,
    maxSpeed,
    stoppedCount,
    movingCount,
  };
}

const FabStatsPanel: React.FC = () => {
  const controller = useShmSimulatorStore((s) => s.controller);
  const isRunning = useShmSimulatorStore((s) => s.isRunning);
  const [fabStatsList, setFabStatsList] = useState<FabStats[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const update = () => {
      if (!controller) {
        setFabStatsList([]);
        return;
      }

      const fullData = controller.getVehicleFullData();
      const workerLayout = controller.getWorkerLayout();
      const fabIds = controller.getFabIds();

      if (!fullData || !workerLayout) {
        setFabStatsList([]);
        return;
      }

      const stats: FabStats[] = [];
      for (const fabId of fabIds) {
        const assignment = workerLayout.fabAssignments.get(fabId);
        if (!assignment) continue;

        const vehicleCount = controller.getActualNumVehicles(fabId);
        const stat = computeFabStats(
          fabId,
          fullData,
          assignment.vehicleRegion.offset,
          vehicleCount,
        );
        stats.push(stat);
      }

      setFabStatsList(stats);
    };

    // Update immediately
    update();

    // Poll every 500ms while running
    if (isRunning) {
      intervalRef.current = setInterval(update, 500);
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [controller, isRunning]);

  if (fabStatsList.length === 0) {
    return (
      <div className={panelTextVariants({ variant: "muted", size: "sm" })}>
        시뮬레이션이 실행중이지 않습니다.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className={panelTitleVariants({ size: "sm", color: "cyan" })}>Fab별 실시간 통계</h3>

      {fabStatsList.map((fab) => {
        const movingPct = fab.vehicleCount > 0
          ? ((fab.movingCount / fab.vehicleCount) * 100).toFixed(0)
          : "0";

        return (
          <div key={fab.fabId} className={`${panelCardVariants({ variant: "default", padding: "sm" })}`}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-accent-orange">{fab.fabId}</span>
              <span className="text-[10px] text-gray-500">{fab.vehicleCount} vehicles</span>
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
              {/* Avg Speed */}
              <div className="flex justify-between">
                <span className="text-gray-500">Avg Speed</span>
                <span className="font-mono text-accent-cyan font-bold">
                  {fab.avgSpeed.toFixed(2)} <span className="text-gray-600 font-normal">m/s</span>
                </span>
              </div>

              {/* Max Speed */}
              <div className="flex justify-between">
                <span className="text-gray-500">Max Speed</span>
                <span className="font-mono text-white">
                  {fab.maxSpeed.toFixed(2)} <span className="text-gray-600 font-normal">m/s</span>
                </span>
              </div>

              {/* Moving */}
              <div className="flex justify-between">
                <span className="text-gray-500">Moving</span>
                <span className="font-mono text-accent-green">
                  {fab.movingCount} <span className="text-gray-600 font-normal">({movingPct}%)</span>
                </span>
              </div>

              {/* Stopped */}
              <div className="flex justify-between">
                <span className="text-gray-500">Stopped</span>
                <span className={`font-mono ${fab.stoppedCount > 0 ? "text-amber-400" : "text-gray-600"}`}>
                  {fab.stoppedCount}
                </span>
              </div>
            </div>

            {/* Speed bar */}
            <div className="mt-2 h-1.5 bg-panel-bg-solid rounded-full overflow-hidden">
              <div
                className="h-full bg-accent-cyan rounded-full transition-all duration-300"
                style={{ width: `${Math.min(100, (fab.avgSpeed / 5) * 100)}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default FabStatsPanel;
