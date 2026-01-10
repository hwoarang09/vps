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
} from "./types";
import { TransferMode, createDefaultConfig } from "./types";
import { MemoryLayoutManager, FabMemoryConfig, MemoryLayout, WorkerAssignment } from "./MemoryLayoutManager";
import type { Edge } from "@/types/edge";
import type { Node } from "@/types";
import type { StationRawData } from "@/types/station";

/**
 * Fab 초기화 파라미터 (MultiWorkerController용)
 * FabInitParams와 호환되도록 설계
 */
export interface MultiFabInitParams {
  fabId: string;
  edges: Edge[];
  nodes: Node[];
  numVehicles: number;
  maxVehicles?: number;  // 기본값: config.maxVehicles
  vehicleConfigs?: VehicleInitConfig[];
  transferMode?: TransferMode;
  stations: ReadonlyArray<unknown>;
}

// FabInitParams 호환 타입 (기존 store에서 사용)
export type { FabInitParams } from "@/shmSimulator/index";

/**
 * 워커별 성능 통계
 */
export interface WorkerPerfStats {
  workerIndex: number;
  avgStepMs: number;
  minStepMs: number;
  maxStepMs: number;
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
 * - MemoryLayoutManager를 사용하여 메모리 레이아웃 계산
 * - 하나의 큰 SharedArrayBuffer를 여러 워커가 공유
 */
export class MultiWorkerController {
  private config: SimulationConfig = createDefaultConfig();
  private readonly layoutManager = new MemoryLayoutManager();
  private layout: MemoryLayout | null = null;

  // 공유 버퍼
  private vehicleBuffer: SharedArrayBuffer | null = null;
  private sensorBuffer: SharedArrayBuffer | null = null;

  // 워커 관리
  private workers: WorkerInfo[] = [];
  private readonly fabToWorkerMap: Map<string, number> = new Map();  // fabId -> workerIndex

  // Fab별 정보
  private readonly fabConfigs: Map<string, MultiFabInitParams> = new Map();
  private readonly fabVehicleCounts: Map<string, number> = new Map();

  // 상태
  private isInitialized: boolean = false;
  private isRunning: boolean = false;

  // 콜백
  private onPerfStatsCallback: ((workerStats: WorkerPerfStats[]) => void) | null = null;
  private onErrorCallback: ((error: string) => void) | null = null;

  /**
   * Set callback for performance stats (각 워커별 성능 정보 배열)
   */
  onPerfStats(callback: (workerStats: WorkerPerfStats[]) => void): void {
    this.onPerfStatsCallback = callback;
  }

