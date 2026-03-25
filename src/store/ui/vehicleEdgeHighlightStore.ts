import { create } from "zustand";

interface VehicleEdgeHighlightState {
  /** 현재 edge index (1-based SHM index), null이면 하이라이트 없음 */
  currentEdgeIndex: number | null;

  setCurrentEdge: (edgeIndex: number | null) => void;
  clear: () => void;
}

export const useVehicleEdgeHighlightStore = create<VehicleEdgeHighlightState>((set) => ({
  currentEdgeIndex: null,

  setCurrentEdge: (edgeIndex) => set({ currentEdgeIndex: edgeIndex }),
  clear: () => set({ currentEdgeIndex: null }),
}));
