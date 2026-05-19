import React from "react";
import { RankingMaster } from "./RankingMaster";
import { RankingDetail } from "./RankingDetail";
import { GroupEditor } from "./GroupEditor";
import { useFabStatsUIStore } from "./store";
import type { FabStats } from "../FabStatsPanel";

export const RankingTab: React.FC<{ fabStatsList: FabStats[] }> = ({ fabStatsList }) => {
  const viewMode = useFabStatsUIStore((s) => s.viewMode);

  return (
    <div className="h-full grid grid-cols-[260px_1fr] grid-rows-[minmax(0,1fr)] gap-2 overflow-hidden">
      <RankingMaster fabStatsList={fabStatsList} />
      {viewMode === "editor" ? (
        <GroupEditor fabStatsList={fabStatsList} />
      ) : (
        <RankingDetail fabStatsList={fabStatsList} />
      )}
    </div>
  );
};
