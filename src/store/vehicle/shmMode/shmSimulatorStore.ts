// shmSimulatorStore.ts
// Zustand store for managing ShmSimulatorController instance

import { create } from "zustand";
import { ShmSimulatorController, createDefaultConfig, TransferMode } from "@/shmSimulator";
import type { SimulationConfig, VehicleInitConfig, FabInitParams } from "@/shmSimulator";
import type { Edge } from "@/types/edge";
import type { Node } from "@/types";
import {
  VEHICLE_DATA_SIZE,
  MovementData,
} from "@/common/vehicle/memory/VehicleDataArrayBase";
import { getMaxDelta } from "@/config/movementConfig";

// 기본 fabId (단일 fab 호환용)
const DEFAULT_FAB_ID = "default";

interface ShmSimulatorState {
  // Controller instance
  controller: ShmSimulatorController | null;

  // State
  isInitialized: boolean;
  isRunning: boolean;
  // 하위 호환성 - 기본 fab의 비히클 수 (deprecated: use fabVehicleCounts or getActualNumVehicles)
  actualNumVehicles: number;
  // Fab별 비히클 수
  fabVehicleCounts: Record<string, number>;
  workerAvgMs: number;
  workerMinMs: number;
  workerMaxMs: number;

  // Actions - 단일 fab 호환 API
  init: (params: {
    edges: Edge[];
    nodes: Node[];
    numVehicles: number;
    vehicleConfigs?: VehicleInitConfig[];
    config?: Partial<SimulationConfig>;
    transferMode?: TransferMode;
    stations: ReadonlyArray<unknown>;
    fabId?: string;
  }) => Promise<void>;

  // Actions - 멀티 fab API
  initMultiFab: (params: {
    fabs: FabInitParams[];
    config?: Partial<SimulationConfig>;
  }) => Promise<void>;

  addFab: (params: FabInitParams) => Promise<number>;
  removeFab: (fabId: string) => Promise<void>;

  start: () => void;
  stop: () => void;
  pause: () => void;
  resume: () => void;
  dispose: () => void;

  // Data access - 단일 fab 호환 API (기본 fabId 사용)
  getVehicleData: (fabId?: string) => Float32Array | null;
  getSensorPointData: (fabId?: string) => Float32Array | null;
  getVehiclePosition: (index: number, fabId?: string) => { x: number; y: number; z: number; rotation: number } | null;
  getActualNumVehicles: (fabId?: string) => number;

  // Fab 관리
  getFabIds: () => string[];
  getTotalVehicleCount: () => number;

  sendCommand: (payload: unknown, fabId?: string) => void;
}

