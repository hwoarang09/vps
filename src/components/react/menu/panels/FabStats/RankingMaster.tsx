import React, { useMemo, useState, useRef, useEffect } from "react";
import { ChevronDown, ArrowDownUp } from "lucide-react";
import { useOrderStatsStore } from "@/store/simulation/orderStatsStore";
import { useFabConfigStore } from "@/store/simulation/fabConfigStore";
import { useFabStatsUIStore, RANKING_METRICS, type RankingMetricKey } from "./store";
import type { FabStats } from "../FabStatsPanel";

import { fabRoutingText } from "./routingLabel";
const RANK_BADGE = ["🥇", "🥈", "🥉"];

interface RankedEntry {
  fab: FabStats;
  fabIndex: number;
  value: number;
  strategyText: string;
}

function getMetricValue(fab: FabStats, key: RankingMetricKey, throughput: number, leadP50: number, leadP95: number, completed: number): number {
  const n = fab.vehicleCount || 1;
  switch (key) {
    case "throughput": return throughput;
    case "leadTimeP50": return leadP50;
    case "leadTimeP95": return leadP95;
    case "avgSpeed": return fab.avgSpeed;
    case "movingRate": return (fab.movingCount / n) * 100;
    case "stoppedRate": return (fab.stoppedCount / n) * 100;
    case "collisionCount": return fab.sensorCollisionCount;
    case "completed": return completed;
    default: return 0;
  }
}

function formatMetric(value: number, key: RankingMetricKey): string {
  const metric = RANKING_METRICS.find(m => m.key === key)!;
  if (key === "collisionCount" || key === "completed") return `${value.toFixed(0)}${metric.unit}`;
  if (key === "leadTimeP50" || key === "leadTimeP95") return `${value.toFixed(1)}${metric.unit}`;
  if (key === "movingRate" || key === "stoppedRate") return `${value.toFixed(0)}${metric.unit}`;
  if (key === "throughput") return `${value.toFixed(0)}${metric.unit}`;
  return `${value.toFixed(2)}${metric.unit}`;
}

