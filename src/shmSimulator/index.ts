import type {
  WorkerMessage,
  MainMessage,
  InitPayload,
  SimulationConfig,
  VehicleInitConfig,
  FabInitData,
} from "./types";
import { TransferMode, createDefaultConfig } from "./types";
import type { Edge } from "@/types/edge";
import type { Node } from "@/types";
import type { StationRawData } from "@/types/station";
import { VEHICLE_DATA_SIZE } from "@/common/vehicle/memory/VehicleDataArrayBase";
import { SENSOR_DATA_SIZE } from "@/common/vehicle/memory/SensorPointArrayBase";
import { MAX_PATH_LENGTH } from "./MemoryLayoutManager";
import { CHECKPOINT_SECTION_SIZE } from "@/common/vehicle/initialize/constants";

// Fab별 버퍼 및 데이터 관리
interface FabBufferData {
  /** Unique identifier for the fab (e.g., "fab_A", "fab_B") */
  fabId: string;
  sharedBuffer: SharedArrayBuffer;
  sensorPointBuffer: SharedArrayBuffer;
  pathBuffer: SharedArrayBuffer;
  checkpointBuffer: SharedArrayBuffer;
  vehicleData: Float32Array;
  sensorPointData: Float32Array;
  actualNumVehicles: number;
}

// Fab 초기화 파라미터
export interface FabInitParams {
  /** Unique identifier for the fab (e.g., "fab_A", "fab_B") */
  fabId: string;
  edges: Edge[];
  nodes: Node[];
  numVehicles: number;
  vehicleConfigs?: VehicleInitConfig[];
  transferMode?: TransferMode;
  stations: ReadonlyArray<unknown>;
}

export class ShmSimulatorController {
  private worker: Worker | null = null;
  private config: SimulationConfig = createDefaultConfig();
  private isInitialized: boolean = false;
  private isRunning: boolean = false;

  // Fab별 버퍼 관리
  private readonly fabBuffers: Map<string, FabBufferData> = new Map();

  private onReadyCallback: (() => void) | null = null;
  private onErrorCallback: ((error: string) => void) | null = null;
  private onPerfStatsCallback: ((avgStepMs: number, minStepMs: number, maxStepMs: number) => void) | null = null;
  private onFabAddedCallback: ((fabId: string, actualNumVehicles: number) => void) | null = null;
  private onFabRemovedCallback: ((fabId: string) => void) | null = null;

  /**
   * Set callback for worker performance stats
   */
  onPerfStats(callback: (avgStepMs: number, minStepMs: number, maxStepMs: number) => void): void {
    this.onPerfStatsCallback = callback;
  }

  /**
   * Set callback for fab added event
   */
  onFabAdded(callback: (fabId: string, actualNumVehicles: number) => void): void {
    this.onFabAddedCallback = callback;
  }

  /**
   * Set callback for fab removed event
   */
  onFabRemoved(callback: (fabId: string) => void): void {
    this.onFabRemovedCallback = callback;
  }

  /**
   * Create buffer for a single fab
   * @param fabId - Unique identifier for the fab (e.g., "fab_A", "fab_B")
   */
  private createFabBuffers(fabId: string): FabBufferData {
    // Allocate SharedArrayBuffer for vehicle data
    const bufferSize = this.config.maxVehicles * VEHICLE_DATA_SIZE * Float32Array.BYTES_PER_ELEMENT;
    const sharedBuffer = new SharedArrayBuffer(bufferSize);
    const vehicleData = new Float32Array(sharedBuffer);

    // Allocate SharedArrayBuffer for sensor point data
    const sensorBufferSize = this.config.maxVehicles * SENSOR_DATA_SIZE * Float32Array.BYTES_PER_ELEMENT;
    const sensorPointBuffer = new SharedArrayBuffer(sensorBufferSize);
    const sensorPointData = new Float32Array(sensorPointBuffer);

    // Allocate SharedArrayBuffer for path data
    const pathBufferSize = this.config.maxVehicles * MAX_PATH_LENGTH * Int32Array.BYTES_PER_ELEMENT;
    const pathBuffer = new SharedArrayBuffer(pathBufferSize);

    // Allocate SharedArrayBuffer for checkpoint data
    const checkpointBufferSize = (1 + this.config.maxVehicles * CHECKPOINT_SECTION_SIZE) * Float32Array.BYTES_PER_ELEMENT;
    const checkpointBuffer = new SharedArrayBuffer(checkpointBufferSize);

    return {
      fabId,
      sharedBuffer,
      sensorPointBuffer,
      pathBuffer,
      checkpointBuffer,
      vehicleData,
      sensorPointData,
      actualNumVehicles: 0,
    };
  }

