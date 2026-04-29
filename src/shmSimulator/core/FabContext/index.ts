// FabContext/index.ts
// FabContext 메인 클래스 - 모든 매니저와 메모리를 묶어서 관리

import { VehicleDataArrayBase } from "@/common/vehicle/memory/VehicleDataArrayBase";
import { SensorPointArrayBase } from "@/common/vehicle/memory/SensorPointArrayBase";
import { EdgeVehicleQueue } from "@/common/vehicle/memory/EdgeVehicleQueue";
import { LockMgr } from "@/common/vehicle/logic/LockMgr/index";
import { TransferMgr, VehicleLoop, VehicleBayLoop } from "@/common/vehicle/logic/TransferMgr";
import { AutoMgr } from "@/common/vehicle/logic/AutoMgr";
import { DEFAULT_ROUTING_CONFIG, type RoutingContext, type RoutingStrategy } from "@/common/vehicle/logic/Dijkstra";
import { EdgeStatsTracker } from "@/common/vehicle/logic/EdgeStatsTracker";
import { DispatchMgr } from "@/shmSimulator/managers/DispatchMgr";
import { RoutingMgr } from "@/shmSimulator/managers/RoutingMgr";
import { EngineStore } from "../EngineStore";
import { SimLogger } from "@/logger";
import type { Edge } from "@/types/edge";
import type { Node } from "@/types";
import { TransferMode } from "@/common/vehicle/initialize/constants";
import type { SimulationConfig, FabRenderOffset } from "../../types";
import { VEHICLE_DATA_SIZE, MovementData } from "@/common/vehicle/initialize/constants";
import type { FabInitParams, SensorSectionOffsets } from "./types";
import { buildVehicleLoopMap, buildVehicleBayLoopMap } from "./loop-mode";
import { initializeFab, setupRenderBuffer } from "./initialization";
import { setupLoggerPort } from "./logger-setup";
import { writeToRenderRegion } from "./render";
import { executeSimulationStep } from "./simulation-step";

export class FabContext {
  public readonly fabId: string;

  // === Internal Store ===
  private readonly store: EngineStore;

  // === Memory (Worker 계산용) ===
  private readonly vehicleDataArray: VehicleDataArrayBase;
  private readonly sensorPointArray: SensorPointArrayBase;
  private readonly edgeVehicleQueue: EdgeVehicleQueue;
  // @ts-expect-error - Used for initialization and passed to managers
  private checkpointArray: Float32Array | null = null;

  // === Render Data (별도 버퍼, 연속 레이아웃) ===
  private vehicleRenderData: Float32Array | null = null;
  private sensorRenderData: Float32Array | null = null;
  // @ts-expect-error - Used in helper functions via parameters
  private totalVehicles: number = 0;
  // @ts-expect-error - Used in helper functions via parameters
  private vehicleStartIndex: number = 0;

  // === Cached Sensor Section Offsets (매 프레임 재계산 방지) ===
  private sectionOffsets: SensorSectionOffsets | null = null;

  // === Map Data ===
  private edges: Edge[] = [];
  // @ts-expect-error - Used in initialization and disposal
  private nodes: Node[] = [];
  private edgeNameToIndex: Map<string, number> = new Map();
  private readonly nodeNameToIndex: Map<string, number> = new Map();

  // === Fab Render Offset ===
  private fabOffset: FabRenderOffset = { x: 0, y: 0 };

  // === Logic Managers ===
  private readonly lockMgr: LockMgr;
  private readonly transferMgr: TransferMgr;
  private readonly dispatchMgr: DispatchMgr;
  public readonly routingMgr: RoutingMgr;
  private readonly autoMgr: AutoMgr;

  // === Runtime ===
  private readonly vehicleLoopMap: Map<number, VehicleLoop> = new Map();
  private readonly vehicleBayLoopMap: Map<number, VehicleBayLoop> = new Map();
  private readonly config: SimulationConfig;
  private actualNumVehicles: number = 0;

