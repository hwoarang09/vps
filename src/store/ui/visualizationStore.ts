import { create } from "zustand";

interface VisualizationState {
  showPerfLeft: boolean;   // PerformanceMonitorUI (좌측 하단)
  showPerfRight: boolean;  // r3f-perf Perf (우측 하단)

  togglePerfLeft: () => void;
  togglePerfRight: () => void;
}

export const useVisualizationStore = create<VisualizationState>((set) => ({
  showPerfLeft: true,
  showPerfRight: true,

  togglePerfLeft: () => set((s) => ({ showPerfLeft: !s.showPerfLeft })),
  togglePerfRight: () => set((s) => ({ showPerfRight: !s.showPerfRight })),
}));
