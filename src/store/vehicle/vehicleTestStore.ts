import { create } from "zustand";
import { VehicleSystemType } from "@/types/vehicle";

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

  // Actions
  startTest: (mode: VehicleSystemType, numVehicles?: number, useVehicleConfig?: boolean) => void;
  stopTest: () => void;
  setNumVehicles: (num: number) => void;
  setPanelVisible: (visible: boolean) => void;
  setPaused: (paused: boolean) => void;
  setInitialVehicleDistribution: (distribution: Map<number, number[]>) => void;
}

export const useVehicleTestStore = create<VehicleTestState>((set) => ({
  isTestActive: false,
  testMode: null,
  numVehicles: 50,
  isPanelVisible: true,
  isPaused: true, // Start paused by default
  initialVehicleDistribution: null,
  useVehicleConfig: false,

  startTest: (mode: VehicleSystemType, numVehicles = 50, useVehicleConfig = false) => {
    console.log(`[VehicleTestStore] Starting test: ${mode} with ${numVehicles} vehicles (useVehicleConfig: ${useVehicleConfig})`);
    set({ isTestActive: true, testMode: mode, numVehicles, isPanelVisible: true, isPaused: true, useVehicleConfig });
  },

  stopTest: () => {
    console.log("[VehicleTestStore] Stopping test");
    set({ isTestActive: false, testMode: null, isPanelVisible: true, isPaused: true, initialVehicleDistribution: null, useVehicleConfig: false });
  },

  setNumVehicles: (num: number) => {
    set({ numVehicles: num });
  },

  setPanelVisible: (visible: boolean) => {
    set({ isPanelVisible: visible });
  },

  setPaused: (paused: boolean) => {
    console.log(`[VehicleTestStore] ${paused ? 'Pausing' : 'Resuming'} simulation`);
    set({ isPaused: paused });
  },

  setInitialVehicleDistribution: (distribution: Map<number, number[]>) => {
    set({ initialVehicleDistribution: distribution });
  },
}));

