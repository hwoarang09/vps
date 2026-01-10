// shmSimulatorStore.ts
// Zustand store for managing MultiWorkerController instance (멀티 워커 지원)

import { create } from "zustand";
import { MultiWorkerController, MultiFabInitParams, WorkerPerfStats } from "@/shmSimulator/MultiWorkerController";
import { createDefaultConfig, TransferMode } from "@/shmSimulator";
import type { SimulationConfig, VehicleInitConfig, SharedMapData } from "@/shmSimulator";
import type { Edge } from "@/types/edge";
import type { Node } from "@/types";
import {
  VEHICLE_DATA_SIZE,
  MovementData,
} from "@/common/vehicle/memory/VehicleDataArrayBase";
import { getMaxDelta } from "@/config/movementConfig";

// FabInitParams 호환 타입
type FabInitParams = MultiFabInitParams;

// 기본 fabId (단일 fab 호환용)
const DEFAULT_FAB_ID = "default";

interface ShmSimulatorState {
  // Controller instance (MultiWorkerController로 변경)
  controller: MultiWorkerController | null;

  // 워커 수
  workerCount: number;

  // State
  isInitialized: boolean;
  isRunning: boolean;
  // 하위 호환성 - 기본 fab의 비히클 수 (deprecated: use fabVehicleCounts or getActualNumVehicles)
  actualNumVehicles: number;
  // Fab별 비히클 수
  fabVehicleCounts: Record<string, number>;

  // 워커별 성능 정보
  workerPerfStats: WorkerPerfStats[];

  // 하위 호환성 - 전체 워커의 평균값 (deprecated: use workerPerfStats)
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
    workerCount?: number;
    sharedMapData?: SharedMapData;
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
  workerCount: 0,
  isInitialized: false,
  isRunning: false,
  actualNumVehicles: 0,
  fabVehicleCounts: {},
  workerPerfStats: [],
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

  // 멀티 fab 초기화 (MultiWorkerController 사용)
  initMultiFab: async (params) => {
    const { fabs, config = {}, workerCount, sharedMapData } = params;

    // Dispose existing controller if any
    const existing = get().controller;
    if (existing) {
      console.log("[ShmSimulatorStore] Disposing existing controller...");
      existing.dispose();
    }

    console.log(`[ShmSimulatorStore] Creating MultiWorkerController with ${fabs.length} fab(s)...`);
    const controller = new MultiWorkerController();

    // Set up performance stats callback
    controller.onPerfStats((workerStats) => {
      // 워커별 성능 정보 저장
      set({ workerPerfStats: workerStats });

      // 하위 호환성: 전체 워커의 평균값 계산
      if (workerStats.length > 0) {
        const avgStepMs = workerStats.reduce((sum, s) => sum + s.avgStepMs, 0) / workerStats.length;
        const minStepMs = Math.min(...workerStats.map(s => s.minStepMs));
        const maxStepMs = Math.max(...workerStats.map(s => s.maxStepMs));
        set({ workerAvgMs: avgStepMs, workerMinMs: minStepMs, workerMaxMs: maxStepMs });
      }
    });

    // Set up error callback
    controller.onError((error) => {
      console.error("[ShmSimulatorStore] Worker error:", error);
    });

    try {
      await controller.init({
        fabs: fabs.map(fab => ({
          ...fab,
          transferMode: fab.transferMode ?? TransferMode.RANDOM,
        })),
        workerCount,
        config: { ...createDefaultConfig(), maxDelta: getMaxDelta(), ...config },
        sharedMapData,
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
        workerCount: controller.getWorkerCount(),
        isInitialized: true,
        isRunning: false,
        actualNumVehicles: defaultFabCount,
        fabVehicleCounts,
      });

      console.log(`[ShmSimulatorStore] Initialized with ${controller.getTotalVehicleCount()} total vehicles across ${fabs.length} fab(s), ${controller.getWorkerCount()} workers`);
      console.log(`[ShmSimulatorStore] Worker assignments:`, controller.getWorkerAssignments());
    } catch (error) {
      console.error("[ShmSimulatorStore] Init failed:", error);
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
    // MultiWorkerController에서는 동적 Fab 추가 미지원
    // dispose() 후 새로 init() 해야 함
    throw new Error("Dynamic fab addition not supported in MultiWorkerController. Use dispose() and re-init().");
  },

  removeFab: async () => {
    // MultiWorkerController에서는 동적 Fab 삭제 미지원
    // dispose() 후 새로 init() 해야 함
    throw new Error("Dynamic fab removal not supported in MultiWorkerController. Use dispose() and re-init().");
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
      workerCount: 0,
      isInitialized: false,
      isRunning: false,
      actualNumVehicles: 0,
      fabVehicleCounts: {},
      workerPerfStats: [],
      workerAvgMs: 0,
      workerMinMs: 0,
      workerMaxMs: 0,
    });
  },

  getVehicleData: (fabId?: string) => {
    const { controller } = get();
    if (!controller) return null;
    // fabId가 없으면 전체 버퍼 반환 (멀티 Fab 렌더링용)
    return controller.getVehicleData(fabId);
  },

  getSensorPointData: (fabId?: string) => {
    const { controller } = get();
    if (!controller) return null;
    // fabId가 없으면 전체 버퍼 반환 (멀티 Fab 렌더링용)
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
// fabId가 없으면 전체 버퍼 반환 (멀티 Fab 렌더링용)
export function getShmSensorPointData(fabId?: string): Float32Array | null {
  return useShmSimulatorStore.getState().getSensorPointData(fabId);
}
