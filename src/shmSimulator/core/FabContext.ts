// shmSimulator/core/FabContext.ts
// Fab 단위로 모든 매니저와 메모리를 묶어서 관리하는 클래스

import { VehicleDataArrayBase, MovementData, VEHICLE_DATA_SIZE } from "@/common/vehicle/memory/VehicleDataArrayBase";
import { SensorPointArrayBase, SENSOR_DATA_SIZE } from "@/common/vehicle/memory/SensorPointArrayBase";
import { EdgeVehicleQueue } from "@/common/vehicle/memory/EdgeVehicleQueue";
import { LockMgr } from "@/common/vehicle/logic/LockMgr";
import { TransferMgr, VehicleLoop } from "@/common/vehicle/logic/TransferMgr";
import { AutoMgr } from "@/common/vehicle/logic/AutoMgr";
import { DispatchMgr } from "@/shmSimulator/managers/DispatchMgr";
import { RoutingMgr } from "@/shmSimulator/managers/RoutingMgr";
import { EngineStore } from "./EngineStore";
import { initializeVehicles, InitializationResult } from "./initializeVehicles";
import { checkCollisions, CollisionCheckContext } from "@/common/vehicle/collision/collisionCheck";
import { updateMovement, MovementUpdateContext } from "@/common/vehicle/movement/movementUpdate";
import { VEHICLE_RENDER_SIZE, SENSOR_RENDER_SIZE } from "../MemoryLayoutManager";
import type { Edge } from "@/types/edge";
import type { Node } from "@/types";
import type { SimulationConfig, TransferMode, VehicleInitConfig, FabMemoryAssignment, SharedMapRef, FabRenderOffset } from "../types";
import type { StationRawData } from "@/types/station";

export interface FabInitParams {
  fabId: string;
  sharedBuffer: SharedArrayBuffer;
  sensorPointBuffer: SharedArrayBuffer;
  edges?: Edge[];
  nodes?: Node[];
  stationData?: StationRawData[];
  sharedMapRef?: SharedMapRef;
  fabOffset?: FabRenderOffset;
  config: SimulationConfig;
  vehicleConfigs: VehicleInitConfig[];
  numVehicles: number;
  transferMode: TransferMode;
  memoryAssignment?: FabMemoryAssignment;
}

export class FabContext {
  public readonly fabId: string;

  // === Internal Store ===
  private readonly store: EngineStore;

  // === Memory (Worker 계산용) ===
  private readonly vehicleDataArray: VehicleDataArrayBase;
  private readonly sensorPointArray: SensorPointArrayBase;
  private readonly edgeVehicleQueue: EdgeVehicleQueue;

  // === Render Data (별도 버퍼, 연속 레이아웃) ===
  private vehicleRenderData: Float32Array | null = null;
  private sensorRenderData: Float32Array | null = null;

  // === Map Data ===
  private edges: Edge[] = [];
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
  private readonly config: SimulationConfig;
  private actualNumVehicles: number = 0;

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

