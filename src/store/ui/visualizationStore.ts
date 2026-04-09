import { create } from "zustand";

interface VisualizationState {
  showPerfLeft: boolean;   // PerformanceMonitorUI (좌측 상단)
  showPerfRight: boolean;  // r3f-perf Perf (좌측 상단)
  showSensorBox: boolean;  // 차량 센서 박스 시각화

  togglePerfLeft: () => void;
  togglePerfRight: () => void;
  toggleSensorBox: () => void;
}

export const useVisualizationStore = create<VisualizationState>((set) => ({
  showPerfLeft: false,
  showPerfRight: false,
  showSensorBox: false,

  togglePerfLeft: () => set((s) => ({ showPerfLeft: !s.showPerfLeft })),
  togglePerfRight: () => set((s) => ({ showPerfRight: !s.showPerfRight })),
  toggleSensorBox: () => set((s) => ({ showSensorBox: !s.showSensorBox })),
}));
