import { create } from "zustand";

interface VisualizationState {
  showPerfLeft: boolean;   // PerformanceMonitorUI (좌측 상단)
  showPerfRight: boolean;  // r3f-perf Perf (좌측 상단)
  showSensorBox: boolean;  // 차량 센서 박스 시각화

  // 라벨 토글
  showFabLabels: boolean;
  showNodeText: boolean;
  showEdgeText: boolean;
  showVehicleText: boolean;
  showStationText: boolean;
  showBayText: boolean;

  togglePerfLeft: () => void;
  togglePerfRight: () => void;
  toggleSensorBox: () => void;
  toggleFabLabels: () => void;
  toggleNodeText: () => void;
  toggleEdgeText: () => void;
  toggleVehicleText: () => void;
  toggleStationText: () => void;
  toggleBayText: () => void;
}

export const useVisualizationStore = create<VisualizationState>((set) => ({
  showPerfLeft: false,
  showPerfRight: false,
  showSensorBox: false,

  showFabLabels: false,
  showNodeText: true,
  showEdgeText: true,
  showVehicleText: true,
  showStationText: true,
  showBayText: false,

  togglePerfLeft: () => set((s) => ({ showPerfLeft: !s.showPerfLeft })),
  togglePerfRight: () => set((s) => ({ showPerfRight: !s.showPerfRight })),
  toggleSensorBox: () => set((s) => ({ showSensorBox: !s.showSensorBox })),
  toggleFabLabels: () => set((s) => ({ showFabLabels: !s.showFabLabels })),
  toggleNodeText: () => set((s) => ({ showNodeText: !s.showNodeText })),
  toggleEdgeText: () => set((s) => ({ showEdgeText: !s.showEdgeText })),
  toggleVehicleText: () => set((s) => ({ showVehicleText: !s.showVehicleText })),
  toggleStationText: () => set((s) => ({ showStationText: !s.showStationText })),
  toggleBayText: () => set((s) => ({ showBayText: !s.showBayText })),
}));
