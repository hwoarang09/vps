// shmSimulator/MultiWorkerController.ts
// 멀티 워커 환경에서 여러 워커를 생성하고 관리하는 컨트롤러

import type {
  WorkerMessage,
  MainMessage,
  InitPayload,
  SimulationConfig,
  VehicleInitConfig,
  FabInitData,
  SharedMapData,
  FabMemoryAssignment,
} from "./types";
import { TransferMode, createDefaultConfig } from "./types";
import { MemoryLayoutManager, FabMemoryConfig, MemoryLayout, WorkerAssignment, RenderBufferLayout } from "./MemoryLayoutManager";
import type { Edge } from "@/types/edge";
import type { Node } from "@/types";
import type { StationRawData } from "@/types/station";
import { LoggerController, type LoggerMode } from "@/logger";

/**
 * Fab 초기화 파라미터 (MultiWorkerController용)
 */
export interface MultiFabInitParams {
  fabId: string;
  edges: Edge[];
  nodes: Node[];
  numVehicles: number;
  maxVehicles?: number;
  vehicleConfigs?: VehicleInitConfig[];
  transferMode?: TransferMode;
  stations: ReadonlyArray<unknown>;
  /** Fab별 SimulationConfig 오버라이드 (linearMaxSpeed, curveMaxSpeed, lockWaitDistance 등) */
  config?: Partial<SimulationConfig>;
}

export type { FabInitParams } from "@/shmSimulator/index";

/**
 * 워커별 성능 통계
 */
export interface WorkerPerfStats {
  workerIndex: number;
  // Basic stats
  avgStepMs: number;
  minStepMs: number;
  maxStepMs: number;
  // Extended stats (GC spike detection)
  variance: number;
  stdDev: number;
  cv: number;
  p50: number;
  p95: number;
  p99: number;
  sampleCount: number;
}

/**
 * 워커 정보
 */
interface WorkerInfo {
  worker: Worker;
  workerIndex: number;
  fabIds: string[];
  isInitialized: boolean;
  perfStats: WorkerPerfStats;
}

/**
 * MultiWorkerController
 * - 여러 워커를 생성하고 관리
 * - Worker 버퍼와 Render 버퍼 분리
 * - Render 버퍼는 actualVehicles 기준 연속 레이아웃
 */
export class MultiWorkerController {
  private config: SimulationConfig = createDefaultConfig();
  private readonly layoutManager = new MemoryLayoutManager();
  private layout: MemoryLayout | null = null;
  private renderLayout: RenderBufferLayout | null = null;

  // Worker 버퍼 (계산용)
  private vehicleBuffer: SharedArrayBuffer | null = null;
  private sensorBuffer: SharedArrayBuffer | null = null;
  private pathBuffer: SharedArrayBuffer | null = null;

  // Render 버퍼 (렌더링용 - 연속 레이아웃)
  private vehicleRenderBuffer: SharedArrayBuffer | null = null;
  private sensorRenderBuffer: SharedArrayBuffer | null = null;

  // 워커 관리
  private workers: WorkerInfo[] = [];
  private readonly fabToWorkerMap: Map<string, number> = new Map();

  // Fab별 정보
  private readonly fabConfigs: Map<string, MultiFabInitParams> = new Map();
  private readonly fabVehicleCounts: Map<string, number> = new Map();

  // 상태
  private isInitialized: boolean = false;
  private isRunning: boolean = false;

  // Logger
  private loggerController: LoggerController | null = null;

  // 콜백
  private onPerfStatsCallback: ((workerStats: WorkerPerfStats[]) => void) | null = null;
  private onErrorCallback: ((error: string) => void) | null = null;

  onPerfStats(callback: (workerStats: WorkerPerfStats[]) => void): void {
    this.onPerfStatsCallback = callback;
  }

  onError(callback: (error: string) => void): void {
    this.onErrorCallback = callback;
  }