  // === Routing Context (per-fab BPR / EWMA) ===
  private routingContext!: RoutingContext;
  private readonly edgeStatsTracker: EdgeStatsTracker;

  // === SimLogger ===
  private simLogger: SimLogger | null = null;

  // === Collision & Curve Brake Check Timers ===
  private readonly collisionCheckTimers: Map<number, number> = new Map();
  private readonly curveBrakeCheckTimers: Map<number, number> = new Map();

  // === Edge Enter Time Tracking (vehId → simulationTime) ===
  private readonly edgeEnterTimes: Map<number, number> = new Map();

  // === Order Stats Flush Timer ===
  private lastOrderStatsFlush = 0;

  // === Replay Snapshot State ===
  private lastReplaySnapshotTime = 0;
  private prevVehicleSpeeds: Float32Array | null = null;

  constructor(params: FabInitParams) {
    this.fabId = params.fabId;
    this.config = params.config;

    const edgeCount = params.sharedMapRef?.edges.length ?? params.edges?.length ?? 0;
    const maxEdges = Math.max(edgeCount * 2, 1000);
    this.store = new EngineStore(this.config.maxVehicles, maxEdges, true);
    this.vehicleDataArray = this.store.getVehicleDataArray();
    this.sensorPointArray = new SensorPointArrayBase(this.config.maxVehicles, true);
    this.edgeVehicleQueue = this.store.getEdgeVehicleQueue();

    this.lockMgr = new LockMgr();
    this.transferMgr = new TransferMgr();
    this.dispatchMgr = new DispatchMgr(this.transferMgr);
    this.routingMgr = new RoutingMgr(this.dispatchMgr);
    this.autoMgr = new AutoMgr();
    this.edgeStatsTracker = new EdgeStatsTracker({
      ewmaAlpha: params.config.routingEwmaAlpha ?? 0.1,
    });

    this.init(params);
  }

  /**
   * Fab 초기화 (메모리, 맵 데이터, 차량 초기화)
   */
  private init(params: FabInitParams): void {
    const result = initializeFab({
      params,
      store: this.store,
      sensorPointArray: this.sensorPointArray,
      vehicleDataArray: this.vehicleDataArray,
      lockMgr: this.lockMgr,
      transferMgr: this.transferMgr,
      dispatchMgr: this.dispatchMgr,
      autoMgr: this.autoMgr,
      edgeNameToIndexMap: this.edgeNameToIndex,
      nodeNameToIndexMap: this.nodeNameToIndex,
    });

    this.edges = result.edges;
    this.nodes = result.nodes;
    this.edgeNameToIndex = result.edgeNameToIndex;
    this.actualNumVehicles = result.actualNumVehicles;
    this.checkpointArray = result.checkpointArray;

    // Fab render offset 설정
    if (params.sharedMapRef) {
      this.fabOffset = params.fabOffset ?? { x: 0, y: 0 };
    }

    // Per-fab routing context (Dijkstra BPR / EWMA)
    this.routingContext = {
      config: {
        ...DEFAULT_ROUTING_CONFIG,
        ...(this.config.routingStrategy && { strategy: this.config.routingStrategy }),
        ...(this.config.routingBprAlpha !== undefined && { bprAlpha: this.config.routingBprAlpha }),
        ...(this.config.routingBprBeta !== undefined && { bprBeta: this.config.routingBprBeta }),
        ...(this.config.routingEwmaAlpha !== undefined && { ewmaAlpha: this.config.routingEwmaAlpha }),
      },
      edgeVehicleQueue: this.edgeVehicleQueue,
      vehicleSpacing: this.config.bodyLength + (this.config.vehicleSpacing ?? 0.6),
      linearMaxSpeed: this.config.linearMaxSpeed,
      curveMaxSpeed: this.config.curveMaxSpeed,
      edgeStatsTracker: this.edgeStatsTracker,
    };
    this.autoMgr.routingContext = this.routingContext;
    if (this.config.routingRerouteInterval !== undefined) {
      this.autoMgr.rerouteInterval = this.config.routingRerouteInterval;
    }

    // SIMPLE_LOOP 모드: 차량별 순환 경로 구축
    buildVehicleLoopMap(
      this.vehicleLoopMap,
      this.actualNumVehicles,
      this.store,
      this.edges
    );

    // LOOP 모드: bay 기반 차량별 순환 경로 구축
    if (params.bayLoopEntries && params.bayLoopEntries.length > 0) {
      buildVehicleBayLoopMap(
        this.vehicleBayLoopMap,
        this.actualNumVehicles,
        this.store,
        this.edges,
        this.edgeNameToIndex,
        params.bayLoopEntries
      );
    }
  }

