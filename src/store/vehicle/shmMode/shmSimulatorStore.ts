// shmSimulatorStore.ts
// Zustand store for managing MultiWorkerController instance (멀티 워커 지원)

import { create } from "zustand";
import { MultiWorkerController, MultiFabInitParams, WorkerPerfStats } from "@/shmSimulator/MultiWorkerController";
import { TransferMode } from "@/shmSimulator";
import type { SimulationConfig, VehicleInitConfig, SharedMapData } from "@/shmSimulator";
import type { Edge } from "@/types/edge";
import type { Node } from "@/types";
import { getSimulationConfig } from "@/config/simulationConfig";

type FabInitParams = MultiFabInitParams;

const DEFAULT_FAB_ID = "default";

interface ShmSimulatorState {
  controller: MultiWorkerController | null;
  workerCount: number;
  isInitialized: boolean;
  isRunning: boolean;
  actualNumVehicles: number;
  fabVehicleCounts: Record<string, number>;
  workerPerfStats: WorkerPerfStats[];
  workerAvgMs: number;
  workerMinMs: number;
  workerMaxMs: number;
  workerStdDev: number;
  workerCV: number;
  workerP99: number;

  // Actions
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

  initMultiFab: (params: {
    fabs: FabInitParams[];
    config?: Partial<SimulationConfig>;
    workerCount?: number;
    sharedMapData?: SharedMapData;
  }) => Promise<void>;

  addFab: (params: FabInitParams) => Promise<number>;
  removeFab: (fabId: string) => Promise<void>;

  start: () => Promise<void>;
  stop: () => void;
  pause: () => void;
  resume: () => Promise<void>;
  dispose: () => void;

  // Data access - 연속 레이아웃 렌더 버퍼 사용
  getVehicleData: () => Float32Array | null;
  getSensorPointData: () => Float32Array | null;
  // Full data access - worker 버퍼 (22 floats per vehicle)
  getVehicleFullData: () => Float32Array | null;
  getSensorFullData: () => Float32Array | null;
  // Path data access - Int32Array (MAX_PATH_LENGTH ints per vehicle)
  getPathData: () => Int32Array | null;
  getActualNumVehicles: (fabId?: string) => number;

  // Fab 관리
  getFabIds: () => string[];
  getTotalVehicleCount: () => number;

  sendCommand: (payload: unknown, fabId?: string) => void;
  flushLogs: () => void;
  downloadLogs: () => Promise<{ buffer: ArrayBuffer; fileName: string; recordCount: number } | null>;
  listLogFiles: () => Promise<import("@/logger/protocol").LogFileInfo[] | null>;
  downloadLogFile: (fileName: string) => Promise<{ buffer: ArrayBuffer; fileName: string; recordCount: number } | null>;
  deleteLogFile: (fileName: string) => Promise<void>;
  deleteAllLogFiles: () => Promise<number>;
  getLockTableData: (fabId: string) => Promise<import("@/shmSimulator/types").LockTableData | null>;
}

