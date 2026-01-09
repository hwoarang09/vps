// shmSimulator/core/SimulationEngine.ts

import { FabContext, FabInitParams } from "./FabContext";
import type { InitPayload, SimulationConfig, FabInitData } from "../types";
import { createDefaultConfig } from "../types";
import { getDijkstraPerformanceStats } from "@/common/vehicle/logic/Dijkstra";

export class SimulationEngine {
  // === Fab Contexts ===
  /** Map of Fab ID (e.g., "fab_A", "fab_B") to FabContext instances */
  private readonly fabContexts: Map<string, FabContext> = new Map();

  // === Runtime ===
  private config: SimulationConfig;
  private isRunning: boolean = false;
  private loopHandle: ReturnType<typeof setInterval> | null = null;

  // === Performance Monitoring ===
  private stepTimes: number[] = [];
  private lastPerfReportTime: number = 0;
  private readonly PERF_REPORT_INTERVAL = 5000; // 5 seconds

  // === Timing ===
  private lastStepTime: number = 0;

  constructor() {
    this.config = createDefaultConfig();
  }

  /**
   * Handle external command for a specific fab
   * @param fabId - Unique identifier for the fab (e.g., "fab_A", "fab_B")
   */
  handleCommand(fabId: string, command: unknown): void {
    const context = this.fabContexts.get(fabId);
    if (!context) {
      console.warn(`[SimulationEngine] Fab not found: ${fabId}`);
      return;
    }
    context.handleCommand(command);
  }

  /**
   * Initialize from payload (called from Worker)
   * @returns Record of Fab ID to actual vehicle count
   */
  init(payload: InitPayload): Record<string, number> {
    console.log("[SimulationEngine] Initializing...");

    // Update config from payload
    this.config = payload.config;

    const fabVehicleCounts: Record<string, number> = {};

    // Initialize each fab
    for (const fabData of payload.fabs) {
      const params: FabInitParams = {
        fabId: fabData.fabId,
        sharedBuffer: fabData.sharedBuffer,
        sensorPointBuffer: fabData.sensorPointBuffer,
        edges: fabData.edges,
        nodes: fabData.nodes,
        config: this.config,
        vehicleConfigs: fabData.vehicleConfigs,
        numVehicles: fabData.numVehicles,
        transferMode: fabData.transferMode,
        stationData: fabData.stationData,
        memoryAssignment: fabData.memoryAssignment,
      };

      const context = new FabContext(params);
      this.fabContexts.set(fabData.fabId, context);
      fabVehicleCounts[fabData.fabId] = context.getActualNumVehicles();

      console.log(`[SimulationEngine] Fab ${fabData.fabId} initialized with ${context.getActualNumVehicles()} vehicles`);
    }

    console.log(`[SimulationEngine] Initialized ${this.fabContexts.size} fab(s)`);
    return fabVehicleCounts;
  }

  /**
   * Add a new fab dynamically
   */
  addFab(fabData: FabInitData, config: SimulationConfig): number {
    if (this.fabContexts.has(fabData.fabId)) {
      console.warn(`[SimulationEngine] Fab already exists: ${fabData.fabId}`);
      return this.fabContexts.get(fabData.fabId)!.getActualNumVehicles();
    }

    const params: FabInitParams = {
      fabId: fabData.fabId,
      sharedBuffer: fabData.sharedBuffer,
      sensorPointBuffer: fabData.sensorPointBuffer,
      edges: fabData.edges,
      nodes: fabData.nodes,
      config: config,
      vehicleConfigs: fabData.vehicleConfigs,
      numVehicles: fabData.numVehicles,
      transferMode: fabData.transferMode,
      stationData: fabData.stationData,
      memoryAssignment: fabData.memoryAssignment,
    };

    const context = new FabContext(params);
    this.fabContexts.set(fabData.fabId, context);

    console.log(`[SimulationEngine] Fab ${fabData.fabId} added with ${context.getActualNumVehicles()} vehicles`);
    return context.getActualNumVehicles();
  }

