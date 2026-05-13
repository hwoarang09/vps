import React from "react";
import { useFabStatsUIStore, type TimingKey } from "./store";
import { useOrderStatsStore } from "@/store/simulation/orderStatsStore";
import { ORDER_SEGMENT_COLORS, TIMING_COLORS as PALETTE_TIMING_COLORS } from "@/config/colors";

const SEG_COLORS = ORDER_SEGMENT_COLORS;
const TIMING_COLORS: Record<TimingKey, string> = PALETTE_TIMING_COLORS;

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

  // Brace — flex로 line을 텍스트 양옆에 split. line은 텍스트 수직 가운데 통과.
  const Brace: React.FC<{
    startPct: number; endPct: number; top: number;
    color: string; active: boolean; onClick: () => void;
    label: string; value: number; textColorClass: string;
  }> = ({ startPct, endPct, top, color, active, onClick, label, value, textColorClass }) => {
    const w = endPct - startPct;
    return (
      <button
        type="button"
        onClick={onClick}
        className="absolute group cursor-pointer flex items-center gap-1.5"
        style={{
          left: `${startPct}%`,
          width: `${w}%`,
          top,
          height: 16,
        }}
      >
        {/* 좌측 line */}
        <div
          className={`flex-1 h-px transition-opacity ${
            active ? "opacity-100" : "opacity-50 group-hover:opacity-100"
          }`}
          style={{ background: color }}
        />
        {/* 중앙 라벨 — 항상 timing color, active 시 bold만 토글 */}
        <span
          className={`text-[10.5px] tabular-nums whitespace-nowrap transition-all ${textColorClass} ${
            active ? "font-bold" : "font-medium"
          }`}
        >
          {label}
          <span className="ml-1">{fmtSec(value)}</span>
        </span>
        {/* 우측 line */}
        <div
          className={`flex-1 h-px transition-opacity ${
            active ? "opacity-100" : "opacity-50 group-hover:opacity-100"
          }`}
          style={{ background: color }}
        />
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
          textColorClass="text-accent-cyan"
        />
        <Brace
          startPct={deliveryStartPct} endPct={100} top={0}
          color={TIMING_COLORS.delivery}
          active={selectedTiming === "delivery"}
          onClick={() => setSelectedTiming("delivery")}
          label="Delivery" value={d + u}
          textColorClass="text-blue-300"
        />
        <Brace
          startPct={0} endPct={100} top={22}
          color={TIMING_COLORS.lead}
          active={selectedTiming === "lead"}
          onClick={() => setSelectedTiming("lead")}
          label="Lead" value={total}
          textColorClass="text-green-300"
        />
      </div>
    </div>
  );
};