    this.init(params);
  }

  private init(params: FabInitParams): void {
    console.log(`[FabContext:${this.fabId}] Initializing...`);

    // Worker 버퍼 설정 (계산용)
    if (params.memoryAssignment) {
      const { vehicleRegion, sensorRegion } = params.memoryAssignment;
      this.store.setSharedBufferWithRegion(params.sharedBuffer, vehicleRegion);
      this.sensorPointArray.setBufferWithRegion(params.sensorPointBuffer, sensorRegion);
      console.log(`[FabContext:${this.fabId}] Worker buffers connected with region restriction`);
    } else {
      this.store.setSharedBuffer(params.sharedBuffer);
      this.sensorPointArray.setBuffer(params.sensorPointBuffer);
      console.log(`[FabContext:${this.fabId}] Worker buffers connected (full buffer)`);
    }

    this.store.setTransferMode(params.transferMode);
    console.log(`[FabContext:${this.fabId}] TransferMode: ${params.transferMode}`);

    // 맵 데이터 설정
    if (params.sharedMapRef) {
      this.edges = params.sharedMapRef.edges;
      this.nodes = params.sharedMapRef.nodes;
      this.edgeNameToIndex = params.sharedMapRef.edgeNameToIndex;
      for (const [name, idx] of params.sharedMapRef.nodeNameToIndex) {
        this.nodeNameToIndex.set(name, idx);
      }
      this.fabOffset = params.fabOffset ?? { x: 0, y: 0 };
      console.log(`[FabContext:${this.fabId}] Using shared map reference, offset: (${this.fabOffset.x.toFixed(1)}, ${this.fabOffset.y.toFixed(1)})`);
    } else {
      this.edges = params.edges ?? [];
      this.nodes = params.nodes ?? [];
      this.edgeNameToIndex.clear();
      for (let idx = 0; idx < this.edges.length; idx++) {
        this.edgeNameToIndex.set(this.edges[idx].edge_name, idx);
      }
      this.nodeNameToIndex.clear();
      for (let idx = 0; idx < this.nodes.length; idx++) {
        this.nodeNameToIndex.set(this.nodes[idx].node_name, idx);
      }
      console.log(`[FabContext:${this.fabId}] Using local edges/nodes`);
    }

    console.log(`[FabContext:${this.fabId}] Loaded ${this.edges.length} edges, ${this.nodes.length} nodes`);

    this.lockMgr.initFromEdges(this.edges);

    const result: InitializationResult = initializeVehicles({
      edges: this.edges,
      nodes: this.nodes,
      numVehicles: params.numVehicles,
      vehicleConfigs: params.vehicleConfigs,
      store: this.store,
      lockMgr: this.lockMgr,
      sensorPointArray: this.sensorPointArray,
      config: this.config,
      transferMode: params.transferMode,
    });

    this.edgeNameToIndex = result.edgeNameToIndex;
    this.actualNumVehicles = result.actualNumVehicles;

    this.dispatchMgr.setVehicleDataArray(this.vehicleDataArray);
    this.dispatchMgr.setEdgeData(this.edges, this.edgeNameToIndex);

    this.buildVehicleLoopMap();

    const stationData = params.sharedMapRef?.stations ?? params.stationData;
    if (stationData) {
      this.autoMgr.initStations(stationData, this.edgeNameToIndex);
    }

    // 렌더 버퍼는 나중에 SET_RENDER_BUFFER로 설정됨
    console.log(`[FabContext:${this.fabId}] Initialized with ${this.actualNumVehicles} vehicles (render buffer pending)`);
  }

  /**
   * Set render buffer (연속 레이아웃)
   * Main Thread에서 SET_RENDER_BUFFER 메시지로 호출됨
   */
  setRenderBuffer(
    vehicleRenderBuffer: SharedArrayBuffer,
    sensorRenderBuffer: SharedArrayBuffer,
    vehicleRenderOffset: number,
    sensorRenderOffset: number,
    actualVehicles: number
  ): void {
    const vehicleRenderLength = actualVehicles * VEHICLE_RENDER_SIZE;
    const sensorRenderLength = actualVehicles * SENSOR_RENDER_SIZE;

    this.vehicleRenderData = new Float32Array(vehicleRenderBuffer, vehicleRenderOffset, vehicleRenderLength);
    this.sensorRenderData = new Float32Array(sensorRenderBuffer, sensorRenderOffset, sensorRenderLength);

    console.log(`[FabContext:${this.fabId}] Render buffer set: vehOffset=${vehicleRenderOffset}, sensorOffset=${sensorRenderOffset}, vehicles=${actualVehicles}`);

    // 초기 데이터를 렌더 버퍼에 복사
    this.writeToRenderRegion();
  }

  private buildVehicleLoopMap(): void {
    this.vehicleLoopMap.clear();

    for (let i = 0; i < this.actualNumVehicles; i++) {
      const currentEdgeIndex = this.store.getVehicleCurrentEdge(i);
      const currentEdge = this.edges[currentEdgeIndex];
      if (!currentEdge) continue;

      const sequence: string[] = [currentEdge.edge_name];
      let edge = currentEdge;

      for (let j = 0; j < 100; j++) {
        if (!edge.nextEdgeIndices?.length) break;

        const nextEdge = this.edges[edge.nextEdgeIndices[0]];
        if (!nextEdge || nextEdge.edge_name === currentEdge.edge_name) break;

        sequence.push(nextEdge.edge_name);
        edge = nextEdge;
      }

      this.vehicleLoopMap.set(i, { edgeSequence: sequence });
    }
  }

  handleCommand(command: unknown): void {
    this.routingMgr.receiveMessage(command);
  }

  step(clampedDelta: number): void {
    // 1. Collision Check
    const collisionCtx: CollisionCheckContext = {
      vehicleArrayData: this.vehicleDataArray.getData(),
      edgeArray: this.edges,
      edgeVehicleQueue: this.edgeVehicleQueue,
      sensorPointArray: this.sensorPointArray,
      config: this.config,
    };
    checkCollisions(collisionCtx);

    // 2. Movement Update
    const movementCtx: MovementUpdateContext = {
      vehicleDataArray: this.vehicleDataArray,
      sensorPointArray: this.sensorPointArray,
      edgeArray: this.edges,
      actualNumVehicles: this.actualNumVehicles,
      vehicleLoopMap: this.vehicleLoopMap,
      edgeNameToIndex: this.edgeNameToIndex,
      store: {
        moveVehicleToEdge: this.store.moveVehicleToEdge.bind(this.store),
        transferMode: this.store.transferMode,
      },
      lockMgr: this.lockMgr,
      transferMgr: this.transferMgr,
      clampedDelta,
      config: this.config,
    };
    updateMovement(movementCtx);

    // 3. Auto Routing Trigger
    this.autoMgr.update(
      this.store.transferMode,
      this.actualNumVehicles,
      this.vehicleDataArray,
      this.edges,
      this.edgeNameToIndex,
      this.transferMgr
    );

    // 4. Write to Render Buffer (연속 레이아웃)
    this.writeToRenderRegion();
  }

  /**
   * Write vehicle and sensor data to render buffer with fab offset applied
   */
  private writeToRenderRegion(): void {
    if (!this.vehicleRenderData || !this.sensorRenderData) {
      // 렌더 버퍼 미설정
      return;
    }

    const offsetX = this.fabOffset.x;
    const offsetY = this.fabOffset.y;

    // === Vehicle Render Data ===
    const workerVehicleData = this.vehicleDataArray.getData();
    for (let i = 0; i < this.actualNumVehicles; i++) {
      const workerPtr = i * VEHICLE_DATA_SIZE;
      const renderPtr = i * VEHICLE_RENDER_SIZE;

      this.vehicleRenderData[renderPtr + 0] = workerVehicleData[workerPtr + MovementData.X] + offsetX;
      this.vehicleRenderData[renderPtr + 1] = workerVehicleData[workerPtr + MovementData.Y] + offsetY;
      this.vehicleRenderData[renderPtr + 2] = workerVehicleData[workerPtr + MovementData.Z];
      this.vehicleRenderData[renderPtr + 3] = workerVehicleData[workerPtr + MovementData.ROTATION];
    }

    // === Sensor Render Data ===
    const workerSensorData = this.sensorPointArray.getData();
    for (let i = 0; i < this.actualNumVehicles; i++) {
      const workerPtr = i * SENSOR_DATA_SIZE;
      const renderPtr = i * SENSOR_RENDER_SIZE;

      for (let j = 0; j < SENSOR_DATA_SIZE; j += 2) {
        this.sensorRenderData[renderPtr + j] = workerSensorData[workerPtr + j] + offsetX;
        this.sensorRenderData[renderPtr + j + 1] = workerSensorData[workerPtr + j + 1] + offsetY;
      }
    }
  }

  dispose(): void {
    this.store.dispose();
    this.sensorPointArray.dispose();

    this.vehicleRenderData = null;
    this.sensorRenderData = null;

    this.lockMgr.reset();
    this.transferMgr.clearQueue();
    this.dispatchMgr.dispose();
    this.autoMgr.dispose();

    this.edges = [];
    this.nodes = [];
    this.edgeNameToIndex.clear();
    this.nodeNameToIndex.clear();
    this.vehicleLoopMap.clear();

    this.fabOffset = { x: 0, y: 0 };
    this.actualNumVehicles = 0;

    console.log(`[FabContext:${this.fabId}] Disposed`);
  }

  getActualNumVehicles(): number {
    return this.actualNumVehicles;
  }

  getVehicleData(): Float32Array {
    return this.vehicleDataArray.getData();
  }
}