export const RankingMaster: React.FC<{ fabStatsList: FabStats[] }> = ({ fabStatsList }) => {
  const sortBy = useFabStatsUIStore((s) => s.rankingSortBy);
  const sortOrder = useFabStatsUIStore((s) => s.rankingSortOrder);
  const selectedFabId = useFabStatsUIStore((s) => s.selectedFabId);
  const setRankingSortBy = useFabStatsUIStore((s) => s.setRankingSortBy);
  const toggleSortOrder = useFabStatsUIStore((s) => s.toggleRankingSortOrder);
  const setSelectedFabId = useFabStatsUIStore((s) => s.setSelectedFabId);

  const orderStatsMap = useOrderStatsStore((s) => s.fabStats);
  const globalRouting = useFabConfigStore((s) => s.routingConfig);
  const fabOverrides = useFabConfigStore((s) => s.fabOverrides);

  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const sortMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (sortMenuRef.current && !sortMenuRef.current.contains(e.target as Node)) {
        setSortMenuOpen(false);
      }
    };
    if (sortMenuOpen) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [sortMenuOpen]);

  const ranked: RankedEntry[] = useMemo(() => {
    const entries = fabStatsList
      .map((fab, fabIndex) => {
        const os = orderStatsMap[fab.fabId];
        const throughput = os?.throughputPerHour ?? 0;
        const leadP50 = os?.leadTimeP50 ?? 0;
        const leadP95 = os?.leadTimeP95 ?? 0;
        const completed = os?.completed ?? 0;
        const value = getMetricValue(fab, sortBy, throughput, leadP50, leadP95, completed);

        const ovr = fabOverrides[fabIndex];
        const strategyText = fabRoutingText(globalRouting, ovr?.routing);

        return { fab, fabIndex, value, strategyText };
      })
      .filter((e) => e.fab.vehicleCount > 0);

    entries.sort((a, b) => (sortOrder === "desc" ? b.value - a.value : a.value - b.value));
    return entries;
  }, [fabStatsList, orderStatsMap, fabOverrides, globalRouting, sortBy, sortOrder]);

  // 자동 선택: 선택 없거나 선택된 fab이 list에 없으면 #1 자동 선택
  useEffect(() => {
    if (ranked.length === 0) return;
    if (!selectedFabId || !ranked.some(e => e.fab.fabId === selectedFabId)) {
      setSelectedFabId(ranked[0].fab.fabId);
    }
  }, [ranked, selectedFabId, setSelectedFabId]);

  const currentMetric = RANKING_METRICS.find((m) => m.key === sortBy)!;

  return (
    <div className="h-full min-h-0 flex flex-col bg-gray-900/40 border-r border-gray-700/50 overflow-hidden">
      {/* Sort controls */}
      <div className="shrink-0 p-2 border-b border-gray-700/50 flex items-center gap-1.5">
        <div ref={sortMenuRef} className="relative flex-1">
          <button
            onClick={() => setSortMenuOpen((v) => !v)}
            className="w-full px-2 py-1 rounded text-[11px] border bg-panel-bg-solid text-gray-300 border-panel-border hover:border-accent-cyan transition-colors flex items-center justify-between gap-1"
          >
            <span className="text-gray-500">Sort:</span>
            <span className="text-accent-cyan font-medium">{currentMetric.label}</span>
            <ChevronDown size={12} className="text-gray-500" />
          </button>
          {sortMenuOpen && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-panel-bg-solid border border-panel-border rounded shadow-lg z-10 max-h-60 overflow-auto vps-scrollbar">
              {RANKING_METRICS.map((m) => (
                <button
                  key={m.key}
                  onClick={() => { setRankingSortBy(m.key); setSortMenuOpen(false); }}
                  className={`w-full text-left px-2 py-1 text-[11px] hover:bg-gray-700/50 ${sortBy === m.key ? "text-accent-cyan font-bold" : "text-gray-300"}`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={toggleSortOrder}
          title={sortOrder === "desc" ? "Descending" : "Ascending"}
          className="px-1.5 py-1 rounded text-[11px] border bg-panel-bg-solid text-gray-300 border-panel-border hover:border-accent-cyan transition-colors flex items-center gap-0.5"
        >
          <ArrowDownUp size={12} />
          <span className="text-[10px]">{sortOrder === "desc" ? "▼" : "▲"}</span>
        </button>
      </div>

      {/* List */}
      <div className="flex-1 min-h-0 overflow-auto vps-scrollbar">
        {ranked.length === 0 ? (
          <div className="p-3 text-[11px] text-gray-500">No fabs.</div>
        ) : (
          ranked.map((entry, rank) => {
            const isSelected = entry.fab.fabId === selectedFabId;
            const badge = rank < 3 ? RANK_BADGE[rank] : `#${rank + 1}`;
            return (
              <button
                key={entry.fab.fabId}
                onClick={() => setSelectedFabId(entry.fab.fabId)}
                className={`w-full text-left px-2 py-1.5 border-b border-gray-800/50 transition-colors flex items-center gap-1.5 ${
                  isSelected
                    ? "bg-accent-cyan/15 border-l-2 border-l-accent-cyan"
                    : "border-l-2 border-l-transparent hover:bg-gray-800/40"
                }`}
              >
                <span className="text-[11px] w-7 shrink-0 text-center">{badge}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-1.5">
                    <span className={`text-[12px] font-bold truncate ${isSelected ? "text-accent-orange" : "text-gray-200"}`}>
                      {entry.fab.fabId}
                    </span>
                    <span className="text-[10px] text-purple-300/80 truncate">{entry.strategyText}</span>
                  </div>
                  <div className="flex items-baseline justify-between gap-1">
                    <span className="text-[10px] text-gray-500">{entry.fab.vehicleCount} veh</span>
                    <span className="text-[11px] font-mono tabular-nums text-accent-green font-bold">
                      {formatMetric(entry.value, sortBy)}
                    </span>
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
};
