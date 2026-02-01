import { create } from "zustand";

interface EdgeControlState {
  selectedEdgeIndex: number | null;
  isPanelOpen: boolean;

  selectEdge: (index: number) => void;
  openPanel: () => void;
  closePanel: () => void;
  togglePanel: () => void;
}

export const useEdgeControlStore = create<EdgeControlState>((set) => ({
  selectedEdgeIndex: null,
  isPanelOpen: false,

  selectEdge: (index: number) => set({ selectedEdgeIndex: index, isPanelOpen: true }),
  openPanel: () => set({ isPanelOpen: true }),
  closePanel: () => set({ isPanelOpen: false, selectedEdgeIndex: null }),
  togglePanel: () => set((state) => ({ isPanelOpen: !state.isPanelOpen })),
}));
