import React from "react";
import { useFabStore } from "@/store/map/fabStore";
import { useCameraStore } from "@/store/ui/cameraStore";
import { GRADIENT_CLASS } from "./LiveKpiSection";

export interface LeaderEntry {
  fabIdx: number;
  fabId: string;
  label: string;
  strategy: string;
  throughput: number;
}

const MEDALS = ["🥇", "🥈", "🥉"];

const STRATEGY_COLOR: Record<string, string> = {
  DISTANCE: "text-zinc-400",
  BPR: "text-sky-300",
  EWMA: "text-purple-300",
};

const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    className="text-[10px] uppercase tracking-[0.18em] text-zinc-300 font-semibold pl-2"
    style={{ textShadow: "0 1px 2px rgba(0,0,0,0.85)" }}
  >
    {children}
  </div>
);

const LeaderTopSection: React.FC<{ leaders: LeaderEntry[]; activeFabIdx: number }> = ({
  leaders,
  activeFabIdx,
}) => {
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
    <div className="flex flex-col gap-1">
      <SectionLabel>Leaders · Throughput</SectionLabel>
      <div className={`${GRADIENT_CLASS} min-w-[260px] py-1 pointer-events-auto`}>
        {leaders.map((entry, rank) => {
          const strategyCls = STRATEGY_COLOR[entry.strategy] ?? "text-zinc-300";
          const isActive = entry.fabIdx === activeFabIdx;
          return (
            <button
              key={entry.fabId}
              onClick={() => handleClick(entry)}
              className={`w-full flex items-center gap-2 px-3 py-1 text-left transition-colors ${
                isActive ? "bg-cyan-500/20" : "hover:bg-white/5"
              }`}
            >
              <span className="text-base flex-shrink-0">{MEDALS[rank]}</span>
              <span
                className="font-mono text-[11px] font-bold text-white w-[28px]"
                style={{ textShadow: "0 1px 2px rgba(0,0,0,0.85)" }}
              >
                {entry.label}
              </span>
              <span
                className={`text-[10px] uppercase tracking-wider ${strategyCls}`}
                style={{ textShadow: "0 1px 2px rgba(0,0,0,0.85)" }}
              >
                {entry.strategy}
              </span>
              <span
                className="font-mono text-[11px] text-zinc-200 tabular-nums flex-1 text-right"
                style={{ textShadow: "0 1px 2px rgba(0,0,0,0.85)" }}
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
