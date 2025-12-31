// shmSimulatorStore.ts
// Zustand store for managing ShmSimulatorController instance

import { create } from "zustand";
import { ShmSimulatorController, createDefaultConfig, TransferMode } from "@/shmSimulator";
import type { SimulationConfig, VehicleInitConfig } from "@/shmSimulator";
import type { Edge } from "@/types/edge";
import type { Node } from "@/types";
import {
  VEHICLE_DATA_SIZE,
  MovementData,
} from "@/shmSimulator/memory/vehicleDataArray";
import { getMaxDelta } from "@/config/movementConfig";

interface ShmSimulatorState {
  // Controller instance
  controller: ShmSimulatorController | null;

  // State
  isInitialized: boolean;
  isRunning: boolean;
  actualNumVehicles: number;
  workerAvgMs: number;

  // Actions
  init: (params: {
    edges: Edge[];
    nodes: Node[];
    numVehicles: number;
    vehicleConfigs?: VehicleInitConfig[];
    config?: Partial<SimulationConfig>;
    transferMode?: typeof TransferMode[keyof typeof TransferMode]; // LOOP=0, RANDOM=1
  }) => Promise<void>;

  start: () => void;
  stop: () => void;
  pause: () => void;
  resume: () => void;
  dispose: () => void;

  // Data access
  getVehicleData: () => Float32Array | null;
  getSensorPointData: () => Float32Array | null;
  getVehiclePosition: (index: number) => { x: number; y: number; z: number; rotation: number } | null;
}

export const useShmSimulatorStore = create<ShmSimulatorState>((set, get) => ({
  controller: null,
  isInitialized: false,
  isRunning: false,
  actualNumVehicles: 0,
  workerAvgMs: 0,

  init: async (params) => {
    const { edges, nodes, numVehicles, vehicleConfigs = [], config = {}, transferMode = TransferMode.RANDOM } = params;

    // Dispose existing controller if any
    const existing = get().controller;
    if (existing) {
      console.log("[ShmSimulatorStore] Disposing existing controller...");
      existing.dispose();
    }

    console.log(`[ShmSimulatorStore] Creating new controller... (transferMode=${transferMode === 0 ? 'LOOP' : 'RANDOM'})`);
    const controller = new ShmSimulatorController();

    // Set up performance stats callback
    controller.onPerfStats((avgStepMs) => {
      set({ workerAvgMs: avgStepMs });
    });

    try {
      await controller.init({
        edges,
        nodes,
        numVehicles,
        vehicleConfigs,
        config: { ...createDefaultConfig(), maxDelta: getMaxDelta(), ...config },
        transferMode,
      });

      set({
        controller,
        isInitialized: true,
        isRunning: false,
        actualNumVehicles: controller.getActualNumVehicles(),
      });

      console.log(`[ShmSimulatorStore] Initialized with ${controller.getActualNumVehicles()} vehicles`);
    } catch (error) {
      console.error("[ShmSimulatorStore] Init failed:", error);
      set({
        controller: null,
        isInitialized: false,
        isRunning: false,
        actualNumVehicles: 0,
      });
      throw error;
    }
  },

  start: () => {
    const { controller } = get();
    if (controller && get().isInitialized) {
      console.log("[ShmSimulatorStore] Starting simulation...");
      controller.start();
      set({ isRunning: true });
    }
  },

  stop: () => {
    const { controller } = get();
    if (controller) {
      console.log("[ShmSimulatorStore] Stopping simulation...");
      controller.stop();
      set({ isRunning: false });
    }
  },

  pause: () => {
    const { controller } = get();
    if (controller) {
      console.log("[ShmSimulatorStore] Pausing simulation...");
      controller.pause();
      set({ isRunning: false });
    }
  },

  resume: () => {
    const { controller } = get();
    if (controller && get().isInitialized) {
      console.log("[ShmSimulatorStore] Resuming simulation...");
      controller.resume();
      set({ isRunning: true });
    }
  },

  dispose: () => {
    const { controller } = get();
    if (controller) {
      console.log("[ShmSimulatorStore] Disposing controller...");
      controller.dispose();
    }
    set({
      controller: null,
      isInitialized: false,
      isRunning: false,
      actualNumVehicles: 0,
      workerAvgMs: 0,
    });
  },

  getVehicleData: () => {
    const { controller } = get();
    if (!controller) return null;
    return controller.getVehicleData();
  },

  getSensorPointData: () => {
    const { controller } = get();
    if (!controller) return null;
    return controller.getSensorPointData();
  },

  getVehiclePosition: (index: number) => {
    const { controller } = get();
    if (!controller) return null;

    const data = controller.getVehicleData();
    if (!data) return null;

    const ptr = index * VEHICLE_DATA_SIZE;
    return {
      x: data[ptr + MovementData.X],
      y: data[ptr + MovementData.Y],
      z: data[ptr + MovementData.Z],
      rotation: data[ptr + MovementData.ROTATION],
    };
  },
}));

// Helper hook for accessing vehicle data in render loop
export function getShmVehicleData(): Float32Array | null {
  return useShmSimulatorStore.getState().getVehicleData();
}

export function getShmSensorPointData(): Float32Array | null {
  return useShmSimulatorStore.getState().getSensorPointData();
}

export function getShmVehiclePosition(index: number) {
  return useShmSimulatorStore.getState().getVehiclePosition(index);
}
