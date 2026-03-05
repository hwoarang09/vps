// FabContext/index.ts
// FabContext 메인 클래스 - 모든 매니저와 메모리를 묶어서 관리

import { VehicleDataArrayBase } from "@/common/vehicle/memory/VehicleDataArrayBase";
import { SensorPointArrayBase } from "@/common/vehicle/memory/SensorPointArrayBase";
import { EdgeVehicleQueue } from "@/common/vehicle/memory/EdgeVehicleQueue";
import { LockMgr } from "@/common/vehicle/logic/LockMgr/index";
import { TransferMgr, VehicleLoop } from "@/common/vehicle/logic/TransferMgr";
import { OrderMgr } from "@/common/vehicle/logic/OrderMgr";
import { DispatchMgr } from "@/shmSimulator/managers/DispatchMgr";
import { JobBatchMgr } from "@/shmSimulator/managers/JobBatchMgr";
import { RoutingMgr } from "@/shmSimulator/managers/RoutingMgr";
import { EngineStore } from "../EngineStore";
import { SimLogger } from "@/logger";
import type { Edge } from "@/types/edge";
import type { Node } from "@/types";
import type { SimulationConfig, FabRenderOffset } from "../../types";
import { TransferMode } from "@/common/vehicle/initialize/constants";
import type { FabInitParams, SensorSectionOffsets } from "./types";
import { buildVehicleLoopMap } from "./loop-mode";
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
  private readonly orderMgr: OrderMgr;
  private readonly jobBatchMgr: JobBatchMgr;

  // === Runtime ===
  private readonly vehicleLoopMap: Map<number, VehicleLoop> = new Map();
  private readonly config: SimulationConfig;
  private actualNumVehicles: number = 0;

  // === SimLogger ===
  private simLogger: SimLogger | null = null;

  // === Collision & Curve Brake Check Timers ===
  private readonly collisionCheckTimers: Map<number, number> = new Map();
  private readonly curveBrakeCheckTimers: Map<number, number> = new Map();

  // === Edge Enter Time Tracking (vehId → simulationTime) ===
  private readonly edgeEnterTimes: Map<number, number> = new Map();

  // === Last simulation time (for render buffer) ===
  private lastSimulationTime: number = 0;

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
    this.orderMgr = new OrderMgr();
    this.jobBatchMgr = new JobBatchMgr(this.orderMgr);

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
      orderMgr: this.orderMgr,
      jobBatchMgr: this.jobBatchMgr,
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

    // LOOP 모드: 차량별 순환 경로 구축
    buildVehicleLoopMap(
      this.vehicleLoopMap,
      this.actualNumVehicles,
      this.store,
      this.edges
    );

    // AUTO_ROUTE 모드: order 모드 + 자동 반송 생성 활성화
    if (params.transferMode === TransferMode.AUTO_ROUTE) {
      this.orderMgr.setOrderModeEnabled(true);
      this.jobBatchMgr.setAutoGenerate(true);
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
    this.lastSimulationTime = simulationTime;
    executeSimulationStep({
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
      orderMgr: this.orderMgr,
      store: {
        moveVehicleToEdge: this.store.moveVehicleToEdge.bind(this.store),
        transferMode: this.store.transferMode,
      },
      simLogger: this.simLogger,
      edgeEnterTimes: this.edgeEnterTimes,
      collisionCheckTimers: this.collisionCheckTimers,
      curveBrakeCheckTimers: this.curveBrakeCheckTimers,
    });

    // 5. JobBatchMgr - 새 order 배차
    this.jobBatchMgr.update(
      this.actualNumVehicles,
      simulationTime,
      this.vehicleDataArray,
      this.edges,
      this.edgeNameToIndex,
      this.transferMgr,
      this.lockMgr
    );

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
      simulationTime: this.lastSimulationTime,
    });
  }

  handleCommand(command: unknown): void {
    const cmd = command as { type?: string; payload?: unknown };
    if (cmd.type === 'TRANSPORT_ORDER') {
      this.jobBatchMgr.addOrder(cmd.payload as import("@/shmSimulator/managers/JobBatchMgr").ExternalOrder);
    } else if (cmd.type === 'TRANSPORT_BATCH') {
      this.jobBatchMgr.addOrders(cmd.payload as import("@/shmSimulator/managers/JobBatchMgr").ExternalOrder[]);
    } else {
      this.routingMgr.receiveMessage(command);
    }
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
    this.orderMgr.dispose();
    this.jobBatchMgr.dispose();

    this.edges = [];
    this.nodes = [];
    this.edgeNameToIndex.clear();
    this.nodeNameToIndex.clear();
    this.vehicleLoopMap.clear();
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

// Re-export types
export type { FabInitParams } from "./types";
