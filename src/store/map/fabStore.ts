import { create } from "zustand";
import type { Node, Edge } from "@/types";
import type { Station } from "./stationStore";
import { renderConfig } from "@/config/testSettingConfig";

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

/**
 * 개별 Fab의 렌더링 데이터
 */
export interface FabRenderData {
  fabIndex: number;
  nodes: Node[];
  edges: Edge[];
  stations: Station[];
}

/**
 * 렌더링 슬롯 (25개 고정, 각각 다른 fab 위치를 표시)
 */
export interface RenderSlot {
  slotId: number;
  fabIndex: number;  // 현재 표시 중인 fab (-1이면 미사용)
  offsetX: number;   // fab 위치로 이동하기 위한 x offset
  offsetY: number;   // fab 위치로 이동하기 위한 y offset
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

  // 카메라 거리 기반 가시 fab (성능 최적화)
  visibleFabIndices: Set<number>;

  // 렌더링 슬롯 (25개 고정, 원본 데이터 + offset으로 각 fab 위치 표시)
  slots: RenderSlot[];
  // 슬롯 업데이트 버전 (변경 감지용)
  slotsVersion: number;

  // Actions
  setFabGrid: (countX: number, countY: number, fabs: FabInfo[]) => void;
  setOriginalMapData: (data: OriginalMapData) => void;
  setActiveFabIndex: (index: number) => void;
  clearFabs: () => void;
  updateVisibleFabs: (cameraX: number, cameraY: number) => void;
  // 슬롯 초기화 (fab 생성 후 호출)
  initSlots: () => void;
  // 카메라 이동 시 슬롯 offset 업데이트
  updateSlots: (cameraX: number, cameraY: number) => void;

  // Utility
  findNearestFab: (x: number, y: number) => number;
  isMultiFab: () => boolean;
  isFabVisible: (fabIndex: number) => boolean;
}

export const useFabStore = create<FabStore>((set, get) => ({
  fabCountX: 1,
  fabCountY: 1,
  fabs: [],
  activeFabIndex: 0,
  originalMapData: null,
  visibleFabIndices: new Set<number>(),
  slots: [],
  slotsVersion: 0,

  setFabGrid: (countX, countY, fabs) => {
    // maxVisibleFabs 개수만큼만 visible로 설정 (또는 전체가 더 적으면 전체)
    const maxVisible = Math.min(renderConfig.maxVisibleFabs, fabs.length);
    const initialVisible = new Set(fabs.slice(0, maxVisible).map(f => f.fabIndex));
    set({ fabCountX: countX, fabCountY: countY, fabs, visibleFabIndices: initialVisible });
  },

  setOriginalMapData: (data) => {
    set({ originalMapData: data });
  },

  setActiveFabIndex: (index) => {
    set({ activeFabIndex: index });
  },

  /**
   * 카메라 위치 기반으로 가시 fab 업데이트
   * 가장 가까운 maxVisibleFabs 개의 fab만 visible로 설정
   */
  updateVisibleFabs: (cameraX: number, cameraY: number) => {
    const { fabs, visibleFabIndices } = get();
    if (fabs.length <= 1) return; // 단일 fab이면 스킵

    const maxVisible = renderConfig.maxVisibleFabs;

    // 모든 fab을 카메라 거리순으로 정렬
    const fabsWithDist = fabs.map(fab => {
      const dx = cameraX - fab.centerX;
      const dy = cameraY - fab.centerY;
      return { fabIndex: fab.fabIndex, distSq: dx * dx + dy * dy };
    });
    fabsWithDist.sort((a, b) => a.distSq - b.distSq);

    // 가장 가까운 maxVisible 개만 선택
    const nearestFabIndices = fabsWithDist.slice(0, maxVisible).map(f => f.fabIndex);
    const newVisible = new Set(nearestFabIndices);

    // 변경된 경우에만 업데이트 (re-render 최소화)
    if (newVisible.size !== visibleFabIndices.size ||
        [...newVisible].some(idx => !visibleFabIndices.has(idx))) {
      set({ visibleFabIndices: newVisible });
    }
  },

  /**
   * 슬롯 초기화 (fab 생성 후 호출)
   * maxVisibleFabs 개의 슬롯을 생성하고 초기 fab 할당
   */
  initSlots: () => {
    const { fabs } = get();
    if (fabs.length === 0) return;

    const maxSlots = Math.min(renderConfig.maxVisibleFabs, fabs.length);

    // fab 0을 기준으로 offset 계산
    const fab0 = fabs.find(f => f.fabIndex === 0);
    if (!fab0) return;

    const newSlots: RenderSlot[] = [];
    for (let i = 0; i < maxSlots; i++) {
      const fab = fabs[i];
      newSlots.push({
        slotId: i,
        fabIndex: fab.fabIndex,
        offsetX: fab.centerX - fab0.centerX,
        offsetY: fab.centerY - fab0.centerY,
      });
    }

    set({ slots: newSlots, slotsVersion: 1 });
  },

  /**
   * 카메라 이동 시 슬롯 offset 업데이트
   * 먼 슬롯을 카메라에 가까운 fab 위치로 재할당
   */
  updateSlots: (cameraX: number, cameraY: number) => {
    const { fabs, slots, slotsVersion } = get();
    if (fabs.length <= 1 || slots.length === 0) return;

    const maxSlots = slots.length;

    // fab 0 기준점
    const fab0 = fabs.find(f => f.fabIndex === 0);
    if (!fab0) return;

    // 모든 fab을 카메라 거리순으로 정렬
    const fabsWithDist = fabs.map(fab => {
      const dx = cameraX - fab.centerX;
      const dy = cameraY - fab.centerY;
      return { fab, distSq: dx * dx + dy * dy };
    });
    fabsWithDist.sort((a, b) => a.distSq - b.distSq);

    // 가장 가까운 maxSlots개 fab 선택
    const nearestFabs = fabsWithDist.slice(0, maxSlots).map(f => f.fab);

    // 현재 슬롯에 할당된 fabIndex들
    const currentFabIndices = new Set(slots.map(s => s.fabIndex));
    const newFabIndices = new Set(nearestFabs.map(f => f.fabIndex));

    // 변경이 없으면 스킵
    if (currentFabIndices.size === newFabIndices.size &&
        [...currentFabIndices].every(idx => newFabIndices.has(idx))) {
      return;
    }

    // 새 슬롯 배열 생성
    const newSlots: RenderSlot[] = nearestFabs.map((fab, i) => ({
      slotId: i,
      fabIndex: fab.fabIndex,
      offsetX: fab.centerX - fab0.centerX,
      offsetY: fab.centerY - fab0.centerY,
    }));

    set({ slots: newSlots, slotsVersion: slotsVersion + 1 });
  },

  clearFabs: () => {
    set({
      fabCountX: 1,
      fabCountY: 1,
      fabs: [],
      activeFabIndex: 0,
      originalMapData: null,
      visibleFabIndices: new Set<number>(),
      slots: [],
      slotsVersion: 0,
    });
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

  /**
   * 특정 fab이 현재 가시 상태인지 확인
   */
  isFabVisible: (fabIndex: number): boolean => {
    const { visibleFabIndices, fabs } = get();
    // 단일 fab이면 항상 visible
    if (fabs.length <= 1) return true;
    return visibleFabIndices.has(fabIndex);
  },
}));