  /**
   * Initialize the simulator with multiple fabs
   */
  async init(params: {
    fabs: FabInitParams[];
    config?: Partial<SimulationConfig>;
  }): Promise<void> {
    const { fabs, config = {} } = params;

    // Merge with default config
    this.config = { ...createDefaultConfig(), ...config };

    // Create worker
    this.worker = new Worker(
      new URL("./worker.entry.ts", import.meta.url),
      { type: "module" }
    );

    // Set up message handler
    this.worker.onmessage = (e: MessageEvent<MainMessage>) => {
      this.handleWorkerMessage(e.data);
    };

    this.worker.onerror = (error) => {
      if (this.onErrorCallback) {
        this.onErrorCallback(error.message);
      }
    };

    // Create buffers and prepare init data for each fab
    const fabInitDataList: FabInitData[] = [];

    for (const fabParams of fabs) {
      const bufferData = this.createFabBuffers(fabParams.fabId);
      this.fabBuffers.set(fabParams.fabId, bufferData);

      const fabInitData: FabInitData = {
        fabId: fabParams.fabId,
        sharedBuffer: bufferData.sharedBuffer,
        sensorPointBuffer: bufferData.sensorPointBuffer,
        pathBuffer: bufferData.pathBuffer,
        checkpointBuffer: bufferData.checkpointBuffer,
        edges: fabParams.edges,
        nodes: fabParams.nodes,
        vehicleConfigs: fabParams.vehicleConfigs ?? [],
        numVehicles: fabParams.numVehicles,
        transferMode: fabParams.transferMode ?? TransferMode.LOOP,
        stationData: fabParams.stations as StationRawData[],
      };

      fabInitDataList.push(fabInitData);
    }

    // Prepare init payload
    const payload: InitPayload = {
      config: this.config,
      fabs: fabInitDataList,
    };

    // Send init message
    return new Promise((resolve, reject) => {
      this.onReadyCallback = () => {
        this.isInitialized = true;
        resolve();
      };
      this.onErrorCallback = (error) => {
        reject(new Error(error));
      };

      const message: WorkerMessage = {
        type: "INIT",
        payload,
      };
      this.worker!.postMessage(message);
    });
  }

  /**
   * Add a new fab dynamically
   */
  async addFab(fabParams: FabInitParams): Promise<number> {
    if (!this.worker || !this.isInitialized) {
      throw new Error("Controller not initialized");
    }

    if (this.fabBuffers.has(fabParams.fabId)) {
      throw new Error(`Fab already exists: ${fabParams.fabId}`);
    }

    // Create buffers
    const bufferData = this.createFabBuffers(fabParams.fabId);
    this.fabBuffers.set(fabParams.fabId, bufferData);

    const fabInitData: FabInitData = {
      fabId: fabParams.fabId,
      sharedBuffer: bufferData.sharedBuffer,
      sensorPointBuffer: bufferData.sensorPointBuffer,
      pathBuffer: bufferData.pathBuffer,
      checkpointBuffer: bufferData.checkpointBuffer,
      edges: fabParams.edges,
      nodes: fabParams.nodes,
      vehicleConfigs: fabParams.vehicleConfigs ?? [],
      numVehicles: fabParams.numVehicles,
      transferMode: fabParams.transferMode ?? TransferMode.LOOP,
      stationData: fabParams.stations as StationRawData[],
    };

    return new Promise((resolve) => {
      const originalCallback = this.onFabAddedCallback;

      this.onFabAddedCallback = (fabId, actualNumVehicles) => {
        if (fabId === fabParams.fabId) {
          const bufData = this.fabBuffers.get(fabId);
          if (bufData) {
            bufData.actualNumVehicles = actualNumVehicles;
          }
          this.onFabAddedCallback = originalCallback;
          resolve(actualNumVehicles);
        }
        originalCallback?.(fabId, actualNumVehicles);
      };

      const message: WorkerMessage = {
        type: "ADD_FAB",
        fab: fabInitData,
        config: this.config,
      };
      this.worker!.postMessage(message);
    });
  }

  /**
   * Remove a fab dynamically
   */
  async removeFab(fabId: string): Promise<void> {
    if (!this.worker || !this.isInitialized) {
      throw new Error("Controller not initialized");
    }

    if (!this.fabBuffers.has(fabId)) {
      throw new Error(`Fab not found: ${fabId}`);
    }

    return new Promise((resolve) => {
      const originalCallback = this.onFabRemovedCallback;

      this.onFabRemovedCallback = (removedFabId) => {
        if (removedFabId === fabId) {
          this.fabBuffers.delete(fabId);
          this.onFabRemovedCallback = originalCallback;
          resolve();
        }
        originalCallback?.(removedFabId);
      };

      const message: WorkerMessage = {
        type: "REMOVE_FAB",
        fabId,
      };
      this.worker!.postMessage(message);
    });
  }