  /**
   * Render buffer 설정 (연속 레이아웃)
   * Main Thread에서 SET_RENDER_BUFFER 메시지로 호출됨
   */
  setRenderBuffer(
    vehicleRenderBuffer: SharedArrayBuffer,
    sensorRenderBuffer: SharedArrayBuffer,
    vehicleRenderOffset: number,
    actualVehicles: number,
    totalVehicles: number,
    vehicleStartIndex: number
  ): void {
    const result = setupRenderBuffer(
      vehicleRenderBuffer,
      sensorRenderBuffer,
      vehicleRenderOffset,
      actualVehicles,
      totalVehicles,
      vehicleStartIndex
    );

    this.vehicleRenderData = result.vehicleRenderData;
    this.sensorRenderData = result.sensorRenderData;
    this.totalVehicles = totalVehicles;
    this.vehicleStartIndex = vehicleStartIndex;
    this.sectionOffsets = result.sectionOffsets;

    // 초기 데이터를 렌더 버퍼에 복사
    this.writeToRenderRegion();
  }

  /**
   * Update routing config at runtime (per-fab BPR params)
   */
  setTransferMode(mode: TransferMode): void {
    this.store.setTransferMode(mode);
  }

  setTransferEnabled(enabled: boolean): void {
    this.store.setTransferEnabled(enabled);
  }

  setTransferRate(rateMode: 'utilization' | 'throughput', utilizationPercent?: number, throughputPerHour?: number): void {
    this.store.setTransferRate(rateMode, utilizationPercent, throughputPerHour);
  }

  updateMovementConfig(params: {
    linearMaxSpeed?: number;
    linearAcceleration?: number;
    linearDeceleration?: number;
    preBrakeDeceleration?: number;
    curveMaxSpeed?: number;
    curveAcceleration?: number;
  }): void {
    // config 객체 직접 갱신 → 다음 프레임부터 maxSpeed/curveAccel/preBrake 즉시 적용
    if (params.linearMaxSpeed !== undefined) this.config.linearMaxSpeed = params.linearMaxSpeed;
    if (params.linearAcceleration !== undefined) this.config.linearAcceleration = params.linearAcceleration;
    if (params.linearDeceleration !== undefined) this.config.linearDeceleration = params.linearDeceleration;
    if (params.preBrakeDeceleration !== undefined) this.config.linearPreBrakeDeceleration = params.preBrakeDeceleration;
    if (params.curveMaxSpeed !== undefined) this.config.curveMaxSpeed = params.curveMaxSpeed;
    if (params.curveAcceleration !== undefined) this.config.curveAcceleration = params.curveAcceleration;

    // accel/decel은 차량별 Float32Array에 캐싱되어 있으므로 전체 차량 갱신
    if (params.linearAcceleration !== undefined || params.linearDeceleration !== undefined) {
      const data = this.vehicleDataArray.getData();
      for (let i = 0; i < this.actualNumVehicles; i++) {
        const ptr = i * VEHICLE_DATA_SIZE;
        if (params.linearAcceleration !== undefined) {
          data[ptr + MovementData.ACCELERATION] = params.linearAcceleration;
        }
        if (params.linearDeceleration !== undefined) {
          data[ptr + MovementData.DECELERATION] = params.linearDeceleration;
        }
      }
    }
  }

