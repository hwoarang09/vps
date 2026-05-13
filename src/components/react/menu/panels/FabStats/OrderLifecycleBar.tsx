import React from "react";
import { useFabStatsUIStore, type TimingKey } from "./store";
import { useOrderStatsStore } from "@/store/simulation/orderStatsStore";

// Segment 별 색
const SEG_COLORS = {
  pickupApproach: "#3b82f6", // blue   (→Pickup)
  loading: "#06b6d4",         // cyan   (Load)
  dropApproach: "#a78bfa",    // purple (→Drop)
  unloading: "#f97316",       // orange (Unload)
};

// Timing → 묶음 색
const TIMING_COLORS: Record<TimingKey, string> = {
  lead: "#22c55e",      // green
  waiting: "#06b6d4",   // cyan
  delivery: "#a78bfa",  // purple
};

interface Props {
  fabId: string;
}

const fmtSec = (s: number) => (s < 0.05 ? "0s" : s < 10 ? `${s.toFixed(1)}s` : `${s.toFixed(0)}s`);

export const OrderLifecycleBar: React.FC<Props> = ({ fabId }) => {
  const stats = useOrderStatsStore((s) => s.fabStats[fabId]);
  const selectedTiming = useFabStatsUIStore((s) => s.selectedTiming);
  const setSelectedTiming = useFabStatsUIStore((s) => s.setSelectedTiming);

  if (!stats || stats.completed === 0) {
    return (
      <div className="bg-panel-bg-solid/40 border border-gray-700/60 rounded-md p-3 text-[10px] text-gray-600 italic text-center">
        Order Lifecycle — Waiting for completed orders…
      </div>
    );
  }

  const p = stats.pickupApproachMean;
  const l = stats.loadingMean;
  const d = stats.dropApproachMean;
  const u = stats.unloadingMean;
  const total = p + l + d + u;

  if (total <= 0) {
    return (
      <div className="bg-panel-bg-solid/40 border border-gray-700/60 rounded-md p-3 text-[10px] text-gray-600 italic text-center">
        Order Lifecycle — Stage timing 미측정
      </div>
    );
  }

  const segments = [
    { key: "pickup", group: "waiting" as TimingKey, label: "→Pickup", value: p, color: SEG_COLORS.pickupApproach },
    { key: "load",   group: "waiting" as TimingKey, label: "Load",    value: l, color: SEG_COLORS.loading },
    { key: "drop",   group: "delivery" as TimingKey, label: "→Drop",  value: d, color: SEG_COLORS.dropApproach },
    { key: "unload", group: "delivery" as TimingKey, label: "Unload", value: u, color: SEG_COLORS.unloading },
  ];
  const pcts = segments.map((s) => (s.value / total) * 100);

  // Waiting 범위 = 0 ~ (p+l), Delivery 범위 = (p+l) ~ total, Lead = 0 ~ total
  const waitingPct = pcts[0] + pcts[1];
  const deliveryStartPct = waitingPct;

  // SVG brace 영역 — 0~100 viewbox
  const BraceMark: React.FC<{
    startPct: number; endPct: number; y: number;
    color: string; active: boolean; onClick: () => void;
  }> = ({ startPct, endPct, y, color, active, onClick }) => {
    const w = endPct - startPct;
    return (
      <g
        onClick={onClick}
        style={{ cursor: "pointer" }}
        className="group"
      >
        {/* hit area (투명 큰 영역) */}
        <rect x={startPct} y={y - 5} width={w} height={14} fill="transparent" />
        {/* 가로선 + 양 끝 ticks (스테이플러 심) */}
        <line
          x1={startPct + 0.3} y1={y} x2={endPct - 0.3} y2={y}
          stroke={color} strokeWidth={active ? 1.4 : 0.8}
          opacity={active ? 1 : 0.55}
          className="group-hover:opacity-100"
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1={startPct + 0.3} y1={y - 2.5} x2={startPct + 0.3} y2={y + 2.5}
          stroke={color} strokeWidth={active ? 1.4 : 0.8}
          opacity={active ? 1 : 0.55}
          className="group-hover:opacity-100"
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1={endPct - 0.3} y1={y - 2.5} x2={endPct - 0.3} y2={y + 2.5}
          stroke={color} strokeWidth={active ? 1.4 : 0.8}
          opacity={active ? 1 : 0.55}
          className="group-hover:opacity-100"
          vectorEffect="non-scaling-stroke"
        />
      </g>
    );
  };

  return (
    <div className="bg-panel-bg-solid/40 border border-gray-700/60 rounded-md p-3">
      {/* Header */}
      <div className="flex items-baseline justify-between mb-2 px-1">
        <span className="text-[11px] font-semibold text-gray-300">
          Order Lifecycle <span className="text-gray-500">(avg)</span>
        </span>
        <span className="text-[10.5px] text-gray-500">
          n = <span className="text-gray-300 tabular-nums">{stats.completed.toLocaleString()}</span>
          <span className="ml-2">total <span className="text-gray-300 tabular-nums">{fmtSec(total)}</span></span>
        </span>
      </div>

      {/* Stacked bar */}
      <div className="flex h-8 rounded overflow-hidden bg-panel-bg-solid mb-1.5">
        {segments.map((seg, i) => {
          const pct = pcts[i];
          if (pct < 0.5) return null;
          const isActive =
            (selectedTiming === "waiting" && seg.group === "waiting") ||
            (selectedTiming === "delivery" && seg.group === "delivery") ||
            selectedTiming === "lead";
          return (
            <button
              key={seg.key}
              onClick={() => setSelectedTiming(seg.group)}
              title={`${seg.label}: ${fmtSec(seg.value)} (${pct.toFixed(0)}%) — click for ${seg.group}`}
              className="h-full transition-opacity"
              style={{
                width: `${pct}%`,
                background: seg.color,
                opacity: isActive ? 1 : 0.4,
              }}
            />
          );
        })}
      </div>

      {/* Segment 라벨 */}
      <div className="relative h-5 mb-1">
        {segments.map((seg, i) => {
          const left = pcts.slice(0, i).reduce((a, b) => a + b, 0);
          const pct = pcts[i];
          if (pct < 4) return null;
          return (
            <div
              key={seg.key}
              className="absolute text-[10px] text-gray-500 leading-tight text-center"
              style={{ left: `${left}%`, width: `${pct}%`, top: 0 }}
            >
              <span className="block truncate">{seg.label}</span>
              <span className="block text-gray-600 tabular-nums">{fmtSec(seg.value)}</span>
            </div>
          );
        })}
      </div>

      {/* SVG brace 영역 (Waiting / Delivery / Lead) */}
      <svg viewBox="0 0 100 22" preserveAspectRatio="none" className="w-full" style={{ height: 44 }}>
        <BraceMark
          startPct={0} endPct={waitingPct} y={3}
          color={TIMING_COLORS.waiting}
          active={selectedTiming === "waiting"}
          onClick={() => setSelectedTiming("waiting")}
        />
        <BraceMark
          startPct={deliveryStartPct} endPct={100} y={3}
          color={TIMING_COLORS.delivery}
          active={selectedTiming === "delivery"}
          onClick={() => setSelectedTiming("delivery")}
        />
        <BraceMark
          startPct={0} endPct={100} y={14}
          color={TIMING_COLORS.lead}
          active={selectedTiming === "lead"}
          onClick={() => setSelectedTiming("lead")}
        />
      </svg>

      {/* Brace 라벨 (선택된 timing 강조) */}
      <div className="flex items-center justify-between text-[10.5px] mt-1 px-1">
        <div className="flex gap-3">
          <button
            onClick={() => setSelectedTiming("waiting")}
            className={`flex items-center gap-1 transition-opacity ${selectedTiming === "waiting" ? "opacity-100" : "opacity-50 hover:opacity-100"}`}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: TIMING_COLORS.waiting }} />
            <span className={selectedTiming === "waiting" ? "text-accent-cyan font-bold" : "text-gray-400"}>
              Waiting <span className="tabular-nums ml-0.5">{fmtSec(p + l)}</span>
            </span>
          </button>
          <button
            onClick={() => setSelectedTiming("delivery")}
            className={`flex items-center gap-1 transition-opacity ${selectedTiming === "delivery" ? "opacity-100" : "opacity-50 hover:opacity-100"}`}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: TIMING_COLORS.delivery }} />
            <span className={selectedTiming === "delivery" ? "text-purple-300 font-bold" : "text-gray-400"}>
              Delivery <span className="tabular-nums ml-0.5">{fmtSec(d + u)}</span>
            </span>
          </button>
        </div>
        <button
          onClick={() => setSelectedTiming("lead")}
          className={`flex items-center gap-1 transition-opacity ${selectedTiming === "lead" ? "opacity-100" : "opacity-50 hover:opacity-100"}`}
        >
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: TIMING_COLORS.lead }} />
          <span className={selectedTiming === "lead" ? "text-green-300 font-bold" : "text-gray-400"}>
            Lead <span className="tabular-nums ml-0.5">{fmtSec(total)}</span>
          </span>
        </button>
      </div>
    </div>
  );
};