  /**
   * Remove a fab dynamically
   * @param fabId - Unique identifier for the fab to remove
   */
  removeFab(fabId: string): boolean {
    const context = this.fabContexts.get(fabId);
    if (!context) {
      console.warn(`[SimulationEngine] Fab not found: ${fabId}`);
      return false;
    }

    context.dispose();
    this.fabContexts.delete(fabId);

    console.log(`[SimulationEngine] Fab ${fabId} removed`);
    return true;
  }

  /**
   * Get a specific fab context
   * @param fabId - Unique identifier for the fab
   */
  getFabContext(fabId: string): FabContext | undefined {
    return this.fabContexts.get(fabId);
  }

  /**
   * Get all fab IDs
   * @returns Array of fab identifiers (e.g., ["fab_A", "fab_B"])
   */
  getFabIds(): string[] {
    return Array.from(this.fabContexts.keys());
  }

  /**
   * Start the simulation loop
   */
  start(): void {
    if (this.isRunning) return;

    this.isRunning = true;
    const targetInterval = 1000 / this.config.targetFps;

    console.log(`[SimulationEngine] Starting simulation loop (${this.config.targetFps} FPS)`);

    // Initialize timing
    this.lastStepTime = performance.now();

    this.loopHandle = setInterval(() => {
      const now = performance.now();
      const realDelta = (now - this.lastStepTime) / 1000; // Convert to seconds
      this.lastStepTime = now;
      this.step(realDelta);
    }, targetInterval);
  }

  /**
   * Stop the simulation loop
   */
  stop(): void {
    if (!this.isRunning) return;

    this.isRunning = false;

    if (this.loopHandle) {
      clearInterval(this.loopHandle);
      this.loopHandle = null;
    }

    console.log("[SimulationEngine] Simulation stopped");
  }

  /**
   * Single simulation step - updates all fabs
   */
  step(delta: number): void {
    if (!this.isRunning) return;

    const stepStart = performance.now();
    const clampedDelta = Math.min(delta, this.config.maxDelta);

    // Update all fab contexts
    for (const context of this.fabContexts.values()) {
      context.step(clampedDelta);
    }

    // Measure step time
    const stepEnd = performance.now();
    this.stepTimes.push(stepEnd - stepStart);

    // Report performance stats periodically
    if (stepEnd - this.lastPerfReportTime >= this.PERF_REPORT_INTERVAL) {
      this.reportPerfStats();
      this.lastPerfReportTime = stepEnd;
    }
  }

  /**
   * Report performance statistics to main thread
   */
  private reportPerfStats(): void {
    if (this.stepTimes.length === 0) return;

    const avgStepMs = this.stepTimes.reduce((a, b) => a + b, 0) / this.stepTimes.length;
    const minStepMs = Math.min(...this.stepTimes);
    const maxStepMs = Math.max(...this.stepTimes);
    this.stepTimes = [];

    // Get Dijkstra stats
    const dijkstraStats = getDijkstraPerformanceStats();

    // Get per-fab vehicle counts
    const fabVehicleCounts = this.getVehicleCountsByFab();

    self.postMessage({
      type: "PERF_STATS",
      avgStepMs,
      minStepMs,
      maxStepMs,
      dijkstra: dijkstraStats.count > 0 ? {
        count: dijkstraStats.count,
        avgTimeMs: dijkstraStats.totalTime / dijkstraStats.count,
        minTimeMs: dijkstraStats.minTime,
        maxTimeMs: dijkstraStats.maxTime,
      } : undefined,
      fabVehicleCounts,
    });
  }

  /**
   * Dispose the engine
   */
  dispose(): void {
    this.stop();

    for (const context of this.fabContexts.values()) {
      context.dispose();
    }
    this.fabContexts.clear();

    console.log("[SimulationEngine] Disposed");
  }

  /**
   * Get total vehicle count across all fabs
   */
  getTotalVehicleCount(): number {
    let total = 0;
    for (const context of this.fabContexts.values()) {
      total += context.getActualNumVehicles();
    }
    return total;
  }

  /**
   * Get vehicle counts per fab
   * @returns Record of Fab ID to vehicle count
   */
  getVehicleCountsByFab(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const [fabId, context] of this.fabContexts) {
      counts[fabId] = context.getActualNumVehicles();
    }
    return counts;
  }
}