  updateRoutingConfig(strategy: RoutingStrategy, bprAlpha?: number, bprBeta?: number, rerouteInterval?: number, ewmaAlpha?: number): void {
    this.routingContext.config = {
      ...this.routingContext.config,
      strategy,
      ...(bprAlpha !== undefined && { bprAlpha }),
      ...(bprBeta !== undefined && { bprBeta }),
      ...(ewmaAlpha !== undefined && { ewmaAlpha }),
    };
    if (ewmaAlpha !== undefined) {
      this.edgeStatsTracker.updateConfig({ ewmaAlpha });
    }
    if (rerouteInterval !== undefined) {
      this.autoMgr.rerouteInterval = rerouteInterval;
    }
  }

  /**
   * Logger Worker와 연결된 MessagePort 설정
   * 이후 edge transit 로그가 자동으로 전송됨
   */
  async setLoggerPort(_port: MessagePort, workerId: number = 0): Promise<void> {
    console.log(`[FabContext] setLoggerPort called: fabId=${this.fabId}, workerId=${workerId}`);
    this.simLogger = await setupLoggerPort(
      this.fabId,
      this.config,
      workerId,
    );
    console.log(`[FabContext] setLoggerPort result: simLogger=${this.simLogger ? 'OK' : 'null'}`);
  }

  /**
   * 시뮬레이션 스텝 실행 - 핵심 로직
   *
   * 동작:
   * 1. Collision Check - 충돌 감지 → 멈출지 결정
   * 2. Lock 처리 - 합류점에서 멈출지 결정
   * 3. Movement Update - 1,2에서 멈추지 않은 차량만 이동
   * 4. Auto Routing - edge 전환 후 새 경로 필요한 차량 처리
   * 5. Write to Render Buffer - 렌더링 데이터
   */
  step(clampedDelta: number, simulationTime: number = 0): void {
    const ctx = {
      clampedDelta,
      simulationTime,
      vehicleDataArray: this.vehicleDataArray,
      sensorPointArray: this.sensorPointArray,
      edgeVehicleQueue: this.edgeVehicleQueue,
      edges: this.edges,
      edgeNameToIndex: this.edgeNameToIndex,
      vehicleLoopMap: this.vehicleLoopMap,
      actualNumVehicles: this.actualNumVehicles,
      config: this.config,
      fabId: this.fabId,
      lockMgr: this.lockMgr,
      transferMgr: this.transferMgr,
      autoMgr: this.autoMgr,
      vehicleBayLoopMap: this.vehicleBayLoopMap,
      store: {
        moveVehicleToEdge: this.store.moveVehicleToEdge.bind(this.store),
        transferMode: this.store.transferMode,
        transferEnabled: this.store.transferEnabled,
        transferRateMode: this.store.transferRateMode,
        transferUtilizationPercent: this.store.transferUtilizationPercent,
        transferThroughputPerHour: this.store.transferThroughputPerHour,
      },
      simLogger: this.simLogger,
      edgeStatsTracker: this.edgeStatsTracker,
      edgeEnterTimes: this.edgeEnterTimes,
      collisionCheckTimers: this.collisionCheckTimers,
      curveBrakeCheckTimers: this.curveBrakeCheckTimers,
      lastReplaySnapshotTime: this.lastReplaySnapshotTime,
      prevVehicleSpeeds: this.prevVehicleSpeeds,
    };
    executeSimulationStep(ctx);

    // Write-back replay state
    this.lastReplaySnapshotTime = ctx.lastReplaySnapshotTime;
    this.prevVehicleSpeeds = ctx.prevVehicleSpeeds;

    // 5. Order stats flush (1초마다)
    if (simulationTime - this.lastOrderStatsFlush >= 1.0) {
      this.flushOrderStats(simulationTime);
      this.lastOrderStatsFlush = simulationTime;
    }

    // 6. Write to Render Buffer (렌더링 데이터)
    this.writeToRenderRegion();
  }

