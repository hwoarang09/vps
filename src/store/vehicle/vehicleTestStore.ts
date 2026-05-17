import { create } from "zustand";
import { VehicleSystemType } from "@/types/vehicle";
import { getDefaultSetting } from "@/config/react/testSettingConfig";

/**
 * Vehicle Test Store
 * - Manages vehicle test state
 * - Controls which test mode is active
 * - Controls simulation play/pause state
 */

interface VehicleTestState {
  isTestActive: boolean;
  testMode: VehicleSystemType | null;
  numVehicles: number;
  isPanelVisible: boolean;
  isPaused: boolean; // Simulation pause state
  initialVehicleDistribution: Map<number, number[]> | null; // Edge index -> vehicle indices
  useVehicleConfig: boolean; // If true, use vehicles.cfg; if false, use numVehicles
  selectedSettingId: string; // Current test setting ID (shared with Operation panel)
  settingChangeSeq: number; // Increment to trigger reload
  recreateSeq: number; // Increment to trigger vehicle delete+create (즉시 적용용)

  // Actions
  startTest: (mode: VehicleSystemType, numVehicles?: number, useVehicleConfig?: boolean) => void;
  stopTest: () => void;
  setNumVehicles: (num: number) => void;
  setPanelVisible: (visible: boolean) => void;
  setPaused: (paused: boolean) => void;
  setInitialVehicleDistribution: (distribution: Map<number, number[]>) => void;
  requestSettingChange: (settingId: string) => void;
  /** 차량 삭제 후 재생성 요청 (Veh 패널 변경 즉시 적용) */
  requestRecreate: () => void;
}

export const useVehicleTestStore = create<VehicleTestState>((set) => ({
  isTestActive: false,
  testMode: null,
  numVehicles: 50,
  isPanelVisible: true,
  isPaused: true, // Start paused by default
  initialVehicleDistribution: null,
  useVehicleConfig: false,
  selectedSettingId: getDefaultSetting(),
  settingChangeSeq: 0,
  recreateSeq: 0,

  startTest: (mode: VehicleSystemType, numVehicles = 50, useVehicleConfig = false) => {
    set({ isTestActive: true, testMode: mode, numVehicles, isPanelVisible: true, isPaused: true, useVehicleConfig });
  },

  stopTest: () => {
    set({ isTestActive: false, testMode: null, isPanelVisible: true, isPaused: true, initialVehicleDistribution: null, useVehicleConfig: false });
  },

  setNumVehicles: (num: number) => {
    set({ numVehicles: num });
  },

  setPanelVisible: (visible: boolean) => {
    set({ isPanelVisible: visible });
  },

  setPaused: (paused: boolean) => {
    set({ isPaused: paused });
  },

  setInitialVehicleDistribution: (distribution: Map<number, number[]>) => {
    set({ initialVehicleDistribution: distribution });
  },

  requestSettingChange: (settingId: string) => {
    set((state) => ({
      selectedSettingId: settingId,
      settingChangeSeq: state.settingChangeSeq + 1,
    }));
  },

  requestRecreate: () => {
    set((state) => ({ recreateSeq: state.recreateSeq + 1 }));
  },
}));

