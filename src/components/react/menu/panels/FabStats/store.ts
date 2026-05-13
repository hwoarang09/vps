import { create } from "zustand";

export const RANKING_METRICS = [
  { key: "throughput", label: "Throughput", unit: "/hr", desc: true },
  { key: "leadTimeP50", label: "Lead p50", unit: "s", desc: false },
  { key: "leadTimeP95", label: "Lead p95", unit: "s", desc: false },
  { key: "avgSpeed", label: "Avg Speed", unit: "m/s", desc: true },
  { key: "movingRate", label: "Moving %", unit: "%", desc: true },
  { key: "stoppedRate", label: "Stopped %", unit: "%", desc: false },
  { key: "collisionCount", label: "Collision", unit: "", desc: false },
  { key: "completed", label: "Completed", unit: "", desc: true },
] as const;

export type RankingMetricKey = typeof RANKING_METRICS[number]["key"];

type SortOrder = "asc" | "desc";

interface FabStatsUIStore {
  rankingSortBy: RankingMetricKey;
  rankingSortOrder: SortOrder;
  selectedFabId: string | null;

  setRankingSortBy: (key: RankingMetricKey) => void;
  toggleRankingSortOrder: () => void;
  setSelectedFabId: (id: string | null) => void;
}

export const useFabStatsUIStore = create<FabStatsUIStore>((set) => ({
  rankingSortBy: "throughput",
  rankingSortOrder: "desc",
  selectedFabId: null,

  setRankingSortBy: (key) =>
    set((state) => {
      const metric = RANKING_METRICS.find((m) => m.key === key);
      const defaultOrder: SortOrder = metric?.desc ? "desc" : "asc";
      return {
        rankingSortBy: key,
        rankingSortOrder: state.rankingSortBy === key ? state.rankingSortOrder : defaultOrder,
      };
    }),

  toggleRankingSortOrder: () =>
    set((state) => ({ rankingSortOrder: state.rankingSortOrder === "desc" ? "asc" : "desc" })),

  setSelectedFabId: (id) => set({ selectedFabId: id }),
}));
