// shmSimulator/core/SimulationEngine.ts

import { FabContext, type FabInitParams } from "./FabContext";
import type { InitPayload, SimulationConfig, FabInitData, SharedMapData, SharedMapRef, FabRenderOffset, FabRenderAssignment } from "../types";
import { createDefaultConfig } from "../types";
import { getDijkstraPerformanceStats } from "@/common/vehicle/logic/Dijkstra";
import { RollingPerformanceStats } from "@/common/performance/RollingPerformanceStats";
import { DevLogger } from "@/logger";
import type { Node } from "@/types";

export class SimulationEngine {
  // === Fab Contexts ===
  /** Map of Fab ID (e.g., "fab_A", "fab_B") to FabContext instances */
  private readonly fabContexts: Map<string, FabContext> = new Map();

  // === Shared Map Reference (최적화 모드) ===
  /**
   * 공유 맵 참조 - 모든 Fab이 같은 맵 데이터를 참조
   * "평행우주" 개념: 같은 맵에서 시뮬레이션하지만 fab간 충돌 없음
   */
  private sharedMapRef: SharedMapRef | null = null;

  // === Runtime ===
  private config: SimulationConfig;
  private isRunning: boolean = false;
  private loopHandle: ReturnType<typeof setInterval> | null = null;

  // === Performance Monitoring ===
  private readonly perfStats: RollingPerformanceStats;
  private lastPerfReportTime: number = 0;
  private readonly PERF_REPORT_INTERVAL = 5000; // 5 seconds

  // === Timing ===
  private lastStepTime: number = 0;
  /** 시뮬레이션 누적 시간 (ms) */
  private simulationTime: number = 0;

  constructor() {
    this.config = createDefaultConfig();
    this.perfStats = new RollingPerformanceStats(5000, 60); // 5 second window, 60fps target
  }

  /**
   * Handle external command for a specific fab
   * @param fabId - Unique identifier for the fab (e.g., "fab_A", "fab_B")
   */
  handleCommand(fabId: string, command: unknown): void {
    const context = this.fabContexts.get(fabId);
    if (!context) {
      return;
    }
    context.handleCommand(command);
  }

  /**
   * Initialize from payload (called from Worker)
   * @returns Record of Fab ID to actual vehicle count
   */
  init(payload: InitPayload): Record<string, number> {

    // Update config from payload
    this.config = payload.config;

    // DevLogger 활성화 설정
    if (this.config.devLogEnabled !== undefined) {
      DevLogger.setEnabled(this.config.devLogEnabled);
    }

    const fabVehicleCounts: Record<string, number> = {};

    // [최적화 모드] sharedMapData가 있으면 SharedMapRef 한 번만 생성 (복제 없음!)
    if (payload.sharedMapData) {
      this.sharedMapRef = this.buildSharedMapRef(payload.sharedMapData);
    }

    // Initialize each fab
    for (const fabData of payload.fabs) {
      let params: FabInitParams;

      // Fab별 config 병합 (전역 config + fab override)
      const fabConfig: SimulationConfig = fabData.config
        ? { ...this.config, ...fabData.config }
        : this.config;

      if (this.sharedMapRef && fabData.fabOffset) {
        // [최적화 모드] 공유 맵 참조 + fab offset 사용 (복제 없음!)
        const fabOffset = this.calculateFabOffset(
          payload.sharedMapData!,
          fabData.fabOffset.col,
          fabData.fabOffset.row
        );

        params = {
          fabId: fabData.fabId,
          sharedBuffer: fabData.sharedBuffer,
          sensorPointBuffer: fabData.sensorPointBuffer,
          pathBuffer: fabData.pathBuffer,
          checkpointBuffer: fabData.checkpointBuffer,
          sharedMapRef: this.sharedMapRef,
          fabOffset,
          config: fabConfig,
          vehicleConfigs: fabData.vehicleConfigs,
          numVehicles: fabData.numVehicles,
          transferMode: fabData.transferMode,
          memoryAssignment: fabData.memoryAssignment,
        };

      } else {
        // [레거시 모드] fab별 데이터 직접 사용
        params = {
          fabId: fabData.fabId,
          sharedBuffer: fabData.sharedBuffer,
          sensorPointBuffer: fabData.sensorPointBuffer,
          pathBuffer: fabData.pathBuffer,
          checkpointBuffer: fabData.checkpointBuffer,
          edges: fabData.edges ?? [],
          nodes: fabData.nodes ?? [],
          stationData: fabData.stationData ?? [],
          config: fabConfig,
          vehicleConfigs: fabData.vehicleConfigs,
          numVehicles: fabData.numVehicles,
          transferMode: fabData.transferMode,
          memoryAssignment: fabData.memoryAssignment,
        };
      }

      const context = new FabContext(params);
      this.fabContexts.set(fabData.fabId, context);
      fabVehicleCounts[fabData.fabId] = context.getActualNumVehicles();

    }

    return fabVehicleCounts;
  }