  /**
   * Handle initialization complete message
   */
  private handleInitialized(fabVehicleCounts: Record<string, number>): void {

    // Update actual vehicle counts
    for (const [fabId, count] of Object.entries(fabVehicleCounts)) {
      const bufData = this.fabBuffers.get(fabId);
      if (bufData) {
        bufData.actualNumVehicles = count;
      }
    }

    if (this.onReadyCallback) {
      this.onReadyCallback();
      this.onReadyCallback = null;
    }
  }

  /**
   * Handle messages from worker
   */
  private handleWorkerMessage(message: MainMessage): void {
    switch (message.type) {
      case "READY":
        break;

      case "INITIALIZED": {
        this.handleInitialized(message.fabVehicleCounts);
        break;
      }

      case "ERROR":
        if (this.onErrorCallback) {
          this.onErrorCallback(message.error);
          this.onErrorCallback = null;
        }
        break;

      case "STATS":
        // Handle stats if needed
        break;

      case "PERF_STATS":
        if (this.onPerfStatsCallback) {
          this.onPerfStatsCallback(message.avgStepMs, message.minStepMs, message.maxStepMs);
        }
        break;

      case "FAB_ADDED":
        if (this.onFabAddedCallback) {
          this.onFabAddedCallback(message.fabId, message.actualNumVehicles);
        }
        break;

      case "FAB_REMOVED":
        if (this.onFabRemovedCallback) {
          this.onFabRemovedCallback(message.fabId);
        }
        break;
    }
  }

  /**
   * Start the simulation
   */
  start(): void {
    if (!this.worker || !this.isInitialized) {
      return;
    }

    const message: WorkerMessage = { type: "START" };
    this.worker.postMessage(message);
    this.isRunning = true;
  }

  /**
   * Stop the simulation
   */
  stop(): void {
    if (!this.worker) return;

    const message: WorkerMessage = { type: "STOP" };
    this.worker.postMessage(message);
    this.isRunning = false;
  }

  /**
   * Pause the simulation
   */
  pause(): void {
    if (!this.worker) return;

    const message: WorkerMessage = { type: "PAUSE" };
    this.worker.postMessage(message);
    this.isRunning = false;
  }

  /**
   * Resume the simulation
   */
  resume(): void {
    if (!this.worker) return;

    const message: WorkerMessage = { type: "RESUME" };
    this.worker.postMessage(message);
    this.isRunning = true;
  }

  /**
   * Send a command to a specific fab
   */
  sendCommand(fabId: string, payload: unknown): void {
    if (!this.worker) return;
    const message: WorkerMessage = { type: "COMMAND", fabId, payload };
    this.worker.postMessage(message);
  }

  /**
   * Dispose the controller and terminate worker
   */
  dispose(): void {
    if (this.worker) {
      const message: WorkerMessage = { type: "DISPOSE" };
      this.worker.postMessage(message);

      setTimeout(() => {
        this.worker?.terminate();
        this.worker = null;
      }, 100);
    }

    this.fabBuffers.clear();
    this.isInitialized = false;
    this.isRunning = false;

  }

  /**
   * Get vehicle data for a specific fab
   */
  getVehicleData(fabId: string): Float32Array | null {
    const bufData = this.fabBuffers.get(fabId);
    return bufData?.vehicleData ?? null;
  }

  /**
   * Get sensor point data for a specific fab
   */
  getSensorPointData(fabId: string): Float32Array | null {
    const bufData = this.fabBuffers.get(fabId);
    return bufData?.sensorPointData ?? null;
  }

  /**
   * Get actual number of vehicles for a specific fab
   */
  getActualNumVehicles(fabId: string): number {
    const bufData = this.fabBuffers.get(fabId);
    return bufData?.actualNumVehicles ?? 0;
  }

  /**
   * Get all fab IDs
   */
  getFabIds(): string[] {
    return Array.from(this.fabBuffers.keys());
  }

  /**
   * Get total vehicle count across all fabs
   */
  getTotalVehicleCount(): number {
    let total = 0;
    for (const bufData of this.fabBuffers.values()) {
      total += bufData.actualNumVehicles;
    }
    return total;
  }

  /**
   * Check if running
   */
  getIsRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Check if initialized
   */
  getIsInitialized(): boolean {
    return this.isInitialized;
  }
}

// Export types
export * from "./types";
