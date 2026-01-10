// shmSimulator/core/SimulationEngine.ts

import { FabContext, FabInitParams } from "./FabContext";
import type { InitPayload, SimulationConfig, FabInitData, SharedMapData } from "../types";
import { createDefaultConfig } from "../types";
import { getDijkstraPerformanceStats } from "@/common/vehicle/logic/Dijkstra";
import type { Edge } from "@/types/edge";
import type { Node } from "@/types";
import type { StationRawData } from "@/types/station";
import * as THREE from "three";

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
      // sharedMapData가 있으면 fabOffset을 사용하여 fab별 데이터 계산
      let edges: Edge[];
      let nodes: Node[];
      let stationData: StationRawData[];

      if (payload.sharedMapData && fabData.fabOffset) {
        // sharedMapData에서 fab별 데이터 계산
        const calculated = this.calculateFabData(
          payload.sharedMapData,
          fabData.fabOffset.fabIndex,
          fabData.fabOffset.col,
          fabData.fabOffset.row
        );
        edges = calculated.edges;
        nodes = calculated.nodes;
        stationData = calculated.stations;
      } else {
        // 기존 방식: fabData에 포함된 데이터 사용
        edges = fabData.edges ?? [];
        nodes = fabData.nodes ?? [];
        stationData = fabData.stationData ?? [];
      }

      const params: FabInitParams = {
        fabId: fabData.fabId,
        sharedBuffer: fabData.sharedBuffer,
        sensorPointBuffer: fabData.sensorPointBuffer,
        edges,
        nodes,
        config: this.config,
        vehicleConfigs: fabData.vehicleConfigs,
        numVehicles: fabData.numVehicles,
        transferMode: fabData.transferMode,
        stationData,
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
   * Calculate fab-specific data from shared map data
   * (Based on fabUtils.ts createFabGridSeparated logic)
   */
  private calculateFabData(
    sharedMapData: SharedMapData,
    fabIndex: number,
    col: number,
    row: number
  ): { edges: Edge[]; nodes: Node[]; stations: StationRawData[] } {
    const { originalEdges, originalNodes, originalStations, gridX, gridY } = sharedMapData;

    // Calculate bounds for offset
    const bounds = this.getNodeBounds(originalNodes);
    const xOffset = bounds.width * 1.1;
    const yOffset = bounds.height * 1.1;

    const idOffset = fabIndex * 1000;
    const currentXOffset = col * xOffset;
    const currentYOffset = row * yOffset;

    if (fabIndex === 0) {
      // Original fab (no offset)
      return {
        edges: [...originalEdges],
        nodes: [...originalNodes],
        stations: [...originalStations],
      };
    }

    // Clone with offset
    const nodes = originalNodes.map(node => ({
      ...node,
      node_name: this.addOffsetToId(node.node_name, idOffset),
      editor_x: node.editor_x + currentXOffset,
      editor_y: node.editor_y + currentYOffset,
    }));

    const edges = originalEdges.map(edge => {
      const newWaypoints = edge.waypoints.map(wp => this.addOffsetToId(wp, idOffset));

      let newRenderingPoints = edge.renderingPoints;
      if (edge.renderingPoints) {
        newRenderingPoints = edge.renderingPoints.map(point =>
          new THREE.Vector3(
            point.x + currentXOffset,
            point.y + currentYOffset,
            point.z
          )
        );
      }

      return {
        ...edge,
        edge_name: this.addOffsetToId(edge.edge_name, idOffset),
        from_node: this.addOffsetToId(edge.from_node, idOffset),
        to_node: this.addOffsetToId(edge.to_node, idOffset),
        waypoints: newWaypoints,
        renderingPoints: newRenderingPoints,
      };
    });

    const stations = originalStations.map(station => ({
      ...station,
      station_name: this.createFabStationName(station.station_name, col, row),
      nearest_edge: this.createFabEdgeName(station.nearest_edge, fabIndex),
      position: {
        x: station.position.x + currentXOffset,
        y: station.position.y + currentYOffset,
        z: station.position.z,
      },
    }));

    return { edges, nodes, stations };
  }

  /**
   * Helper: Get node bounds (from fabUtils.ts)
   */
  private getNodeBounds(nodes: Node[]): { width: number; height: number; xMin: number; xMax: number; yMin: number; yMax: number } {
    if (nodes.length === 0) {
      return { xMin: 0, xMax: 0, yMin: 0, yMax: 0, width: 0, height: 0 };
    }

    let xMin = Infinity;
    let xMax = -Infinity;
    let yMin = Infinity;
    let yMax = -Infinity;

    for (const node of nodes) {
      if (node.editor_x < xMin) xMin = node.editor_x;
      if (node.editor_x > xMax) xMax = node.editor_x;
      if (node.editor_y < yMin) yMin = node.editor_y;
      if (node.editor_y > yMax) yMax = node.editor_y;
    }

    return {
      xMin,
      xMax,
      yMin,
      yMax,
      width: xMax - xMin,
      height: yMax - yMin,
    };
  }

  /**
   * Helper: Add offset to ID (from fabUtils.ts)
   */
  private addOffsetToId(name: string, offset: number): string {
    const match = /^(.*)(\d{4})$/.exec(name);
    if (!match) {
      return name;
    }

    const prefix = match[1];
    const numStr = match[2];
    const num = Number.parseInt(numStr, 10);
    const newNum = num + offset;

    return `${prefix}${newNum.toString().padStart(4, '0')}`;
  }

  /**
   * Helper: Create fab station name (from fabUtils.ts)
   */
  private createFabStationName(originalName: string, col: number, row: number): string {
    if (col === 0 && row === 0) {
      return originalName;
    }
    return `${originalName}_fab_${col}_${row}`;
  }

  /**
   * Helper: Create fab edge name (from fabUtils.ts)
   */
  private createFabEdgeName(originalEdgeName: string, fabIndex: number): string {
    if (fabIndex === 0) {
      return originalEdgeName;
    }
    const idOffset = fabIndex * 1000;
    return this.addOffsetToId(originalEdgeName, idOffset);
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