  /**
   * Build shared map reference from SharedMapData (한 번만 호출)
   * 모든 Fab이 이 참조를 공유하여 메모리 절약
   */
  private buildSharedMapRef(sharedMapData: SharedMapData): SharedMapRef {
    const { originalEdges, originalNodes, originalStations } = sharedMapData;

    // edgeNameToIndex 빌드 (한 번만)
    const edgeNameToIndex = new Map<string, number>();
    for (let idx = 0; idx < originalEdges.length; idx++) {
      edgeNameToIndex.set(originalEdges[idx].edge_name, idx);
    }

    // nodeNameToIndex 빌드 (한 번만)
    const nodeNameToIndex = new Map<string, number>();
    for (let idx = 0; idx < originalNodes.length; idx++) {
      nodeNameToIndex.set(originalNodes[idx].node_name, idx);
    }

    return {
      edges: originalEdges,
      nodes: originalNodes,
      edgeNameToIndex,
      nodeNameToIndex,
      stations: originalStations,
    };
  }

  /**
   * Calculate fab render offset (렌더링용)
   */
  private calculateFabOffset(sharedMapData: SharedMapData, col: number, row: number): FabRenderOffset {
    const bounds = this.getNodeBounds(sharedMapData.originalNodes);
    return {
      x: col * bounds.width * 1.1,
      y: row * bounds.height * 1.1,
    };
  }

  /**
   * Helper: Get node bounds
   */
  private getNodeBounds(nodes: Node[]): { width: number; height: number } {
    if (nodes.length === 0) {
      return { width: 0, height: 0 };
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
      width: xMax - xMin,
      height: yMax - yMin,
    };
  }

  /**
   * Add a new fab dynamically
   */
  addFab(fabData: FabInitData, globalConfig: SimulationConfig): number {
    if (this.fabContexts.has(fabData.fabId)) {
      return this.fabContexts.get(fabData.fabId)!.getActualNumVehicles();
    }

    // Fab별 config 병합 (전역 config + fab override)
    const fabConfig: SimulationConfig = fabData.config
      ? { ...globalConfig, ...fabData.config }
      : globalConfig;

    const params: FabInitParams = {
      fabId: fabData.fabId,
      sharedBuffer: fabData.sharedBuffer,
      sensorPointBuffer: fabData.sensorPointBuffer,
      pathBuffer: fabData.pathBuffer,
      checkpointBuffer: fabData.checkpointBuffer,
      edges: fabData.edges ?? [],
      nodes: fabData.nodes ?? [],
      config: fabConfig,
      vehicleConfigs: fabData.vehicleConfigs,
      numVehicles: fabData.numVehicles,
      transferMode: fabData.transferMode,
      stationData: fabData.stationData ?? [],
      memoryAssignment: fabData.memoryAssignment,
    };

    const context = new FabContext(params);
    this.fabContexts.set(fabData.fabId, context);

    return context.getActualNumVehicles();
  }

