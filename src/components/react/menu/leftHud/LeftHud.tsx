import React, { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useFabStore } from "@/store/map/fabStore";
import { useShmSimulatorStore } from "@/store/vehicle/shmMode/shmSimulatorStore";
import { useFabConfigStore } from "@/store/simulation/fabConfigStore";
import { useOrderStatsStore } from "@/store/simulation/orderStatsStore";
import {
  VEHICLE_DATA_SIZE,
  LogicData,
  StopReason,
} from "@/common/vehicle/initialize/constants";
import LiveKpiSection, { KpiSnapshot, Trend } from "./LiveKpiSection";
import ActiveFabSection from "./ActiveFabSection";
import LeaderTopSection, { LeaderEntry } from "./LeaderTopSection";

const POLL_MS = 2500;
const TREND_THRESHOLD = 0.01;

const computeTrend = (current: number, prev: number | null): Trend => {
  if (prev === null || prev === 0) return "flat";
  const delta = (current - prev) / prev;
  if (delta > TREND_THRESHOLD) return "up";
  if (delta < -TREND_THRESHOLD) return "down";
  return "flat";
};

const LeftHud: React.FC = () => {
  const controller = useShmSimulatorStore((s) => s.controller);
  const isRunning = useShmSimulatorStore((s) => s.isRunning);
  const activeFabIndex = useFabStore((s) => s.activeFabIndex);
  const fabs = useFabStore((s) => s.fabs);
  const fabStats = useOrderStatsStore((s) => s.fabStats);
  const globalRouting = useFabConfigStore((s) => s.routingConfig);
  const globalTransferMode = useFabConfigStore((s) => s.transferModeConfig);
  const globalTransferRate = useFabConfigStore((s) => s.transferRateConfig);
  const fabOverrides = useFabConfigStore((s) => s.fabOverrides);

  const [snapshot, setSnapshot] = useState<KpiSnapshot | null>(null);
  const [leaders, setLeaders] = useState<LeaderEntry[]>([]);
  const prevRef = useRef<{ throughput: number | null; leadP95: number | null; locks: number | null }>({
    throughput: null,
    leadP95: null,
    locks: null,
  });

  useEffect(() => {
    if (!controller) {
      setSnapshot(null);
      setLeaders([]);
      prevRef.current = { throughput: null, leadP95: null, locks: null };
      return;
    }

    const tick = () => {
      const fabIds = controller.getFabIds();
      if (fabIds.length === 0) return;

      const idx = Math.max(0, Math.min(activeFabIndex, fabIds.length - 1));
      const activeFabId = fabIds[idx];

      // [1] LIVE KPI — active fab만
      const vehicleCount = controller.getActualNumVehicles(activeFabId);
      const stats = useOrderStatsStore.getState().fabStats[activeFabId];
      const throughput = stats?.throughputPerHour ?? 0;
      const leadP95 = stats?.leadTimeP95 ?? 0;

      // Active locks: active fab의 차량 중 STOP_REASON & LOCKED
      let locks = 0;
      const fullData = controller.getVehicleFullData();
      const workerLayout = controller.getWorkerLayout();
      if (fullData && workerLayout) {
        const assignment = workerLayout.fabAssignments.get(activeFabId);
        if (assignment) {
          const startIdx =
            assignment.vehicleRegion.offset /
            (VEHICLE_DATA_SIZE * Float32Array.BYTES_PER_ELEMENT);
          for (let i = 0; i < vehicleCount; i++) {
            const ptr = (startIdx + i) * VEHICLE_DATA_SIZE;
            const sr = fullData[ptr + LogicData.STOP_REASON];
            if (sr & StopReason.LOCKED) locks++;
          }
        }
      }

      // 추세
      const prev = prevRef.current;
      const next: KpiSnapshot = {
        activeFabId,
        vehicleCount,
        throughput,
        leadP95,
        locks,
        throughputTrend: computeTrend(throughput, prev.throughput),
        leadP95Trend: computeTrend(leadP95, prev.leadP95),
        locksTrend: computeTrend(locks, prev.locks),
      };
      prevRef.current = { throughput, leadP95, locks };
      setSnapshot(next);

      // [3] LEADER TOP 3 — 전체 fab, throughput desc
      const allStats = useOrderStatsStore.getState().fabStats;
      const entries: LeaderEntry[] = fabIds.map((fabId, fabIdx) => {
        const s = allStats[fabId];
        const fab = fabs[fabIdx];
        const ovr = fabOverrides[fabIdx];
        const strategy = ovr?.routing?.strategy ?? globalRouting.strategy;
        return {
          fabIdx,
          fabId,
          label: fab ? `${fab.col}_${fab.row}` : `${fabIdx}`,
          strategy,
          throughput: s?.throughputPerHour ?? 0,
        };
      });
      entries.sort((a, b) => b.throughput - a.throughput);
      setLeaders(entries.slice(0, 3));
    };

    tick();
    if (!isRunning) return;
    const id = setInterval(tick, POLL_MS);
    return () => clearInterval(id);
  }, [controller, isRunning, activeFabIndex, fabs, fabStats, globalRouting.strategy, fabOverrides]);

  if (!controller) return null;
  if (!snapshot) return null;

  // ACTIVE FAB CONFIG
  const idx = Math.max(0, Math.min(activeFabIndex, fabs.length - 1));
  const fab = fabs[idx];
  const ovr = fabOverrides[idx];
  const effectiveRouting = {
    strategy: ovr?.routing?.strategy ?? globalRouting.strategy,
    bprAlpha: ovr?.routing?.bprAlpha ?? globalRouting.bprAlpha,
    bprBeta: ovr?.routing?.bprBeta ?? globalRouting.bprBeta,
    ewmaAlpha: ovr?.routing?.ewmaAlpha ?? globalRouting.ewmaAlpha,
  };
  const effectiveMode = ovr?.transferMode ?? globalTransferMode;
  const effectiveRate = {
    mode: ovr?.transferRateConfig?.mode ?? globalTransferRate.mode,
    utilizationPercent: ovr?.transferRateConfig?.utilizationPercent ?? globalTransferRate.utilizationPercent,
    throughputPerHour: ovr?.transferRateConfig?.throughputPerHour ?? globalTransferRate.throughputPerHour,
  };

  return (
    <HudLayout
      snapshot={snapshot}
      fabLabel={fab ? `${fab.col}_${fab.row}` : `${idx}`}
      routing={effectiveRouting}
      transferMode={effectiveMode}
      transferRate={effectiveRate}
      leaders={leaders}
      activeFabIdx={idx}
    />
  );
};

