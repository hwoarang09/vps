import { create } from "zustand";

interface VisualizationState {
  showPerfLeft: boolean;   // PerformanceMonitorUI (좌측 상단)
  showPerfRight: boolean;  // r3f-perf Perf (좌측 상단)

  togglePerfLeft: () => void;
  togglePerfRight: () => void;
}

export const useVisualizationStore = create<VisualizationState>((set) => ({
  showPerfLeft: false,
  showPerfRight: false,

  togglePerfLeft: () => set((s) => ({ showPerfLeft: !s.showPerfLeft })),
  togglePerfRight: () => set((s) => ({ showPerfRight: !s.showPerfRight })),
}));
