import React from "react";
import { useFabStore } from "@/store/map/fabStore";
import { useCameraStore } from "@/store/ui/cameraStore";
import { useHudStyles, SectionLabel } from "./LiveKpiSection";

export interface LeaderEntry {
  fabIdx: number;
  fabId: string;
  label: string;
  strategy: string;
  throughput: number;
}

// 작은 메달 뱃지 색 (background)
const RANK_BG = ["bg-yellow-500", "bg-zinc-400", "bg-amber-700"];

const LeaderTopSection: React.FC<{ leaders: LeaderEntry[]; activeFabIdx: number }> = ({
  leaders,
  activeFabIdx,
}) => {
  const hud = useHudStyles();
  const isLight = hud.primaryText !== "text-white";

  const strategyColor: Record<string, string> = isLight
    ? { DISTANCE: "text-zinc-600", BPR: "text-sky-700", EWMA: "text-purple-700" }
    : { DISTANCE: "text-zinc-300", BPR: "text-sky-300", EWMA: "text-purple-300" };

  if (leaders.length === 0) return null;

  const handleClick = (entry: LeaderEntry) => {
    const fabs = useFabStore.getState().fabs;
    const prevFab = fabs[activeFabIdx];
    const nextFab = fabs[entry.fabIdx];
    useFabStore.getState().setActiveFabIndex(entry.fabIdx);
    if (prevFab && nextFab) {
      const dx = nextFab.centerX - prevFab.centerX;
      const dy = nextFab.centerY - prevFab.centerY;
      const { position, target, setCameraView } = useCameraStore.getState();
      setCameraView(
        [position.x + dx, position.y + dy, position.z],
        [target.x + dx, target.y + dy, target.z],
      );
    }
  };

  return (
    <div className="flex flex-col gap-1 pointer-events-auto">
      <SectionLabel>Leaders · Throughput</SectionLabel>
      <div className="flex flex-col gap-1">
        {leaders.map((entry, rank) => {
          const strategyCls = strategyColor[entry.strategy] ?? hud.dimText;
          return (
            <button
              key={entry.fabId}
              onClick={() => handleClick(entry)}
              className={`${hud.gradientClass} w-full flex items-center gap-2 px-3 py-1.5 min-w-[200px] text-left hover:brightness-125 transition`}
            >
              <span
                className={`${RANK_BG[rank]} w-5 h-5 rounded-full flex items-center justify-center font-mono text-[11px] font-bold text-white flex-shrink-0 leading-none ring-1 ring-black/30`}
              >
                {rank + 1}
              </span>
              <span
                className={`font-mono text-[11px] font-bold ${hud.primaryText} w-[28px]`}
                style={hud.textOutlineStyle}
              >
                {entry.label}
              </span>
              <span
                className={`text-[10px] uppercase tracking-wider ${strategyCls}`}
                style={hud.textOutlineStyle}
              >
                {entry.strategy}
              </span>
              <span
                className={`font-mono text-[11px] ${hud.primaryText} tabular-nums flex-1 text-right`}
                style={hud.textOutlineStyle}
              >
                {entry.throughput.toFixed(0)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default LeaderTopSection;