  /**
   * Initialize with multiple fabs and workers
   */
  async init(params: {
    fabs: MultiFabInitParams[];
    workerCount?: number;
    config?: Partial<SimulationConfig>;
    sharedMapData?: SharedMapData;
  }): Promise<void> {
    const { fabs, config = {}, sharedMapData } = params;

    this.config = { ...createDefaultConfig(), ...config };

    const defaultWorkerCount = typeof navigator === 'undefined'
      ? Math.min(4, fabs.length)
      : Math.min(navigator.hardwareConcurrency || 4, fabs.length);
    const workerCount = params.workerCount ?? defaultWorkerCount;


    // 1. Fab 설정 저장 및 Worker 메모리 레이아웃 계산
    const fabMemoryConfigs: FabMemoryConfig[] = [];
    for (const fab of fabs) {
      this.fabConfigs.set(fab.fabId, fab);
      fabMemoryConfigs.push({
        fabId: fab.fabId,
        maxVehicles: fab.maxVehicles ?? this.config.maxVehicles,
      });
    }

    this.layout = this.layoutManager.calculateLayout(fabMemoryConfigs);
    this.layoutManager.printLayoutInfo(this.layout);

    // 2. Worker 버퍼 생성
    const workerBuffers = this.layoutManager.createWorkerBuffers(this.layout);
    this.vehicleBuffer = workerBuffers.vehicleBuffer;
    this.sensorBuffer = workerBuffers.sensorBuffer;
    this.pathBuffer = workerBuffers.pathBuffer;


    // 3. 워커별 Fab 분배
    const workerAssignments = this.layoutManager.distributeToWorkers(
      fabMemoryConfigs,
      workerCount,
      this.layout
    );
    this.layoutManager.printWorkerAssignments(workerAssignments);

    // 4. 워커 생성 및 초기화 (INIT 메시지)
    const initPromises: Promise<void>[] = [];

    for (const assignment of workerAssignments) {
      const worker = new Worker(
        new URL("./worker.entry.ts", import.meta.url),
        { type: "module" }
      );

      const workerInfo: WorkerInfo = {
        worker,
        workerIndex: assignment.workerIndex,
        fabIds: assignment.fabIds,
        isInitialized: false,
        perfStats: {
          workerIndex: assignment.workerIndex,
          avgStepMs: 0,
          minStepMs: 0,
          maxStepMs: 0,
          variance: 0,
          stdDev: 0,
          cv: 0,
          p50: 0,
          p95: 0,
          p99: 0,
          sampleCount: 0,
        },
      };

      this.workers.push(workerInfo);

      for (const fabId of assignment.fabIds) {
        this.fabToWorkerMap.set(fabId, assignment.workerIndex);
      }

      const promise = this.initWorker(workerInfo, assignment, sharedMapData);
      initPromises.push(promise);
    }

    await Promise.all(initPromises);

    // 5. 렌더 버퍼 생성 (actualVehicles가 확정된 후)
    this.renderLayout = this.layoutManager.calculateRenderLayout(this.fabVehicleCounts);
    this.layoutManager.printRenderLayoutInfo(this.renderLayout);

    const renderBuffers = this.layoutManager.createRenderBuffers(this.renderLayout);
    this.vehicleRenderBuffer = renderBuffers.vehicleRenderBuffer;
    this.sensorRenderBuffer = renderBuffers.sensorRenderBuffer;


    // 6. SET_RENDER_BUFFER 메시지 전송 (각 워커에게 렌더 버퍼 + offset 전달)
    this.sendRenderBufferToWorkers();

    this.isInitialized = true;
  }

  /**
   * Send render buffer to all workers (초기화 시 한 번만)
   */
  private sendRenderBufferToWorkers(): void {
    if (!this.vehicleRenderBuffer || !this.sensorRenderBuffer || !this.renderLayout) return;

    const message: WorkerMessage = {
      type: "SET_RENDER_BUFFER",
      vehicleRenderBuffer: this.vehicleRenderBuffer,
      sensorRenderBuffer: this.sensorRenderBuffer,
      fabAssignments: this.renderLayout.fabRenderAssignments,
      totalVehicles: this.renderLayout.totalVehicles,
    };

    for (const workerInfo of this.workers) {
      workerInfo.worker.postMessage(message);
    }

  }