  /**
   * Render buffer에 vehicle, sensor 데이터 쓰기 (fab offset 적용)
   */
  private writeToRenderRegion(): void {
    writeToRenderRegion({
      vehicleRenderData: this.vehicleRenderData,
      sensorRenderData: this.sensorRenderData,
      workerVehicleData: this.vehicleDataArray.getData(),
      workerSensorData: this.sensorPointArray.getData(),
      actualNumVehicles: this.actualNumVehicles,
      fabOffsetX: this.fabOffset.x,
      fabOffsetY: this.fabOffset.y,
      sectionOffsets: this.sectionOffsets,
    });
  }

  private flushOrderStats(simulationTime: number): void {
    const stats = this.autoMgr.getOrderStats();
    const elapsed = simulationTime - stats.resetSimTime;
    const sorted = stats.leadTimes.slice().sort((a, b) => a - b);
    globalThis.postMessage({
      type: "ORDER_STATS",
      fabId: this.fabId,
      simulationTime,
      completed: stats.completed,
      throughputPerHour: elapsed > 0 ? (stats.completed / elapsed) * 3_600_000 : 0,
      leadTimeP50: percentileSorted(sorted, 0.5) / 1000,
      leadTimeP95: percentileSorted(sorted, 0.95) / 1000,
      leadTimeMean: sorted.length > 0 ? sorted.reduce((a, b) => a + b, 0) / sorted.length / 1000 : 0,
      totalPathChanges: this.autoMgr.getTotalPathChanges(),
    });
  }

  resetOrderStats(simulationTime: number): void {
    this.autoMgr.resetOrderStats(simulationTime);
    this.lastOrderStatsFlush = simulationTime;
  }

  handleCommand(command: unknown): void {
    this.routingMgr.receiveMessage(command);
  }

  flushLogs(): void {
    this.simLogger?.flush();
  }

  dispose(): void {
    // SimLogger 정리
    if (this.simLogger) {
      this.simLogger.dispose();
      this.simLogger = null;
    }

    this.store.dispose();
    this.sensorPointArray.dispose();

    this.vehicleRenderData = null;
    this.sensorRenderData = null;

    this.lockMgr.reset();
    this.transferMgr.clearQueue();
    this.dispatchMgr.dispose();
    this.autoMgr.dispose();
    this.edgeStatsTracker.reset();

    this.edges = [];
    this.nodes = [];
    this.edgeNameToIndex.clear();
    this.nodeNameToIndex.clear();
    this.vehicleLoopMap.clear();
    this.vehicleBayLoopMap.clear();
    this.edgeEnterTimes.clear();

    this.fabOffset = { x: 0, y: 0 };
    this.actualNumVehicles = 0;
  }

  getActualNumVehicles(): number {
    return this.actualNumVehicles;
  }

  getVehicleData(): Float32Array {
    return this.vehicleDataArray.getData();
  }

  getLockTableData(): import("../../types").LockTableData {
    const snapshot = this.lockMgr.getLockSnapshot();
    const nodes: Record<string, import("../../types").LockNodeData> = {};

    for (const { nodeName, holderVehId, holderEdge, waiters } of snapshot) {
      const granted: { edge: string; veh: number }[] = [];
      if (holderVehId !== undefined) {
        granted.push({ edge: holderEdge, veh: holderVehId });
      }

      const requests: { vehId: number; edgeName: string; requestTime: number }[] = [];
      for (const w of waiters) {
        requests.push({ vehId: w.vehId, edgeName: w.edgeName, requestTime: 0 });
      }

      nodes[nodeName] = { name: nodeName, requests, granted, edgeQueueSizes: {} };
    }

    return {
      strategy: this.lockMgr.getGrantStrategy(),
      nodes,
    };
  }
}

function percentileSorted(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil(p * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

// Re-export types
export type { FabInitParams } from "./types";