  /**
   * Remove a fab dynamically
   * @param fabId - Unique identifier for the fab to remove
   */
  removeFab(fabId: string): boolean {
    const context = this.fabContexts.get(fabId);
    if (!context) {
      return false;
    }

    context.dispose();
    this.fabContexts.delete(fabId);

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

  }

  /**
   * Single simulation step - updates all fabs
   */
  step(delta: number): void {
    if (!this.isRunning) return;

    const stepStart = performance.now();
    const clampedDelta = Math.min(delta, this.config.maxDelta);

    // 시뮬레이션 시간 누적 (ms 단위)
    this.simulationTime += clampedDelta * 1000;

    // Update all fab contexts
    for (const context of this.fabContexts.values()) {
      context.step(clampedDelta, this.simulationTime);
    }

    // Measure step time
    const stepEnd = performance.now();
    const stepTimeMs = stepEnd - stepStart;
    this.perfStats.addSample(stepTimeMs);

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
    const metrics = this.perfStats.getMetrics();
    if (!metrics) return;

    // Get Dijkstra stats
    const dijkstraStats = getDijkstraPerformanceStats();

    // Get per-fab vehicle counts
    const fabVehicleCounts = this.getVehicleCountsByFab();

    self.postMessage({
      type: "PERF_STATS",
      // Basic stats (backward compatibility)
      avgStepMs: metrics.mean,
      minStepMs: metrics.min,
      maxStepMs: metrics.max,
      // Extended stats (NEW: GC spike detection)
      variance: metrics.variance,
      stdDev: metrics.stdDev,
      cv: metrics.cv,
      p50: metrics.p50,
      p95: metrics.p95,
      p99: metrics.p99,
      sampleCount: metrics.sampleCount,
      // Dijkstra stats
      dijkstra: dijkstraStats.count > 0 ? {
        count: dijkstraStats.count,
        avgTimeMs: dijkstraStats.totalTime / dijkstraStats.count,
        minTimeMs: dijkstraStats.minTime,
        maxTimeMs: dijkstraStats.maxTime,
      } : undefined,
      // Fab vehicle counts
      fabVehicleCounts,
    });
  }

  /**
   * Set render buffers for all fabs (연속 레이아웃)
   * Main Thread에서 SET_RENDER_BUFFER 메시지로 호출됨
   */
  setRenderBuffers(
    vehicleRenderBuffer: SharedArrayBuffer,
    sensorRenderBuffer: SharedArrayBuffer,
    fabAssignments: FabRenderAssignment[],
    totalVehicles: number
  ): void {

    let vehicleStartIndex = 0;

    for (const assignment of fabAssignments) {
      const context = this.fabContexts.get(assignment.fabId);
      if (!context) {
        // Skip silently - fab may not be initialized yet
        vehicleStartIndex += assignment.actualVehicles;
        continue;
      }

      context.setRenderBuffer(
        vehicleRenderBuffer,
        sensorRenderBuffer,
        assignment.vehicleRenderOffset,
        assignment.actualVehicles,
        totalVehicles,
        vehicleStartIndex
      );


      vehicleStartIndex += assignment.actualVehicles;
    }
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

    // Clear shared map reference
    this.sharedMapRef = null;

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

  /**
   * Set logger port for all fabs
   * Edge transit 로그를 Logger Worker로 전송하기 위한 MessagePort 설정
   *
   * @param port MessagePort connected to Logger Worker
   * @param workerId Worker ID (0~255) for logging
   */
  setLoggerPort(port: MessagePort, workerId: number = 0): void {
    for (const context of this.fabContexts.values()) {
      context.setLoggerPort(port, workerId);
    }
  }

  /**
   * Get current simulation time (ms)
   */
  getSimulationTime(): number {
    return this.simulationTime;
  }

  /**
   * Get lock table data for a specific fab
   * @param fabId - Unique identifier for the fab
   * @returns Lock table data or null if fab not found
   */
  getLockTableData(fabId: string): import("../types").LockTableData | null {
    const context = this.fabContexts.get(fabId);
    if (!context) {
      return null;
    }
    return context.getLockTableData();
  }
}
