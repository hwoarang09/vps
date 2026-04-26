import { create } from "zustand";
import type { OrderStatsData } from "@/shmSimulator/MultiWorkerController";

export interface FabOrderStats extends OrderStatsData {
  // OrderStatsData fields inherited:
  // simulationTime, completed, throughputPerHour,
  // leadTimeP50, leadTimeP95, leadTimeMean, totalPathChanges
}

interface OrderStatsStore {
  /** fab별 최신 order 통계 (fabId → stats) */
  fabStats: Record<string, FabOrderStats>;

  /** Worker에서 수신한 order stats 업데이트 */
  updateFabStats: (fabId: string, stats: FabOrderStats) => void;

  /** 전체 초기화 (Reset 버튼) */
  resetAll: () => void;
}

export const useOrderStatsStore = create<OrderStatsStore>((set) => ({
  fabStats: {},

  updateFabStats: (fabId, stats) =>
    set((state) => ({
      fabStats: { ...state.fabStats, [fabId]: stats },
    })),

  resetAll: () => set({ fabStats: {} }),
}));
