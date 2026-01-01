// shmSimulator/index.ts
// Main thread controller for SHM Simulator

import type {
  WorkerMessage,
  MainMessage,
  InitPayload,
  SimulationConfig,
  VehicleInitConfig,
  TransferMode,
} from "./types";
import { createDefaultConfig } from "./types";
import type { Edge } from "@/types/edge";
import type { Node } from "@/types";
import { VEHICLE_DATA_SIZE } from "@/common/vehicle/memory/VehicleDataArrayBase";
import { SENSOR_DATA_SIZE } from "@/common/vehicle/memory/SensorPointArrayBase";

export class ShmSimulatorController {
  private worker: Worker | null = null;
  private sharedBuffer: SharedArrayBuffer | null = null;
  private sensorPointBuffer: SharedArrayBuffer | null = null;
  private vehicleData: Float32Array | null = null;
  private sensorPointData: Float32Array | null = null;
  private actualNumVehicles: number = 0;
  private isInitialized: boolean = false;
  private isRunning: boolean = false;

  private onReadyCallback: (() => void) | null = null;
  private onErrorCallback: ((error: string) => void) | null = null;
  private onPerfStatsCallback: ((avgStepMs: number) => void) | null = null;

  /**
   * Set callback for worker performance stats
   */
  onPerfStats(callback: (avgStepMs: number) => void): void {
    this.onPerfStatsCallback = callback;
  }

  /**
   * Initialize the simulator with map data and config
   */
  async init(params: {
    edges: Edge[];
    nodes: Node[];
    numVehicles: number;
    vehicleConfigs?: VehicleInitConfig[];
    config?: Partial<SimulationConfig>;
    transferMode?: TransferMode;
  }): Promise<void> {
    const {
      edges,
      nodes,
      numVehicles,
      vehicleConfigs = [],
      config = {},
      transferMode = 0,
    } = params;

    // Merge with default config
    const finalConfig: SimulationConfig = { ...createDefaultConfig(), ...config };

    // Allocate SharedArrayBuffer for vehicle data
    const bufferSize = finalConfig.maxVehicles * VEHICLE_DATA_SIZE * Float32Array.BYTES_PER_ELEMENT;
    this.sharedBuffer = new SharedArrayBuffer(bufferSize);
    this.vehicleData = new Float32Array(this.sharedBuffer);

    // Allocate SharedArrayBuffer for sensor point data
    const sensorBufferSize = finalConfig.maxVehicles * SENSOR_DATA_SIZE * Float32Array.BYTES_PER_ELEMENT;
    this.sensorPointBuffer = new SharedArrayBuffer(sensorBufferSize);
    this.sensorPointData = new Float32Array(this.sensorPointBuffer);

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
      console.error("[ShmSimulatorController] Worker error:", error);
      if (this.onErrorCallback) {
        this.onErrorCallback(error.message);
      }
    };

    // Prepare init payload
    const payload: InitPayload = {
      sharedBuffer: this.sharedBuffer,
      sensorPointBuffer: this.sensorPointBuffer,
      edges: edges,
      nodes: nodes,
      config: finalConfig,
      vehicleConfigs: vehicleConfigs,
      numVehicles: numVehicles,
      transferMode: transferMode,
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
   * Handle messages from worker
   */
  private handleWorkerMessage(message: MainMessage): void {
    switch (message.type) {
      case "READY":
        console.log("[ShmSimulatorController] Worker ready");
        break;

      case "INITIALIZED":
        console.log(
          `[ShmSimulatorController] Initialized with ${message.actualNumVehicles} vehicles`
        );
        this.actualNumVehicles = message.actualNumVehicles;
        if (this.onReadyCallback) {
          this.onReadyCallback();
          this.onReadyCallback = null;
        }
        break;

      case "ERROR":
        console.error("[ShmSimulatorController] Worker error:", message.error);
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
          this.onPerfStatsCallback(message.avgStepMs);
        }
        break;
    }
  }

  /**
   * Start the simulation
   */
  start(): void {
    if (!this.worker || !this.isInitialized) {
      console.warn("[ShmSimulatorController] Cannot start: not initialized");
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
   * Send a command to the worker
   */
  sendCommand(payload: any): void {
    if (!this.worker) return;
    const message: WorkerMessage = { type: "COMMAND", payload };
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

    this.sharedBuffer = null;
    this.sensorPointBuffer = null;
    this.vehicleData = null;
    this.sensorPointData = null;
    this.isInitialized = false;
    this.isRunning = false;

    console.log("[ShmSimulatorController] Disposed");
  }

  /**
   * Get vehicle data for rendering (direct access to SharedArrayBuffer)
   */
  getVehicleData(): Float32Array | null {
    return this.vehicleData;
  }

  /**
   * Get sensor point data for rendering (direct access to SharedArrayBuffer)
   */
  getSensorPointData(): Float32Array | null {
    return this.sensorPointData;
  }

  /**
   * Get actual number of vehicles
   */
  getActualNumVehicles(): number {
    return this.actualNumVehicles;
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