  /**
   * Create FabInitData with shared map (grid mode)
   */
  private createFabInitDataWithSharedMap(
    fabAssignment: FabMemoryAssignment,
    fabConfig: MultiFabInitParams,
    sharedMapData: SharedMapData
  ): FabInitData {
    const fabIdMatch = /fab_(\d+)_(\d+)/.exec(fabAssignment.fabId);
    const col = fabIdMatch ? Number.parseInt(fabIdMatch[1], 10) : 0;
    const row = fabIdMatch ? Number.parseInt(fabIdMatch[2], 10) : 0;
    const fabIndex = row * sharedMapData.gridX + col;

    return {
      fabId: fabAssignment.fabId,
      sharedBuffer: this.vehicleBuffer!,
      sensorPointBuffer: this.sensorBuffer!,
      pathBuffer: this.pathBuffer!,
      edges: undefined,
      nodes: undefined,
      stationData: undefined,
      fabOffset: { fabIndex, col, row },
      vehicleConfigs: fabConfig.vehicleConfigs ?? [],
      numVehicles: fabConfig.numVehicles,
      transferMode: fabConfig.transferMode ?? TransferMode.LOOP,
      memoryAssignment: fabAssignment,
      config: fabConfig.config,
    };
  }

  /**
   * Create FabInitData with local map (single fab mode)
   */
  private createFabInitDataWithLocalMap(
    fabAssignment: FabMemoryAssignment,
    fabConfig: MultiFabInitParams
  ): FabInitData {
    return {
      fabId: fabAssignment.fabId,
      sharedBuffer: this.vehicleBuffer!,
      sensorPointBuffer: this.sensorBuffer!,
      pathBuffer: this.pathBuffer!,
      edges: fabConfig.edges,
      nodes: fabConfig.nodes,
      stationData: fabConfig.stations as StationRawData[],
      fabOffset: undefined,
      vehicleConfigs: fabConfig.vehicleConfigs ?? [],
      numVehicles: fabConfig.numVehicles,
      transferMode: fabConfig.transferMode ?? TransferMode.LOOP,
      memoryAssignment: fabAssignment,
      config: fabConfig.config,
    };
  }

  /**
   * Prepare FabInitData list for worker initialization
   */
  private prepareFabInitDataList(
    assignment: WorkerAssignment,
    sharedMapData?: SharedMapData
  ): FabInitData[] {
    const fabInitDataList: FabInitData[] = [];

    for (const fabAssignment of assignment.fabAssignments) {
      const fabConfig = this.fabConfigs.get(fabAssignment.fabId);
      if (!fabConfig) continue;

      const fabInitData = sharedMapData
        ? this.createFabInitDataWithSharedMap(fabAssignment, fabConfig, sharedMapData)
        : this.createFabInitDataWithLocalMap(fabAssignment, fabConfig);

      fabInitDataList.push(fabInitData);
    }

    return fabInitDataList;
  }

  private initWorker(workerInfo: WorkerInfo, assignment: WorkerAssignment, sharedMapData?: SharedMapData): Promise<void> {
    return new Promise((resolve, reject) => {
      const { worker } = workerInfo;

      // 1. Prepare initialization data
      const fabInitDataList = this.prepareFabInitDataList(assignment, sharedMapData);

      const payload: InitPayload = {
        config: this.config,
        fabs: fabInitDataList,
        sharedMapData,
      };

      // 2. Setup event handlers
      worker.onmessage = (e: MessageEvent<MainMessage>) => {
        this.handleWorkerMessage(workerInfo, e.data);

        if (e.data.type === "INITIALIZED") {
          workerInfo.isInitialized = true;

          for (const [fabId, count] of Object.entries(e.data.fabVehicleCounts)) {
            this.fabVehicleCounts.set(fabId, count);
          }

          resolve();
        } else if (e.data.type === "ERROR") {
          reject(new Error(e.data.error));
        }
      };

      worker.onerror = (error) => {
        this.onErrorCallback?.(error.message);
        reject(new Error(error.message));
      };

      // 3. Send initialization message
      const message: WorkerMessage = { type: "INIT", payload };
      worker.postMessage(message);

    });
  }

  private handleWorkerMessage(workerInfo: WorkerInfo, message: MainMessage): void {
    switch (message.type) {
      case "READY":
        break;

      case "PERF_STATS":
        workerInfo.perfStats.avgStepMs = message.avgStepMs;
        workerInfo.perfStats.minStepMs = message.minStepMs;
        workerInfo.perfStats.maxStepMs = message.maxStepMs;
        workerInfo.perfStats.variance = message.variance;
        workerInfo.perfStats.stdDev = message.stdDev;
        workerInfo.perfStats.cv = message.cv;
        workerInfo.perfStats.p50 = message.p50;
        workerInfo.perfStats.p95 = message.p95;
        workerInfo.perfStats.p99 = message.p99;
        workerInfo.perfStats.sampleCount = message.sampleCount;

        if (this.onPerfStatsCallback) {
          const allStats = this.workers.map(w => ({ ...w.perfStats }));
          this.onPerfStatsCallback(allStats);
        }
        break;

      case "ERROR":
        this.onErrorCallback?.(message.error);
        break;
    }
  }

