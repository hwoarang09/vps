import { create } from "zustand";

interface VehicleEdgeHighlightState {
  /** 현재 edge index (1-based SHM index), null이면 하이라이트 없음 */
  currentEdgeIndex: number | null;
  /** 다음 edge index (1-based SHM index, NEXT_EDGE_0) */
  nextEdgeIndex: number | null;

  setCurrentEdge: (edgeIndex: number | null) => void;
  setNextEdge: (edgeIndex: number | null) => void;
  clear: () => void;
}

export const useVehicleEdgeHighlightStore = create<VehicleEdgeHighlightState>((set) => ({
  currentEdgeIndex: null,
  nextEdgeIndex: null,

  setCurrentEdge: (edgeIndex) => set({ currentEdgeIndex: edgeIndex }),
  setNextEdge: (edgeIndex) => set({ nextEdgeIndex: edgeIndex }),
  clear: () => set({ currentEdgeIndex: null, nextEdgeIndex: null }),
}));
