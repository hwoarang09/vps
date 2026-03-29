import { create } from "zustand";

interface VehicleEdgeHighlightState {
  /** 현재 edge index (1-based SHM index), null이면 하이라이트 없음 */
  currentEdgeIndex: number | null;
  /** 다음 edge index (1-based SHM index, NEXT_EDGE_0) */
  nextEdgeIndex: number | null;
  /** 경로 edge indices (1-based, current/next 제외한 나머지) */
  pathEdgeIndices: number[];

  setCurrentEdge: (edgeIndex: number | null) => void;
  setNextEdge: (edgeIndex: number | null) => void;
  setPathEdges: (indices: number[]) => void;
  clear: () => void;
}

export const useVehicleEdgeHighlightStore = create<VehicleEdgeHighlightState>((set) => ({
  currentEdgeIndex: null,
  nextEdgeIndex: null,
  pathEdgeIndices: [],

  setCurrentEdge: (edgeIndex) => set({ currentEdgeIndex: edgeIndex }),
  setNextEdge: (edgeIndex) => set({ nextEdgeIndex: edgeIndex }),
  setPathEdges: (indices) => set({ pathEdgeIndices: indices }),
  clear: () => set({ currentEdgeIndex: null, nextEdgeIndex: null, pathEdgeIndices: [] }),
}));