export const useShmSimulatorStore = create<ShmSimulatorState>((set, get) => ({
  controller: null,
  workerCount: 0,
  isInitialized: false,
  isRunning: false,
  actualNumVehicles: 0,
  fabVehicleCounts: {},
  workerPerfStats: [],
  workerAvgMs: 0,
  workerMinMs: 0,
  workerMaxMs: 0,
  workerStdDev: 0,
  workerCV: 0,
  workerP99: 0,

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

  initMultiFab: async (params) => {
    const { fabs, config = {}, workerCount, sharedMapData } = params;

    const existing = get().controller;
    if (existing) {
      existing.dispose();
    }

    const controller = new MultiWorkerController();

    controller.onPerfStats((workerStats) => {
      set({ workerPerfStats: workerStats });

      if (workerStats.length > 0) {
        const avgStepMs = workerStats.reduce((sum, s) => sum + s.avgStepMs, 0) / workerStats.length;
        const minStepMs = Math.min(...workerStats.map(s => s.minStepMs));
        const maxStepMs = Math.max(...workerStats.map(s => s.maxStepMs));
        const avgStdDev = workerStats.reduce((sum, s) => sum + s.stdDev, 0) / workerStats.length;
        const avgCV = workerStats.reduce((sum, s) => sum + s.cv, 0) / workerStats.length;
        const maxP99 = Math.max(...workerStats.map(s => s.p99));
        set({
          workerAvgMs: avgStepMs,
          workerMinMs: minStepMs,
          workerMaxMs: maxStepMs,
          workerStdDev: avgStdDev,
          workerCV: avgCV,
          workerP99: maxP99,
        });
      }
    });

    controller.onError((_error) => {
      // Error logged by MultiWorkerController internally
    });

    try {
      await controller.init({
        fabs: fabs.map(fab => ({
          ...fab,
          transferMode: fab.transferMode ?? TransferMode.RANDOM,
        })),
        workerCount,
        config: { ...getSimulationConfig(), ...config },
        sharedMapData,
      });

      const fabVehicleCounts: Record<string, number> = {};
      for (const fabId of controller.getFabIds()) {
        fabVehicleCounts[fabId] = controller.getActualNumVehicles(fabId);
      }

      const totalVehicles = controller.getTotalVehicleCount();

      set({
        controller,
        workerCount: controller.getWorkerCount(),
        isInitialized: true,
        isRunning: false,
        actualNumVehicles: totalVehicles,
        fabVehicleCounts,
      });

    } catch (error) {
      set({
        controller: null,
        workerCount: 0,
        isInitialized: false,
        isRunning: false,
        actualNumVehicles: 0,
        fabVehicleCounts: {},
      });
      throw error;
    }
  },

  addFab: async () => {
    throw new Error("Dynamic fab addition not supported. Use dispose() and re-init().");
  },

  removeFab: async () => {
    throw new Error("Dynamic fab removal not supported. Use dispose() and re-init().");
  },

  start: async () => {
    const { controller } = get();
    if (controller && get().isInitialized) {

      // Enable logging if not already enabled
      if (!controller.isLoggingEnabled()) {
        try {
          await controller.enableLogging("OPFS");
        } catch {
          // OPFS logging not available - continue without logging
        }
      }

      controller.start();
      set({ isRunning: true });
    }
  },

  stop: () => {
    const { controller } = get();
    if (controller) {
      controller.stop();
      set({ isRunning: false });
    }
  },

  pause: () => {
    const { controller } = get();
    if (controller) {
      controller.pause();
      set({ isRunning: false });
    }
  },

  resume: async () => {
    const { controller } = get();
    if (controller && get().isInitialized) {

      // Enable logging if not already enabled
      if (!controller.isLoggingEnabled()) {
        try {
          await controller.enableLogging("OPFS");
        } catch {
          // OPFS logging not available - continue without logging
        }
      }

      controller.resume();
      set({ isRunning: true });
    }
  },

  dispose: () => {
    const { controller } = get();
    if (controller) {
      controller.dispose();
    }
    set({
      controller: null,
      workerCount: 0,
      isInitialized: false,
      isRunning: false,
      actualNumVehicles: 0,
      fabVehicleCounts: {},
      workerPerfStats: [],
      workerAvgMs: 0,
      workerMinMs: 0,
      workerMaxMs: 0,
      workerStdDev: 0,
      workerCV: 0,
      workerP99: 0,
    });
  },

  // 연속 레이아웃 렌더 버퍼 반환
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

  // Full data access - worker 버퍼 (22 floats per vehicle)
  getVehicleFullData: () => {
    const { controller } = get();
    if (!controller) return null;
    return controller.getVehicleFullData();
  },

  getSensorFullData: () => {
    const { controller } = get();
    if (!controller) return null;
    return controller.getSensorFullData();
  },

  // Path data access - Int32Array
  getPathData: () => {
    const { controller } = get();
    if (!controller) return null;
    return controller.getPathData();
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

  flushLogs: () => {
    const { controller } = get();
    if (controller) {
      controller.flushLogs();
    }
  },

  downloadLogs: async () => {
    const { controller } = get();
    if (!controller) return null;
    return controller.downloadLogs();
  },

  listLogFiles: async () => {
    const { controller } = get();
    if (!controller) return null;
    return controller.listLogFiles();
  },

  downloadLogFile: async (fileName: string) => {
    const { controller } = get();
    if (!controller) return null;
    return controller.downloadLogFile(fileName);
  },

  deleteLogFile: async (fileName: string) => {
    const { controller } = get();
    if (!controller) return;
    return controller.deleteLogFile(fileName);
  },

  deleteAllLogFiles: async () => {
    const { controller } = get();
    if (!controller) return 0;
    return controller.deleteAllLogFiles();
  },

  getLockTableData: async (fabId: string) => {
    const { controller } = get();
    if (!controller) return null;
    return controller.getLockTableData(fabId);
  },
}));

// Helper hook for accessing sensor data
export function getShmSensorPointData(): Float32Array | null {
  return useShmSimulatorStore.getState().getSensorPointData();
}