export const useShmSimulatorStore = create<ShmSimulatorState>((set, get) => ({
  controller: null,
  isInitialized: false,
  isRunning: false,
  actualNumVehicles: 0,
  fabVehicleCounts: {},
  workerAvgMs: 0,
  workerMinMs: 0,
  workerMaxMs: 0,

  // 단일 fab 초기화 (하위 호환성)
  init: async (params) => {
    const {
      edges,
      nodes,
      stations,
      numVehicles,
      vehicleConfigs = [],
      config = {},
      transferMode = TransferMode.RANDOM,
      fabId = DEFAULT_FAB_ID,
    } = params;

    // 멀티 fab API로 위임
    await get().initMultiFab({
      fabs: [{
        fabId,
        edges,
        nodes,
        numVehicles,
        vehicleConfigs,
        transferMode,
        stations,
      }],
      config,
    });
  },

  // 멀티 fab 초기화
  initMultiFab: async (params) => {
    const { fabs, config = {} } = params;

    // Dispose existing controller if any
    const existing = get().controller;
    if (existing) {
      console.log("[ShmSimulatorStore] Disposing existing controller...");
      existing.dispose();
    }

    console.log(`[ShmSimulatorStore] Creating new controller with ${fabs.length} fab(s)...`);
    const controller = new ShmSimulatorController();

    // Set up performance stats callback
    controller.onPerfStats((avgStepMs, minStepMs, maxStepMs) => {
      set({ workerAvgMs: avgStepMs, workerMinMs: minStepMs, workerMaxMs: maxStepMs });
    });

    // Set up fab event callbacks
    controller.onFabAdded((fabId, actualNumVehicles) => {
      set((state) => ({
        fabVehicleCounts: { ...state.fabVehicleCounts, [fabId]: actualNumVehicles },
      }));
    });

    controller.onFabRemoved((fabId) => {
      set((state) => {
        const newCounts = { ...state.fabVehicleCounts };
        delete newCounts[fabId];
        return { fabVehicleCounts: newCounts };
      });
    });

    try {
      await controller.init({
        fabs: fabs.map(fab => ({
          ...fab,
          transferMode: fab.transferMode ?? TransferMode.RANDOM,
        })),
        config: { ...createDefaultConfig(), maxDelta: getMaxDelta(), ...config },
      });

      // Build vehicle counts
      const fabVehicleCounts: Record<string, number> = {};
      for (const fabId of controller.getFabIds()) {
        fabVehicleCounts[fabId] = controller.getActualNumVehicles(fabId);
      }

      // 하위 호환성을 위해 기본 fab의 비히클 수를 actualNumVehicles에 저장
      const defaultFabCount = fabVehicleCounts[DEFAULT_FAB_ID] ?? controller.getTotalVehicleCount();

      set({
        controller,
        isInitialized: true,
        isRunning: false,
        actualNumVehicles: defaultFabCount,
        fabVehicleCounts,
      });

      console.log(`[ShmSimulatorStore] Initialized with ${controller.getTotalVehicleCount()} total vehicles across ${fabs.length} fab(s)`);
    } catch (error) {
      console.error("[ShmSimulatorStore] Init failed:", error);
      set({
        controller: null,
        isInitialized: false,
        isRunning: false,
        actualNumVehicles: 0,
        fabVehicleCounts: {},
      });
      throw error;
    }
  },

  addFab: async (params) => {
    const { controller } = get();
    if (!controller) {
      throw new Error("Controller not initialized");
    }

    const actualNumVehicles = await controller.addFab(params);
    set((state) => ({
      fabVehicleCounts: { ...state.fabVehicleCounts, [params.fabId]: actualNumVehicles },
    }));
    return actualNumVehicles;
  },

  removeFab: async (fabId) => {
    const { controller } = get();
    if (!controller) {
      throw new Error("Controller not initialized");
    }

    await controller.removeFab(fabId);
    set((state) => {
      const newCounts = { ...state.fabVehicleCounts };
      delete newCounts[fabId];
      return { fabVehicleCounts: newCounts };
    });
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
      fabVehicleCounts: {},
      workerAvgMs: 0,
      workerMinMs: 0,
      workerMaxMs: 0,
    });
  },

  getVehicleData: (fabId = DEFAULT_FAB_ID) => {
    const { controller } = get();
    if (!controller) return null;
    return controller.getVehicleData(fabId);
  },

  getSensorPointData: (fabId = DEFAULT_FAB_ID) => {
    const { controller } = get();
    if (!controller) return null;
    return controller.getSensorPointData(fabId);
  },

  getVehiclePosition: (index: number, fabId = DEFAULT_FAB_ID) => {
    const { controller } = get();
    if (!controller) return null;

    const data = controller.getVehicleData(fabId);
    if (!data) return null;

    const ptr = index * VEHICLE_DATA_SIZE;
    return {
      x: data[ptr + MovementData.X],
      y: data[ptr + MovementData.Y],
      z: data[ptr + MovementData.Z],
      rotation: data[ptr + MovementData.ROTATION],
    };
  },

  getActualNumVehicles: (fabId = DEFAULT_FAB_ID) => {
    const { controller } = get();
    if (!controller) return 0;
    return controller.getActualNumVehicles(fabId);
  },

  getFabIds: () => {
    const { controller } = get();
    if (!controller) return [];
    return controller.getFabIds();
  },

  getTotalVehicleCount: () => {
    const { controller } = get();
    if (!controller) return 0;
    return controller.getTotalVehicleCount();
  },

  sendCommand: (payload: unknown, fabId = DEFAULT_FAB_ID) => {
    const { controller } = get();
    if (controller) {
      controller.sendCommand(fabId, payload);
    }
  },
}));

// Helper hook for accessing vehicle data in render loop
export function getShmSensorPointData(fabId = DEFAULT_FAB_ID): Float32Array | null {
  return useShmSimulatorStore.getState().getSensorPointData(fabId);
}