  /**
   * Set callback for errors
   */
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
    /**
     * 멀티 Fab 모드용 공유 맵 데이터
     * 원본 맵 데이터를 한 번만 전송하여 메모리 절약
     */
    sharedMapData?: SharedMapData;
  }): Promise<void> {
    const { fabs, config = {}, sharedMapData } = params;

    // Merge config
    this.config = { ...createDefaultConfig(), ...config };

    // 워커 수 결정 (기본: CPU 코어 수와 Fab 수 중 작은 값)
    const defaultWorkerCount = typeof navigator === 'undefined'
      ? Math.min(4, fabs.length)
      : Math.min(navigator.hardwareConcurrency || 4, fabs.length);
    const workerCount = params.workerCount ?? defaultWorkerCount;

    console.log(`[MultiWorkerController] Initializing with ${fabs.length} fabs, ${workerCount} workers`);

    // 1. Fab 설정 저장 및 메모리 레이아웃 계산
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

    // 2. 공유 버퍼 생성
    const buffers = this.layoutManager.createBuffers(this.layout);
    this.vehicleBuffer = buffers.vehicleBuffer;
    this.sensorBuffer = buffers.sensorBuffer;

    console.log(`[MultiWorkerController] Created SharedArrayBuffers`);
    console.log(`  Vehicle: ${(this.layout.vehicleBufferSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`  Sensor:  ${(this.layout.sensorBufferSize / 1024 / 1024).toFixed(2)} MB`);

    // 3. 워커별 Fab 분배
    const workerAssignments = this.layoutManager.distributeToWorkers(
      fabMemoryConfigs,
      workerCount,
      this.layout
    );
    this.layoutManager.printWorkerAssignments(workerAssignments);

    // 4. 워커 생성 및 초기화
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
        },
      };

      this.workers.push(workerInfo);

      // fabId -> workerIndex 매핑
      for (const fabId of assignment.fabIds) {
        this.fabToWorkerMap.set(fabId, assignment.workerIndex);
      }

      // 워커 초기화
      const promise = this.initWorker(workerInfo, assignment, sharedMapData);
      initPromises.push(promise);
    }

    await Promise.all(initPromises);

    this.isInitialized = true;
    console.log(`[MultiWorkerController] All workers initialized`);
  }

  /**
   * Initialize a single worker
   */
  private initWorker(workerInfo: WorkerInfo, assignment: WorkerAssignment, sharedMapData?: SharedMapData): Promise<void> {
    return new Promise((resolve, reject) => {
      const { worker } = workerInfo;

      // 메시지 핸들러 설정
      worker.onmessage = (e: MessageEvent<MainMessage>) => {
        this.handleWorkerMessage(workerInfo, e.data);

        if (e.data.type === "INITIALIZED") {
          workerInfo.isInitialized = true;

          // 각 Fab의 실제 차량 수 저장
          for (const [fabId, count] of Object.entries(e.data.fabVehicleCounts)) {
            this.fabVehicleCounts.set(fabId, count);
          }

          resolve();
        } else if (e.data.type === "ERROR") {
          reject(new Error(e.data.error));
        }
      };

      worker.onerror = (error) => {
        console.error(`[MultiWorkerController] Worker ${workerInfo.workerIndex} error:`, error);
        this.onErrorCallback?.(error.message);
        reject(new Error(error.message));
      };

      // Init 페이로드 생성
      const fabInitDataList: FabInitData[] = [];

      for (const fabAssignment of assignment.fabAssignments) {
        const fabConfig = this.fabConfigs.get(fabAssignment.fabId);
        if (!fabConfig) continue;

        // fabId에서 col, row 파싱 (fab_col_row 형식)
        const fabIdMatch = /fab_(\d+)_(\d+)/.exec(fabAssignment.fabId);
        const col = fabIdMatch ? Number.parseInt(fabIdMatch[1], 10) : 0;
        const row = fabIdMatch ? Number.parseInt(fabIdMatch[2], 10) : 0;
        const fabIndex = sharedMapData ? (row * sharedMapData.gridX + col) : 0;

        const fabInitData: FabInitData = {
          fabId: fabAssignment.fabId,
          sharedBuffer: this.vehicleBuffer!,
          sensorPointBuffer: this.sensorBuffer!,
          // sharedMapData가 있으면 edges/nodes/stationData를 보내지 않음 (메모리 절약)
          edges: sharedMapData ? undefined : fabConfig.edges,
          nodes: sharedMapData ? undefined : fabConfig.nodes,
          stationData: sharedMapData ? undefined : (fabConfig.stations as StationRawData[]),
          // sharedMapData가 있으면 fabOffset 추가
          fabOffset: sharedMapData ? { fabIndex, col, row } : undefined,
          vehicleConfigs: fabConfig.vehicleConfigs ?? [],
          numVehicles: fabConfig.numVehicles,
          transferMode: fabConfig.transferMode ?? TransferMode.LOOP,
          memoryAssignment: fabAssignment,
        };

        fabInitDataList.push(fabInitData);
      }

      const payload: InitPayload = {
        config: this.config,
        fabs: fabInitDataList,
        // sharedMapData가 있으면 포함 (원본 맵 데이터 한 번만 전송)
        sharedMapData,
      };

      const message: WorkerMessage = { type: "INIT", payload };
      worker.postMessage(message);

      console.log(`[MultiWorkerController] Worker ${workerInfo.workerIndex} init sent with ${fabInitDataList.length} fabs`);
    });
  }

  /**
   * Handle messages from workers
   */
  private handleWorkerMessage(workerInfo: WorkerInfo, message: MainMessage): void {
    switch (message.type) {
      case "READY":
        console.log(`[MultiWorkerController] Worker ${workerInfo.workerIndex} ready`);
        break;

      case "PERF_STATS":
        // 해당 워커의 성능 정보 업데이트
        workerInfo.perfStats.avgStepMs = message.avgStepMs;
        workerInfo.perfStats.minStepMs = message.minStepMs;
        workerInfo.perfStats.maxStepMs = message.maxStepMs;

        // 모든 워커의 성능 정보를 콜백으로 전달
        if (this.onPerfStatsCallback) {
          const allStats = this.workers.map(w => ({ ...w.perfStats }));
          this.onPerfStatsCallback(allStats);
        }
        break;

      case "ERROR":
        console.error(`[MultiWorkerController] Worker ${workerInfo.workerIndex} error:`, message.error);
        this.onErrorCallback?.(message.error);
        break;

      // INITIALIZED는 initWorker에서 처리
    }
  }

  /**
   * Start simulation on all workers
   */
  start(): void {
    if (!this.isInitialized) {
      console.warn("[MultiWorkerController] Not initialized");
      return;
    }

    for (const workerInfo of this.workers) {
      workerInfo.worker.postMessage({ type: "START" } as WorkerMessage);
    }

    this.isRunning = true;
    console.log(`[MultiWorkerController] Started ${this.workers.length} workers`);
  }

  /**
   * Stop simulation on all workers
   */
  stop(): void {
    for (const workerInfo of this.workers) {
      workerInfo.worker.postMessage({ type: "STOP" } as WorkerMessage);
    }

    this.isRunning = false;
    console.log(`[MultiWorkerController] Stopped`);
  }

  /**
   * Pause simulation
   */
  pause(): void {
    for (const workerInfo of this.workers) {
      workerInfo.worker.postMessage({ type: "PAUSE" } as WorkerMessage);
    }

    this.isRunning = false;
  }

  /**
   * Resume simulation
   */
  resume(): void {
    for (const workerInfo of this.workers) {
      workerInfo.worker.postMessage({ type: "RESUME" } as WorkerMessage);
    }

    this.isRunning = true;
  }

  /**
   * Send command to a specific fab
   */
  sendCommand(fabId: string, payload: unknown): void {
    const workerIndex = this.fabToWorkerMap.get(fabId);
    if (workerIndex === undefined) {
      console.warn(`[MultiWorkerController] Fab not found: ${fabId}`);
      return;
    }

    const workerInfo = this.workers[workerIndex];
    if (!workerInfo) return;

    const message: WorkerMessage = { type: "COMMAND", fabId, payload };
    workerInfo.worker.postMessage(message);
  }

  /**
   * Dispose all workers
   * 워커들이 정리를 완료할 때까지 대기 후 terminate
   */
  dispose(): void {
    if (this.workers.length === 0) {
      console.log("[MultiWorkerController] No workers to dispose");
      return;
    }

    console.log(`[MultiWorkerController] Disposing ${this.workers.length} workers...`);

    for (const workerInfo of this.workers) {
      this.disposeWorker(workerInfo);
    }

    this.workers = [];
    this.fabToWorkerMap.clear();
    this.fabConfigs.clear();
    this.fabVehicleCounts.clear();
    this.vehicleBuffer = null;
    this.sensorBuffer = null;
    this.layout = null;
    this.isInitialized = false;
    this.isRunning = false;

    console.log("[MultiWorkerController] Disposed");
  }

  /**
   * Dispose a single worker with proper cleanup
   */
  private disposeWorker(workerInfo: WorkerInfo): void {
    const { worker, workerIndex } = workerInfo;

    const terminateWorker = () => {
      worker.terminate();
      console.log(`[MultiWorkerController] Worker ${workerIndex} terminated`);
    };

    const onMessage = (e: MessageEvent<MainMessage>) => {
      if (e.data.type === "DISPOSED") {
        worker.removeEventListener("message", onMessage);
        terminateWorker();
      }
    };

    worker.addEventListener("message", onMessage);
    worker.postMessage({ type: "DISPOSE" } as WorkerMessage);

    // 안전장치: 500ms 후에도 DISPOSED 메시지가 없으면 강제 terminate
    setTimeout(() => {
      worker.removeEventListener("message", onMessage);
      terminateWorker();
    }, 500);
  }

  // =========================================================================
  // Data Access (for rendering)
  // =========================================================================

  /**
   * Get vehicle data for a specific fab (렌더링용)
   * fabId가 없으면 전체 버퍼 반환 (멀티 Fab 렌더링용)
   */
  getVehicleData(fabId?: string): Float32Array | null {
    if (!this.vehicleBuffer || !this.layout) return null;

    // fabId가 없으면 전체 버퍼 반환
    if (!fabId) {
      return new Float32Array(this.vehicleBuffer);
    }

    const assignment = this.layout.fabAssignments.get(fabId);
    if (!assignment) return null;

    return this.layoutManager.createVehicleDataView(this.vehicleBuffer, assignment);
  }

  /**
   * Get sensor point data for a specific fab
   */
  getSensorPointData(fabId: string): Float32Array | null {
    if (!this.sensorBuffer || !this.layout) return null;

    const assignment = this.layout.fabAssignments.get(fabId);
    if (!assignment) return null;

    return this.layoutManager.createSensorDataView(this.sensorBuffer, assignment);
  }

  /**
   * Get actual number of vehicles for a specific fab
   */
  getActualNumVehicles(fabId: string): number {
    return this.fabVehicleCounts.get(fabId) ?? 0;
  }

  /**
   * Get all fab IDs
   */
  getFabIds(): string[] {
    return Array.from(this.fabConfigs.keys());
  }

  /**
   * Get total vehicle count across all fabs
   */
  getTotalVehicleCount(): number {
    let total = 0;
    for (const count of this.fabVehicleCounts.values()) {
      total += count;
    }
    return total;
  }

  /**
   * Get worker count
   */
  getWorkerCount(): number {
    return this.workers.length;
  }

  /**
   * Get worker assignment info (디버그용)
   */
  getWorkerAssignments(): Array<{ workerIndex: number; fabIds: string[] }> {
    return this.workers.map(w => ({
      workerIndex: w.workerIndex,
      fabIds: w.fabIds,
    }));
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
