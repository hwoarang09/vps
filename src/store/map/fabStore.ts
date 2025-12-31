import { create } from "zustand";

/**
 * Fab 정보 (각 fab의 bounds, center)
 */
export interface FabInfo {
  fabIndex: number;
  col: number;
  row: number;
  // Bounds
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  // Center point (카메라 거리 계산용)
  centerX: number;
  centerY: number;
}

interface FabStore {
  // Fab grid 설정
  fabCountX: number;
  fabCountY: number;
  // 각 fab의 정보
  fabs: FabInfo[];
  // 현재 활성 fab index (-1 = none)
  activeFabIndex: number;

  // Actions
  setFabGrid: (countX: number, countY: number, fabs: FabInfo[]) => void;
  setActiveFabIndex: (index: number) => void;
  clearFabs: () => void;

  // Utility
  findNearestFab: (x: number, y: number) => number;
}

export const useFabStore = create<FabStore>((set, get) => ({
  fabCountX: 1,
  fabCountY: 1,
  fabs: [],
  activeFabIndex: 0,

  setFabGrid: (countX, countY, fabs) => {
    set({ fabCountX: countX, fabCountY: countY, fabs });
  },

  setActiveFabIndex: (index) => {
    set({ activeFabIndex: index });
  },

  clearFabs: () => {
    set({ fabCountX: 1, fabCountY: 1, fabs: [], activeFabIndex: 0 });
  },

  /**
   * 주어진 좌표에서 가장 가까운 fab의 index 반환
   */
  findNearestFab: (x: number, y: number): number => {
    const { fabs } = get();
    if (fabs.length === 0) return -1;
    if (fabs.length === 1) return 0;

    let nearestIdx = 0;
    let nearestDistSq = Infinity;

    for (let i = 0; i < fabs.length; i++) {
      const fab = fabs[i];
      const dx = x - fab.centerX;
      const dy = y - fab.centerY;
      const distSq = dx * dx + dy * dy;

      if (distSq < nearestDistSq) {
        nearestDistSq = distSq;
        nearestIdx = i;
      }
    }

    return nearestIdx;
  },
}));
