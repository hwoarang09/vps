import { create } from "zustand";
import type { OrderStatsData } from "@/shmSimulator/MultiWorkerController";

export interface FabOrderStats extends OrderStatsData {
  // OrderStatsData fields inherited:
  // simulationTime, completed, throughputPerHour,
  // leadTimeP50, leadTimeP95, leadTimeMean, totalPathChanges,
  // leadTimeHistogram, leadTimeBucketSec
}

interface OrderStatsStore {
  /** fab별 최신 order 통계 (fabId → stats) */
  fabStats: Record<string, FabOrderStats>;

  /** Worker에서 수신한 order stats 업데이트 — 내부적으로 throttle batch */
  updateFabStats: (fabId: string, stats: FabOrderStats) => void;

  /** 전체 초기화 (Reset 버튼) */
  resetAll: () => void;
}

// Worker에서 fab당 ~2s 주기로 ORDER_STATS가 들어와서 16 fab이면 초당 8회 update.
// broad subscriber(FabStatsPanel, RankingMaster, LeftHud, KpiHud)가 매번 re-render되면
// 메인 스레드가 자주 막혀 Three.js RAF가 끊김. store 레벨 throttle로 batch commit:
// - 들어오는 update는 buffer에 누적
// - 마지막 flush로부터 FLUSH_INTERVAL_MS 지났으면 leading-edge commit (즉시)
// - 아니면 timer로 trailing-edge commit (남은 시간 후)
const FLUSH_INTERVAL_MS = 5000;

export const useOrderStatsStore = create<OrderStatsStore>((set) => {
  let pending: Record<string, FabOrderStats> | null = null;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let lastFlush = 0;

  const flush = () => {
    flushTimer = null;
    if (!pending) return;
    const patch = pending;
    pending = null;
    lastFlush = Date.now();
    set((state) => ({ fabStats: { ...state.fabStats, ...patch } }));
  };

  return {
    fabStats: {},

    updateFabStats: (fabId, stats) => {
      if (!pending) pending = {};
      pending[fabId] = stats;

      const elapsed = Date.now() - lastFlush;
      if (elapsed >= FLUSH_INTERVAL_MS) {
        flush();
        return;
      }
      if (flushTimer === null) {
        flushTimer = setTimeout(flush, FLUSH_INTERVAL_MS - elapsed);
      }
    },

    resetAll: () => {
      pending = null;
      if (flushTimer !== null) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      lastFlush = 0;
      set({ fabStats: {} });
    },
  };
});
