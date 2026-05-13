import React from "react";
import { RankingMaster } from "./RankingMaster";
import { RankingDetail } from "./RankingDetail";
import type { FabStats } from "../FabStatsPanel";

export const RankingTab: React.FC<{ fabStatsList: FabStats[] }> = ({ fabStatsList }) => {
  return (
    <div className="h-full grid grid-cols-[260px_1fr] gap-0">
      <RankingMaster fabStatsList={fabStatsList} />
      <RankingDetail fabStatsList={fabStatsList} />
    </div>
  );
};
