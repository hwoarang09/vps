// components/react/menu/KpiHud.tsx
import React, { useState, useEffect, useRef, useCallback } from "react";
import { ChevronDown } from "lucide-react";
import { useFabStore } from "@/store/map/fabStore";
import { useShmSimulatorStore } from "@/store/vehicle/shmMode/shmSimulatorStore";
import { useCameraStore } from "@/store/ui/cameraStore";
import { useFabConfigStore } from "@/store/simulation/fabConfigStore";
import { useOrderStatsStore } from "@/store/simulation/orderStatsStore";
import { menuContainerVariants } from "./shared/menuStyles";
import { twMerge } from "tailwind-merge";
import {
  VEHICLE_DATA_SIZE,
  MovementData,
  LogicData,
  StopReason,
} from "@/common/vehicle/initialize/constants";

interface KpiData {
  fabId: string;
  vehicleCount: number;
  avgSpeed: number;
  movingCount: number;
  stoppedCount: number;
  stopLocked: number;
}

function computeKpi(
  fabId: string,
  fullData: Float32Array,
  workerStartOffset: number,
  vehicleCount: number,
): KpiData {
  const startIdx = workerStartOffset / (VEHICLE_DATA_SIZE * Float32Array.BYTES_PER_ELEMENT);

  const kpi: KpiData = {
    fabId,
    vehicleCount,
    avgSpeed: 0,
    movingCount: 0,
    stoppedCount: 0,
    stopLocked: 0,
  };

  if (vehicleCount === 0) return kpi;

  let totalSpeed = 0;
  for (let i = 0; i < vehicleCount; i++) {
    const ptr = (startIdx + i) * VEHICLE_DATA_SIZE;
    totalSpeed += fullData[ptr + MovementData.VELOCITY];

    const ms = fullData[ptr + MovementData.MOVING_STATUS];
    if (ms === 0) kpi.stoppedCount++;
    else if (ms === 1) kpi.movingCount++;

    const sr = fullData[ptr + LogicData.STOP_REASON];
    if (sr & StopReason.LOCKED) kpi.stopLocked++;
  }

  kpi.avgSpeed = totalSpeed / vehicleCount;
  return kpi;
}

const ROUTING_LABEL: Record<string, string> = {
  DISTANCE: "Dist",
  BPR: "BPR",
  EWMA: "EWMA",
};

const MODE_LABEL: Record<string, string> = {
  SIMPLE_LOOP: "S-Loop",
  LOOP: "Loop",
  RANDOM: "Random",
  MQTT_CONTROL: "MQTT",
  AUTO_ROUTE: "Auto",
};

