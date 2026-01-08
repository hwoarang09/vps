// shmSimulator/core/FabContext.ts
// Fab 단위로 모든 매니저와 메모리를 묶어서 관리하는 클래스

import { VehicleDataArrayBase } from "@/common/vehicle/memory/VehicleDataArrayBase";
import { SensorPointArrayBase } from "@/common/vehicle/memory/SensorPointArrayBase";
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
import type { Edge } from "@/types/edge";
import type { Node } from "@/types";
import type { SimulationConfig, TransferMode } from "../types";
import type { StationRawData } from "@/types/station";
import type { VehicleInitConfig } from "../types";

export interface FabInitParams {
  fabId: string;
  sharedBuffer: SharedArrayBuffer;
  sensorPointBuffer: SharedArrayBuffer;
  edges: Edge[];
  nodes: Node[];
  config: SimulationConfig;
  vehicleConfigs: VehicleInitConfig[];
  numVehicles: number;
  transferMode: TransferMode;
  stationData: StationRawData[];
}

export class FabContext {
  public readonly fabId: string;

  // === Internal Store ===
  private readonly store: EngineStore;

  // === Memory ===
  private readonly vehicleDataArray: VehicleDataArrayBase;
  private readonly sensorPointArray: SensorPointArrayBase;
  private readonly edgeVehicleQueue: EdgeVehicleQueue;

  // === Map Data ===
  private edges: Edge[] = [];
  private nodes: Node[] = [];
  private edgeNameToIndex: Map<string, number> = new Map();
  private readonly nodeNameToIndex: Map<string, number> = new Map();

  // === Logic Managers ===
  private readonly lockMgr: LockMgr;
  private readonly transferMgr: TransferMgr;
  private readonly dispatchMgr: DispatchMgr;
  public readonly routingMgr: RoutingMgr;
  private readonly autoMgr: AutoMgr;

  // === Runtime ===
  private readonly vehicleLoopMap: Map<number, VehicleLoop> = new Map();
  private config: SimulationConfig;
  private actualNumVehicles: number = 0;

  constructor(params: FabInitParams) {
    this.fabId = params.fabId;
    this.config = params.config;

    // Create store and memory structures
    this.store = new EngineStore(this.config.maxVehicles, 200000);
    this.vehicleDataArray = this.store.getVehicleDataArray();
    this.sensorPointArray = new SensorPointArrayBase(this.config.maxVehicles);
    this.edgeVehicleQueue = this.store.getEdgeVehicleQueue();

    // Create managers
    this.lockMgr = new LockMgr();
    this.transferMgr = new TransferMgr();
    this.dispatchMgr = new DispatchMgr(this.transferMgr);
    this.routingMgr = new RoutingMgr(this.dispatchMgr);
    this.autoMgr = new AutoMgr();

    // Initialize
    this.init(params);
  }

  private init(params: FabInitParams): void {
    console.log(`[FabContext:${this.fabId}] Initializing...`);

    // Set SharedArrayBuffer for Main-Worker communication
    this.store.setSharedBuffer(params.sharedBuffer);
    this.sensorPointArray.setBuffer(params.sensorPointBuffer);
    console.log(`[FabContext:${this.fabId}] SharedArrayBuffers connected`);

    // Update transfer mode
    this.store.setTransferMode(params.transferMode);
    console.log(`[FabContext:${this.fabId}] TransferMode: ${params.transferMode}`);

    // Store edges and build lookup map
    this.edges = params.edges;
    this.edgeNameToIndex.clear();
    for (let idx = 0; idx < this.edges.length; idx++) {
      this.edgeNameToIndex.set(this.edges[idx].edge_name, idx);
    }

    // Store nodes and build lookup map
    this.nodes = params.nodes;
    this.nodeNameToIndex.clear();
    for (let idx = 0; idx < this.nodes.length; idx++) {
      this.nodeNameToIndex.set(this.nodes[idx].node_name, idx);
    }

    console.log(`[FabContext:${this.fabId}] Loaded ${this.edges.length} edges, ${this.nodes.length} nodes`);

    // Initialize LockMgr from edges
    this.lockMgr.initFromEdges(this.edges);

    // Initialize vehicles
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

    // Set vehicle data array for DispatchMgr
    this.dispatchMgr.setVehicleDataArray(this.vehicleDataArray);
    this.dispatchMgr.setEdgeData(this.edges, this.edgeNameToIndex);

    // Build vehicle loop map
    this.buildVehicleLoopMap();

    // Initialize AutoMgr with stations
    if (params.stationData) {
      this.autoMgr.initStations(params.stationData, this.edgeNameToIndex, this.edges);
    }

    console.log(`[FabContext:${this.fabId}] Initialized with ${this.actualNumVehicles} vehicles`);
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

  /**
   * Handle external command
   */
  handleCommand(command: unknown): void {
    this.routingMgr.receiveMessage(command);
  }

  /**
   * Single simulation step
   */
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
  }

  /**
   * Dispose the context
   */
  dispose(): void {
    this.store.clearAllVehicles();
    this.lockMgr.reset();
    this.transferMgr.clearQueue();
    console.log(`[FabContext:${this.fabId}] Disposed`);
  }

  /**
   * Get actual vehicle count
   */
  getActualNumVehicles(): number {
    return this.actualNumVehicles;
  }

  /**
   * Get vehicle data
   */
  getVehicleData(): Float32Array {
    return this.vehicleDataArray.getData();
  }
}
