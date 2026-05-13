import React from "react";
import { RankingMaster } from "./RankingMaster";
import { RankingDetail } from "./RankingDetail";
import type { FabStats } from "../FabStatsPanel";

export const RankingTab: React.FC<{ fabStatsList: FabStats[] }> = ({ fabStatsList }) => {
  return (
    <div className="h-full grid grid-cols-[260px_1fr] grid-rows-[minmax(0,1fr)] gap-2 overflow-hidden">
      <RankingMaster fabStatsList={fabStatsList} />
      <RankingDetail fabStatsList={fabStatsList} />
    </div>
  );
};