const KpiHud: React.FC = () => {
  const { activeFabIndex, setActiveFabIndex, fabs } = useFabStore();

  const controller = useShmSimulatorStore((s) => s.controller);
  const isRunning = useShmSimulatorStore((s) => s.isRunning);

  const [kpi, setKpi] = useState<KpiData | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as HTMLElement)) {
        setDropdownOpen(false);
      }
    };
    if (dropdownOpen) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [dropdownOpen]);

  // KPI 데이터 갱신 (2500ms interval)
  const updateKpi = useCallback(() => {
    if (!controller) { setKpi(null); return; }

    const fullData = controller.getVehicleFullData();
    const workerLayout = controller.getWorkerLayout();
    const fabIds = controller.getFabIds();

    if (!fullData || !workerLayout || fabIds.length === 0) { setKpi(null); return; }

    const currentIdx = useFabStore.getState().activeFabIndex;
    const idx = Math.max(0, Math.min(currentIdx, fabIds.length - 1));
    const fabId = fabIds[idx];
    if (!fabId) { setKpi(null); return; }

    const assignment = workerLayout.fabAssignments.get(fabId);
    if (!assignment) { setKpi(null); return; }

    const vehicleCount = controller.getActualNumVehicles(fabId);
    setKpi(computeKpi(fabId, fullData, assignment.vehicleRegion.offset, vehicleCount));
  }, [controller]);

  useEffect(() => {
    updateKpi();
    if (isRunning) {
      intervalRef.current = setInterval(updateKpi, 2500);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [controller, isRunning, updateKpi, activeFabIndex]);

  // Config stores (reactive — hooks는 early return 전에 호출)
  const globalTransferMode = useFabConfigStore((s) => s.transferModeConfig);
  const globalRoutingConfig = useFabConfigStore((s) => s.routingConfig);
  const globalTransferRate = useFabConfigStore((s) => s.transferRateConfig);
  const fabOverrides = useFabConfigStore((s) => s.fabOverrides);
  const fabStats = useOrderStatsStore((s) => s.fabStats);

  // 시뮬레이션 미실행 시 숨김
  if (!controller) return null;

  const fabIds = controller.getFabIds?.() ?? [];
  if (fabIds.length === 0) return null;

  // fabIndex 기반 라벨 (3D FabLabelRenderer와 동일: "FAB 0", "FAB 1", ...)
  const fabLabel = (idx: number) => {
    const fab = fabs[idx];
    return fab ? `FAB ${fab.fabIndex}` : `FAB ${idx}`;
  };
  const currentFabIdx = Math.max(0, Math.min(activeFabIndex, fabIds.length - 1));
  const activeFabLabel = fabLabel(currentFabIdx);
  const currentFabId = fabIds[currentFabIdx];

  // Per-fab effective config (override → global fallback)
  const ovr = fabOverrides[currentFabIdx];
  const effectiveRouting = {
    strategy: ovr?.routing?.strategy ?? globalRoutingConfig.strategy,
    bprAlpha: ovr?.routing?.bprAlpha ?? globalRoutingConfig.bprAlpha,
    bprBeta: ovr?.routing?.bprBeta ?? globalRoutingConfig.bprBeta,
    ewmaAlpha: ovr?.routing?.ewmaAlpha ?? globalRoutingConfig.ewmaAlpha,
    rerouteInterval: ovr?.routing?.rerouteInterval ?? globalRoutingConfig.rerouteInterval,
  };
  const effectiveMode = ovr?.transferMode ?? globalTransferMode;
  const effectiveRate = {
    mode: ovr?.transferRateConfig?.mode ?? globalTransferRate.mode,
    utilizationPercent: ovr?.transferRateConfig?.utilizationPercent ?? globalTransferRate.utilizationPercent,
    throughputPerHour: ovr?.transferRateConfig?.throughputPerHour ?? globalTransferRate.throughputPerHour,
  };

  // Throughput from orderStatsStore
  const orderStats = currentFabId ? fabStats[currentFabId] : undefined;
  const throughputStr = orderStats ? `${orderStats.throughputPerHour.toFixed(0)}/hr` : "—";

  // Moving/Stopped percentages
  const movingPct = kpi && kpi.vehicleCount > 0
    ? ((kpi.movingCount / kpi.vehicleCount) * 100).toFixed(0)
    : "0";
  const stoppedPct = kpi && kpi.vehicleCount > 0
    ? ((kpi.stoppedCount / kpi.vehicleCount) * 100).toFixed(0)
    : "0";

  // Routing label with key param
  const routingLabel = ROUTING_LABEL[effectiveRouting.strategy] ?? effectiveRouting.strategy;
  let routingParam = "";
  if (effectiveRouting.strategy === "BPR") {
    routingParam = ` α${effectiveRouting.bprAlpha} β${effectiveRouting.bprBeta}`;
  } else if (effectiveRouting.strategy === "EWMA") {
    routingParam = ` α${effectiveRouting.ewmaAlpha}`;
  }

  // Transfer mode + rate
  const modeLabel = MODE_LABEL[effectiveMode] ?? effectiveMode;
  let rateStr = "";
  if (effectiveRate.mode === "utilization") {
    rateStr = `${effectiveRate.utilizationPercent}%`;
  } else {
    rateStr = `${effectiveRate.throughputPerHour}/h`;
  }

  return (
    <div
      className={twMerge(
        menuContainerVariants({ level: 2 }),
        "fixed top-4 left-4 z-50 flex-col items-stretch p-3 min-w-[170px]",
      )}
    >
      {/* Fab Selector */}
      <div className="relative mb-2" ref={dropdownRef}>
        <button
          className="flex items-center gap-1 text-xs font-bold text-white hover:text-cyan-300 transition-colors w-full"
          onClick={() => setDropdownOpen(!dropdownOpen)}
        >
          <span className="font-mono">{activeFabLabel}</span>
          <ChevronDown size={12} className={`transition-transform ${dropdownOpen ? "rotate-180" : ""}`} />
        </button>

        {dropdownOpen && (
          <div className="absolute top-6 left-0 bg-gray-900/95 border border-gray-600 rounded-lg py-1 min-w-[140px] max-h-[200px] overflow-y-auto z-[60]">
            {fabIds.map((_fid: string, i: number) => (
              <button
                key={i}
                className={`block w-full text-left px-3 py-1 text-xs font-mono transition-colors ${
                  i === activeFabIndex
                    ? "text-cyan-400 bg-gray-800"
                    : "text-gray-300 hover:bg-gray-800 hover:text-white"
                }`}
                onClick={() => {
                  const prevFab = fabs[activeFabIndex];
                  setActiveFabIndex(i);
                  setDropdownOpen(false);
                  const nextFab = fabs[i];
                  if (nextFab && prevFab) {
                    const deltaX = nextFab.centerX - prevFab.centerX;
                    const deltaY = nextFab.centerY - prevFab.centerY;
                    const { position: storePos, target: storeTgt, setCameraView } = useCameraStore.getState();
                    setCameraView(
                      [storePos.x + deltaX, storePos.y + deltaY, storePos.z],
                      [storeTgt.x + deltaX, storeTgt.y + deltaY, storeTgt.z],
                    );
                  }
                }}
              >
                {fabLabel(i)}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* KPI Rows */}
      {kpi ? (
        <div className="flex flex-col gap-1">
          {/* Vehicles */}
          <div className="flex justify-between items-center">
            <span className="text-[10px] text-gray-500">Vehicles</span>
            <span className="font-mono text-[11px] text-gray-300">{kpi.vehicleCount}</span>
          </div>

          {/* Moving / Stopped */}
          <div className="flex justify-between items-center">
            <span className="text-[10px] text-gray-500">Move/Stop</span>
            <span className="font-mono text-[11px]">
              <span className="text-green-400">{movingPct}</span>
              <span className="text-gray-600"> / </span>
              <span className="text-amber-400">{stoppedPct}</span>
              <span className="text-gray-600"> %</span>
            </span>
          </div>

          {/* Locked */}
          <div className="flex justify-between items-center">
            <span className="text-[10px] text-gray-500">Locked</span>
            <span className={`font-mono text-[11px] ${kpi.stopLocked > 0 ? "text-red-400" : "text-gray-500"}`}>
              {kpi.stopLocked}
            </span>
          </div>

          {/* Divider */}
          <div className="border-t border-gray-700 my-0.5" />

          {/* Transfer Mode */}
          <div className="flex justify-between items-center">
            <span className="text-[10px] text-gray-500">Mode</span>
            <span className="font-mono text-[11px] text-cyan-400">{modeLabel} · {rateStr}</span>
          </div>

          {/* Routing */}
          <div className="flex justify-between items-center">
            <span className="text-[10px] text-gray-500">Routing</span>
            <span className="font-mono text-[11px] text-purple-400">{routingLabel}{routingParam}</span>
          </div>

          {/* Throughput */}
          <div className="flex justify-between items-center">
            <span className="text-[10px] text-gray-500">Throughput</span>
            <span className="font-mono text-[11px] text-green-300 font-bold">{throughputStr}</span>
          </div>
        </div>
      ) : (
        <span className="text-[10px] text-gray-600">No data</span>
      )}
    </div>
  );
};

export default KpiHud;
