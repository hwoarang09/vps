import React, { useMemo } from "react";
import { useFabStatsUIStore } from "./store";
import type { FabStats } from "../FabStatsPanel";
import { FabDetailCard } from "./FabDetailCard";
import { LeadTimeHistogram } from "./charts/LeadTimeHistogram";

interface ChartSlotProps {
  title: string;
  hint?: string;
  children?: React.ReactNode;
}

const ChartSlot: React.FC<ChartSlotProps> = ({ title, hint, children }) => (
  <div className="bg-panel-bg-solid/40 border border-gray-700/60 rounded-md p-3 flex flex-col min-h-[180px]">
    <div className="flex items-baseline justify-between mb-1.5 shrink-0">
      <span className="text-[11px] font-semibold text-gray-300">{title}</span>
      {!children && (
        <span className="text-[9px] text-gray-600 uppercase tracking-wide">placeholder</span>
      )}
    </div>
    <div className="flex-1 min-h-0">
      {children ?? (
        <div className="h-full flex items-center justify-center">
          <span className="text-[10px] text-gray-600 italic">{hint}</span>
        </div>
      )}
    </div>
  </div>
);

export const RankingDetail: React.FC<{ fabStatsList: FabStats[] }> = ({ fabStatsList }) => {
  const selectedFabId = useFabStatsUIStore((s) => s.selectedFabId);

  const selected = useMemo(() => {
    if (!selectedFabId) return null;
    const idx = fabStatsList.findIndex((f) => f.fabId === selectedFabId);
    if (idx < 0) return null;
    return { fab: fabStatsList[idx], fabIndex: idx };
  }, [fabStatsList, selectedFabId]);

  if (!selected) {
    return (
      <div className="h-full flex items-center justify-center text-[12px] text-gray-500">
        Select a fab from the list.
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-3">
      {/* 현재 데이터 (Detail 전용 카드 — gauge + donuts) */}
      <div className="mb-3">
        <FabDetailCard fab={selected.fab} fabIndex={selected.fabIndex} />
      </div>

      {/* 차트 슬롯 — 채워가는 자리 */}
      <div className="grid grid-cols-2 gap-2">
        <ChartSlot title="Throughput Trend" hint="Throughput / hr — line chart (TODO)" />
        <ChartSlot title="Lead Time Distribution">
          <LeadTimeHistogram fabId={selected.fab.fabId} />
        </ChartSlot>
        <ChartSlot title="Vehicle State Over Time" hint="Stacked area chart (needs history ring buffer)" />
        <ChartSlot title="Top Congested Edges" hint="Horizontal bar — Top 10 (needs EdgeStatsTracker export)" />
      </div>
    </div>
  );
};