  start(): void {
    if (!this.isInitialized) {
      return;
    }

    for (const workerInfo of this.workers) {
      workerInfo.worker.postMessage({ type: "START" } as WorkerMessage);
    }

    this.isRunning = true;
  }

  stop(): void {
    for (const workerInfo of this.workers) {
      workerInfo.worker.postMessage({ type: "STOP" } as WorkerMessage);
    }

    this.isRunning = false;
  }

  pause(): void {
    for (const workerInfo of this.workers) {
      workerInfo.worker.postMessage({ type: "PAUSE" } as WorkerMessage);
    }
    this.isRunning = false;
  }

  resume(): void {
    for (const workerInfo of this.workers) {
      workerInfo.worker.postMessage({ type: "RESUME" } as WorkerMessage);
    }
    this.isRunning = true;
  }

  sendCommand(fabId: string, payload: unknown): void {
    const workerIndex = this.fabToWorkerMap.get(fabId);
    if (workerIndex === undefined) {
      return;
    }

    const workerInfo = this.workers[workerIndex];
    if (!workerInfo) return;

    const message: WorkerMessage = { type: "COMMAND", fabId, payload };
    workerInfo.worker.postMessage(message);
  }

  async dispose(): Promise<void> {
    // Logger 정리
    if (this.loggerController) {
      const totalRecords = await this.loggerController.close();
      this.loggerController = null;
    }

    if (this.workers.length === 0) {
      return;
    }


    for (const workerInfo of this.workers) {
      this.disposeWorker(workerInfo);
    }

    this.workers = [];
    this.fabToWorkerMap.clear();
    this.fabConfigs.clear();
    this.fabVehicleCounts.clear();
    this.vehicleBuffer = null;
    this.sensorBuffer = null;
    this.pathBuffer = null;
    this.vehicleRenderBuffer = null;
    this.sensorRenderBuffer = null;
    this.layout = null;
    this.renderLayout = null;
    this.isInitialized = false;
    this.isRunning = false;

  }

  private disposeWorker(workerInfo: WorkerInfo): void {
    const { worker, workerIndex } = workerInfo;

    const terminateWorker = () => {
      worker.terminate();
    };

    const onMessage = (e: MessageEvent<MainMessage>) => {
      if (e.data.type === "DISPOSED") {
        worker.removeEventListener("message", onMessage);
        terminateWorker();
      }
    };

    worker.addEventListener("message", onMessage);
    worker.postMessage({ type: "DISPOSE" } as WorkerMessage);

    setTimeout(() => {
      worker.removeEventListener("message", onMessage);
      terminateWorker();
    }, 500);
  }

  // =========================================================================
  // Data Access (for rendering) - 연속 레이아웃 렌더 버퍼 사용
  // =========================================================================

  /**
   * Get vehicle render buffer (연속 레이아웃, Main Thread에서 직접 사용)
   */
  getVehicleRenderBuffer(): SharedArrayBuffer | null {
    return this.vehicleRenderBuffer;
  }

  /**
   * Get sensor render buffer (연속 레이아웃, Main Thread에서 직접 사용)
   */
  getSensorRenderBuffer(): SharedArrayBuffer | null {
    return this.sensorRenderBuffer;
  }

  /**
   * Get vehicle render data as Float32Array (전체 연속 데이터)
   */
  getVehicleData(): Float32Array | null {
    if (!this.vehicleRenderBuffer) return null;
    return new Float32Array(this.vehicleRenderBuffer);
  }

  /**
   * Get sensor render data as Float32Array (전체 연속 데이터)
   */
  getSensorPointData(): Float32Array | null {
    if (!this.sensorRenderBuffer) return null;
    return new Float32Array(this.sensorRenderBuffer);
  }

