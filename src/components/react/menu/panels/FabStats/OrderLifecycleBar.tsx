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

  // Brace (스테이플러 모양) — 가로선 + 좌우 ticks, 중앙에 라벨이 선을 끊으며 표시
  const Brace: React.FC<{
    startPct: number; endPct: number; top: number;
    color: string; active: boolean; onClick: () => void;
    label: string; value: number; activeTextClass: string;
  }> = ({ startPct, endPct, top, color, active, onClick, label, value, activeTextClass }) => {
    const w = endPct - startPct;
    const lineThickness = active ? 2 : 1;
    return (
      <button
        type="button"
        onClick={onClick}
        className="absolute group cursor-pointer"
        style={{
          left: `${startPct}%`,
          width: `${w}%`,
          top,
          height: 14,
          opacity: active ? 1 : 0.6,
        }}
      >
        {/* 좌측 tick */}
        <div
          className="absolute left-0 top-0 transition-colors group-hover:!opacity-100"
          style={{ width: lineThickness, height: 6, background: color, opacity: active ? 1 : 0.75 }}
        />
        {/* 우측 tick */}
        <div
          className="absolute right-0 top-0 transition-colors group-hover:!opacity-100"
          style={{ width: lineThickness, height: 6, background: color, opacity: active ? 1 : 0.75 }}
        />
        {/* 가로선 */}
        <div
          className="absolute left-0 right-0 top-0 transition-colors group-hover:!opacity-100"
          style={{ height: lineThickness, background: color, opacity: active ? 1 : 0.75 }}
        />
        {/* 중앙 라벨 — 가로선을 끊으면서 강조 (배경색으로 line break) */}
        <div className="absolute left-1/2 -translate-x-1/2 top-[-6px] px-1.5 bg-panel-bg-solid whitespace-nowrap">
          <span
            className={`text-[10.5px] tabular-nums font-semibold transition-colors ${
              active
                ? `${activeTextClass} font-bold`
                : "text-gray-400 group-hover:text-white"
            }`}
          >
            {label}
            <span className="ml-1">{fmtSec(value)}</span>
          </span>
        </div>
      </button>
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
      <div className="flex h-4 rounded overflow-hidden bg-panel-bg-solid mb-1.5">
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

      {/* Brace 영역 — Waiting/Delivery (top=0), Lead (top=20) */}
      <div className="relative mt-2.5" style={{ height: 40 }}>
        <Brace
          startPct={0} endPct={waitingPct} top={0}
          color={TIMING_COLORS.waiting}
          active={selectedTiming === "waiting"}
          onClick={() => setSelectedTiming("waiting")}
          label="Waiting" value={p + l}
          activeTextClass="text-accent-cyan"
        />
        <Brace
          startPct={deliveryStartPct} endPct={100} top={0}
          color={TIMING_COLORS.delivery}
          active={selectedTiming === "delivery"}
          onClick={() => setSelectedTiming("delivery")}
          label="Delivery" value={d + u}
          activeTextClass="text-purple-300"
        />
        <Brace
          startPct={0} endPct={100} top={22}
          color={TIMING_COLORS.lead}
          active={selectedTiming === "lead"}
          onClick={() => setSelectedTiming("lead")}
          label="Lead" value={total}
          activeTextClass="text-green-300"
        />
      </div>
    </div>
  );
};
