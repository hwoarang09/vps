import { create } from "zustand";
import type { Node, Edge } from "@/types";
import type { Station } from "./stationStore";

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

/**
 * 원본 맵 데이터 (멀티 워커용)
 * FAB Create 전의 원본 데이터를 저장
 */
export interface OriginalMapData {
  nodes: Node[];
  edges: Edge[];
  stations: Station[];
}

interface FabStore {
  // Fab grid 설정
  fabCountX: number;
  fabCountY: number;
  // 각 fab의 정보
  fabs: FabInfo[];
  // 현재 활성 fab index (-1 = none)
  activeFabIndex: number;

  // 원본 맵 데이터 (멀티 워커용)
  originalMapData: OriginalMapData | null;

  // Actions
  setFabGrid: (countX: number, countY: number, fabs: FabInfo[]) => void;
  setOriginalMapData: (data: OriginalMapData) => void;
  setActiveFabIndex: (index: number) => void;
  clearFabs: () => void;

  // Utility
  findNearestFab: (x: number, y: number) => number;
  isMultiFab: () => boolean;
}

export const useFabStore = create<FabStore>((set, get) => ({
  fabCountX: 1,
  fabCountY: 1,
  fabs: [],
  activeFabIndex: 0,
  originalMapData: null,

  setFabGrid: (countX, countY, fabs) => {
    set({ fabCountX: countX, fabCountY: countY, fabs });
  },

  setOriginalMapData: (data) => {
    set({ originalMapData: data });
  },

  setActiveFabIndex: (index) => {
    set({ activeFabIndex: index });
  },

  clearFabs: () => {
    set({ fabCountX: 1, fabCountY: 1, fabs: [], activeFabIndex: 0, originalMapData: null });
  },

  /**
   * 멀티 Fab 여부 확인
   */
  isMultiFab: (): boolean => {
    const { fabCountX, fabCountY } = get();
    return fabCountX * fabCountY > 1;
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