interface HudLayoutProps {
  snapshot: KpiSnapshot;
  fabLabel: string;
  routing: { strategy: string; bprAlpha: number; bprBeta: number; ewmaAlpha: number };
  transferMode: { idlePolicy: string };
  transferRate: { mode: "utilization" | "throughput"; utilizationPercent: number; throughputPerHour: number };
  leaders: LeaderEntry[];
  activeFabIdx: number;
}

const HudLayout: React.FC<HudLayoutProps> = ({
  snapshot, fabLabel, routing, transferMode, transferRate, leaders, activeFabIdx,
}) => {
  const [open, setOpen] = useState(true);

  return (
    <div className="fixed top-4 left-4 z-50 flex flex-col gap-3 pointer-events-none">
      {/* Top header — active fab name + master toggle */}
      <div className="flex items-center justify-between min-w-[260px] pr-1">
        <span
          className="text-base font-mono font-bold text-white tracking-wider"
          style={{ textShadow: "0 1px 3px rgba(0,0,0,0.9)" }}
        >
          Fab {fabLabel}
        </span>
        <button
          onClick={() => setOpen(!open)}
          className="text-zinc-200 hover:text-white p-0.5 pointer-events-auto"
          style={{ textShadow: "0 1px 2px rgba(0,0,0,0.85)" }}
          aria-label={open ? "Collapse all" : "Expand all"}
        >
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
      </div>

      {open && (
        <>
          <LiveKpiSection snapshot={snapshot} />
          <ActiveFabSection
            routing={routing}
            transferMode={transferMode}
            transferRate={transferRate}
          />
          <LeaderTopSection leaders={leaders} activeFabIdx={activeFabIdx} />
        </>
      )}
    </div>
  );
};

export default LeftHud;
