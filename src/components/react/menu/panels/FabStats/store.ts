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

export type TimingKey = "lead" | "waiting" | "delivery";
export type DetailTabKey = "distribution" | "parameters";

// ─── Fab Group ───

const GROUP_COLORS = [
  "#4ecdc4", "#f59e0b", "#8b5cf6", "#ef4444", "#22c55e",
  "#3b82f6", "#ec4899", "#14b8a6", "#f97316", "#6366f1",
];

export interface FabGroup {
  id: string;
  name: string;
  fabIndices: number[];
  color: string;
}

export type ViewMode = "individual" | "group" | "editor";

// ─── Store ───

interface FabStatsUIStore {
  rankingSortBy: RankingMetricKey;
  rankingSortOrder: SortOrder;
  selectedFabId: string | null;
  detailTab: DetailTabKey;
  selectedTiming: TimingKey;

  // Group
  fabGroups: FabGroup[];
  viewMode: ViewMode;
  selectedGroupId: string | null;

  setRankingSortBy: (key: RankingMetricKey) => void;
  toggleRankingSortOrder: () => void;
  setSelectedFabId: (id: string | null) => void;
  setDetailTab: (tab: DetailTabKey) => void;
  setSelectedTiming: (timing: TimingKey) => void;

  // Group actions
  setViewMode: (mode: ViewMode) => void;
  setSelectedGroupId: (id: string | null) => void;
  addFabGroup: (name: string, fabIndices: number[]) => void;
  removeFabGroup: (id: string) => void;
  setFabGroups: (groups: FabGroup[]) => void;
}

let groupIdCounter = 0;

export const useFabStatsUIStore = create<FabStatsUIStore>((set, get) => ({
  rankingSortBy: "throughput",
  rankingSortOrder: "desc",
  selectedFabId: null,
  detailTab: "distribution",
  selectedTiming: "lead",

  fabGroups: [],
  viewMode: "individual",
  selectedGroupId: null,

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
  setDetailTab: (tab) => set({ detailTab: tab }),
  setSelectedTiming: (timing) => set({ selectedTiming: timing }),

  setViewMode: (mode) => set({ viewMode: mode }),
  setSelectedGroupId: (id) => set({ selectedGroupId: id }),

  addFabGroup: (name, fabIndices) => {
    const groups = get().fabGroups;
    const color = GROUP_COLORS[groups.length % GROUP_COLORS.length];
    const id = `grp-${++groupIdCounter}`;
    set({ fabGroups: [...groups, { id, name, fabIndices, color }] });
  },

  removeFabGroup: (id) =>
    set((state) => ({
      fabGroups: state.fabGroups.filter((g) => g.id !== id),
      selectedGroupId: state.selectedGroupId === id ? null : state.selectedGroupId,
    })),

  setFabGroups: (groups) => set({ fabGroups: groups }),
}));