  /**
   * Get vehicle full data (worker buffer - 22 floats per vehicle)
   * Use this for reading complete vehicle state (e.g., IndividualControlPanel)
   */
  getVehicleFullData(): Float32Array | null {
    if (!this.vehicleBuffer) return null;
    return new Float32Array(this.vehicleBuffer);
  }

  /**
   * Get sensor full data (worker buffer)
   */
  getSensorFullData(): Float32Array | null {
    if (!this.sensorBuffer) return null;
    return new Float32Array(this.sensorBuffer);
  }

  /**
   * Get path data (worker buffer - Int32Array)
   * Layout: [pathLen, edge0, edge1, ..., edge99] per vehicle
   */
  getPathData(): Int32Array | null {
    if (!this.pathBuffer) return null;
    return new Int32Array(this.pathBuffer);
  }

  /**
   * Get render layout info (렌더러에서 필요시 사용)
   */
  getRenderLayout(): RenderBufferLayout | null {
    return this.renderLayout;
  }

  /**
   * Get worker layout info (for accessing full vehicle data)
   */
  getWorkerLayout(): MemoryLayout | null {
    return this.layout;
  }

  /**
   * Get total vehicle count
   */
  getTotalVehicleCount(): number {
    return this.renderLayout?.totalVehicles ?? 0;
  }

  getActualNumVehicles(fabId: string): number {
    return this.fabVehicleCounts.get(fabId) ?? 0;
  }

  getFabIds(): string[] {
    return Array.from(this.fabConfigs.keys());
  }

  getWorkerCount(): number {
    return this.workers.length;
  }

  getWorkerAssignments(): Array<{ workerIndex: number; fabIds: string[] }> {
    return this.workers.map(w => ({
      workerIndex: w.workerIndex,
      fabIds: w.fabIds,
    }));
  }

  getIsRunning(): boolean {
    return this.isRunning;
  }

  getIsInitialized(): boolean {
    return this.isInitialized;
  }

  // =========================================================================
  // Edge Transit Logging
  // =========================================================================

  /**
   * Enable edge transit logging
   *
   * @param mode - "OPFS" for local disk, "CLOUD" for remote upload
   * @param sessionId - Optional session identifier for log files
   */
  async enableLogging(mode: LoggerMode = "OPFS", sessionId?: string): Promise<void> {
    if (this.loggerController) {
      return;
    }

    this.loggerController = new LoggerController({
      mode,
      sessionId: sessionId ?? `sim_${Date.now()}`,
      onReady: () => {},
      onFlushed: (count) => {},
      onUploaded: (url, count) => {},
      onClosed: (total) => {},
      onError: (error) => {},
    });

    await this.loggerController.init();

    // 각 워커에게 Logger port 전달
    for (const workerInfo of this.workers) {
      const port = this.loggerController.createPortForWorker();
      const message: WorkerMessage = {
        type: "SET_LOGGER_PORT",
        port,
        workerId: workerInfo.workerIndex,
      };
      workerInfo.worker.postMessage(message, [port]);
    }

  }

  /**
   * Flush all buffered logs
   */
  flushLogs(): void {
    if (!this.loggerController) {
      return;
    }
    this.loggerController.flush();
  }

  /**
   * Check if logging is enabled
   */
  isLoggingEnabled(): boolean {
    return this.loggerController !== null;
  }

  /**
   * Download current log file
   * Returns the log data directly from Logger Worker
   */
  async downloadLogs(): Promise<{ buffer: ArrayBuffer; fileName: string; recordCount: number } | null> {
    if (!this.loggerController) {
      return null;
    }

    return this.loggerController.download();
  }

  /**
   * List all log files in OPFS
   */
  async listLogFiles(): Promise<import("@/logger/protocol").LogFileInfo[] | null> {
    if (!this.loggerController) {
      return null;
    }

    return this.loggerController.listFiles();
  }

  /**
   * Download specific log file by name
   */
  async downloadLogFile(fileName: string): Promise<{ buffer: ArrayBuffer; fileName: string; recordCount: number } | null> {
    if (!this.loggerController) {
      return null;
    }

    return this.loggerController.downloadFile(fileName);
  }

  /**
   * Delete specific log file by name
   */
  async deleteLogFile(fileName: string): Promise<void> {
    if (!this.loggerController) {
      return;
    }

    return this.loggerController.deleteFile(fileName);
  }
}
