import { create } from "zustand";

interface NodeControlState {
  selectedNodeName: string | null;
  selectedFabIndex: number;
  isPanelOpen: boolean;

  selectNode: (nodeName: string, fabIndex?: number) => void;
  openPanel: () => void;
  closePanel: () => void;
  togglePanel: () => void;
}

export const useNodeControlStore = create<NodeControlState>((set) => ({
  selectedNodeName: null,
  selectedFabIndex: 0,
  isPanelOpen: false,

  selectNode: (nodeName: string, fabIndex: number = 0) => set({
    selectedNodeName: nodeName,
    selectedFabIndex: fabIndex,
    isPanelOpen: true
  }),
  openPanel: () => set({ isPanelOpen: true }),
  closePanel: () => set({ isPanelOpen: false, selectedNodeName: null }),
  togglePanel: () => set((state) => ({ isPanelOpen: !state.isPanelOpen })),
}));
