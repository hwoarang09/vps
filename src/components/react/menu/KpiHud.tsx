// components/react/menu/KpiHud.tsx
import React, { useState, useEffect, useRef, useCallback } from "react";
import { ChevronDown } from "lucide-react";
import { useFabStore } from "@/store/map/fabStore";
import { useShmSimulatorStore } from "@/store/vehicle/shmMode/shmSimulatorStore";
import { useCameraStore } from "@/store/ui/cameraStore";
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

const KpiHud: React.FC = () => {
  // activeFabIndex는 MapTextRenderer의 useFrame에서 카메라 이동 시 자동 갱신됨
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

  // KPI 데이터 갱신 (500ms interval)
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
      intervalRef.current = setInterval(updateKpi, 500);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [controller, isRunning, updateKpi, activeFabIndex]);

  // 시뮬레이션 미실행 시 숨김
  if (!controller) return null;

  const fabIds = controller.getFabIds?.() ?? [];
  if (fabIds.length === 0) return null;

  // fabIndex 기반 라벨 (3D FabLabelRenderer와 동일: "FAB 0", "FAB 1", ...)
  const fabLabel = (idx: number) => {
    const fab = fabs[idx];
    return fab ? `FAB ${fab.fabIndex}` : `FAB ${idx}`;
  };
  const activeFabLabel = fabLabel(Math.max(0, Math.min(activeFabIndex, fabIds.length - 1)));

  const rows: { label: string; value: string; color?: string }[] = kpi
    ? [
        { label: "Vehicles", value: `${kpi.vehicleCount}` },
        { label: "Speed", value: `${kpi.avgSpeed.toFixed(2)} m/s`, color: "text-cyan-400" },
        { label: "Moving", value: `${kpi.vehicleCount > 0 ? ((kpi.movingCount / kpi.vehicleCount) * 100).toFixed(0) : 0}%`, color: "text-green-400" },
        { label: "Stopped", value: `${kpi.vehicleCount > 0 ? ((kpi.stoppedCount / kpi.vehicleCount) * 100).toFixed(0) : 0}%`, color: "text-amber-400" },
        { label: "Locked", value: `${kpi.stopLocked}`, color: kpi.stopLocked > 0 ? "text-red-400" : "text-gray-500" },
      ]
    : [];

  return (
    <div
      className={twMerge(
        menuContainerVariants({ level: 2 }),
        "fixed top-4 left-4 z-50 flex-col items-stretch p-3 min-w-[160px]",
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
                  // 현재 fab center → 선택 fab center 간 delta만큼 카메라 이동
                  // OrbitControls의 실제 카메라 위치는 store에 없으므로
                  // fab 간 offset delta만 적용하여 현재 뷰 각도/줌 유지
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
      {rows.length > 0 ? (
        <div className="flex flex-col gap-1">
          {rows.map((r) => (
            <div key={r.label} className="flex justify-between items-center">
              <span className="text-[10px] text-gray-500">{r.label}</span>
              <span className={`font-mono text-[11px] ${r.color ?? "text-gray-300"}`}>
                {r.value}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <span className="text-[10px] text-gray-600">No data</span>
      )}
    </div>
  );
};

export default KpiHud;
