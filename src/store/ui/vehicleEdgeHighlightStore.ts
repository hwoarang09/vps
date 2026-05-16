import { create } from "zustand";

interface VehicleEdgeHighlightState {
  /** 현재 edge index (1-based SHM index), null이면 하이라이트 없음 */
  currentEdgeIndex: number | null;
  /** 다음 edge index (1-based SHM index, NEXT_EDGE_0) */
  nextEdgeIndex: number | null;
  /** 경로 edge indices (1-based, current/next 제외한 나머지) */
  pathEdgeIndices: number[];
  /** 목적지 edge index (1-based). 경로 마지막 edge — 이 edge는 destRatio까지만 그림 */
  destEdgeIndex: number | null;
  /** 목적지 station의 edge 상 위치 (0~1). 1이면 edge 전체를 그림 */
  destRatio: number;

  setCurrentEdge: (edgeIndex: number | null) => void;
  setNextEdge: (edgeIndex: number | null) => void;
  setPathEdges: (indices: number[]) => void;
  setDestination: (edgeIndex: number | null, ratio: number) => void;
  clear: () => void;
}

export const useVehicleEdgeHighlightStore = create<VehicleEdgeHighlightState>((set) => ({
  currentEdgeIndex: null,
  nextEdgeIndex: null,
  pathEdgeIndices: [],
  destEdgeIndex: null,
  destRatio: 1,

  setCurrentEdge: (edgeIndex) => set({ currentEdgeIndex: edgeIndex }),
  setNextEdge: (edgeIndex) => set({ nextEdgeIndex: edgeIndex }),
  setPathEdges: (indices) => set({ pathEdgeIndices: indices }),
  setDestination: (edgeIndex, ratio) => set({ destEdgeIndex: edgeIndex, destRatio: ratio }),
  clear: () => set({
    currentEdgeIndex: null,
    nextEdgeIndex: null,
    pathEdgeIndices: [],
    destEdgeIndex: null,
    destRatio: 1,
  }),
}));
