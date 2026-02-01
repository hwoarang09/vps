import { create } from "zustand";

interface EdgeControlState {
  selectedEdgeIndex: number | null;
  selectedFabIndex: number;  // Which fab the selected edge belongs to
  isPanelOpen: boolean;

  selectEdge: (index: number, fabIndex?: number) => void;
  openPanel: () => void;
  closePanel: () => void;
  togglePanel: () => void;
}

export const useEdgeControlStore = create<EdgeControlState>((set) => ({
  selectedEdgeIndex: null,
  selectedFabIndex: 0,
  isPanelOpen: false,

  selectEdge: (index: number, fabIndex: number = 0) => set({
    selectedEdgeIndex: index,
    selectedFabIndex: fabIndex,
    isPanelOpen: true
  }),
  openPanel: () => set({ isPanelOpen: true }),
  closePanel: () => set({ isPanelOpen: false, selectedEdgeIndex: null }),
  togglePanel: () => set((state) => ({ isPanelOpen: !state.isPanelOpen })),
}));
