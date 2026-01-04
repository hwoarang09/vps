// shmSimulator/core/SimulationEngine.ts

import { VehicleDataArrayBase } from "@/common/vehicle/memory/VehicleDataArrayBase";
import { SensorPointArrayBase } from "@/common/vehicle/memory/SensorPointArrayBase";
import { EdgeVehicleQueue } from "@/common/vehicle/memory/EdgeVehicleQueue";
import { EngineStore } from "./EngineStore";
import { LockMgr } from "@/common/vehicle/logic/LockMgr";
import { TransferMgr, VehicleLoop } from "@/common/vehicle/logic/TransferMgr";
import { checkCollisions, CollisionCheckContext } from "@/common/vehicle/collision/collisionCheck";
import { updateMovement, MovementUpdateContext } from "@/common/vehicle/movement/movementUpdate";
import { initializeVehicles, InitializationResult } from "./initializeVehicles";
import type { Edge } from "@/types/edge";
import type { Node } from "@/types";
import type { InitPayload, SimulationConfig } from "../types";
import { createDefaultConfig } from "../types";

import { DispatchMgr } from "@/shmSimulator/managers/DispatchMgr";
import { RoutingMgr } from "@/shmSimulator/managers/RoutingMgr";

export class SimulationEngine {
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
  public readonly routingMgr: RoutingMgr; // Public for easy access (e.g. from Worker event listener)

  // === Runtime ===
  private readonly vehicleLoopMap: Map<number, VehicleLoop> = new Map();
  private config: SimulationConfig;
  private isRunning: boolean = false;
  private actualNumVehicles: number = 0;
  private loopHandle: ReturnType<typeof setInterval> | null = null;

  // === Performance Monitoring ===
  private stepTimes: number[] = [];
  private lastPerfReportTime: number = 0;
  private readonly PERF_REPORT_INTERVAL = 5000; // 5 seconds

  // === Timing ===
  private lastStepTime: number = 0;

  constructor() {
    // Use default config initially, will be overwritten by init()
    this.config = createDefaultConfig();

    this.store = new EngineStore(this.config.maxVehicles, 200000);
    this.vehicleDataArray = this.store.getVehicleDataArray();
    this.sensorPointArray = new SensorPointArrayBase(this.config.maxVehicles);
    this.edgeVehicleQueue = this.store.getEdgeVehicleQueue();
    this.lockMgr = new LockMgr();
    this.transferMgr = new TransferMgr();
    
    // Wire up new managers
    this.dispatchMgr = new DispatchMgr(this.transferMgr);
    this.routingMgr = new RoutingMgr(this.dispatchMgr);
  }

  /**
   * Handle external command (e.g. from MQTT via Worker Event)
   */
  handleCommand(command: any): void {
    this.routingMgr.receiveMessage(command);
  }

  /**
   * Initialize from payload (called from Worker)
   */
  init(payload: InitPayload): void {
    console.log("[SimulationEngine] Initializing...");

    // Set SharedArrayBuffer for Main-Worker communication
    this.store.setSharedBuffer(payload.sharedBuffer);
    this.sensorPointArray.setBuffer(payload.sensorPointBuffer);
    console.log("[SimulationEngine] SharedArrayBuffers connected (vehicle + sensor)");

    // Update config from payload
    this.config = payload.config;

    // Update transfer mode
    this.store.setTransferMode(payload.transferMode);
    console.log(`[SimulationEngine] TransferMode: ${payload.transferMode}`);

    // Store edges and build lookup map
    this.edges = payload.edges;
    this.edgeNameToIndex.clear();
    for (let idx = 0; idx < this.edges.length; idx++) {
      this.edgeNameToIndex.set(this.edges[idx].edge_name, idx);
    }

    // Store nodes and build lookup map
    this.nodes = payload.nodes;
    this.nodeNameToIndex.clear();
    for (let idx = 0; idx < this.nodes.length; idx++) {
      this.nodeNameToIndex.set(this.nodes[idx].node_name, idx);
    }

    console.log(`[SimulationEngine] Loaded ${this.edges.length} edges, ${this.nodes.length} nodes`);
    console.log(`[SimulationEngine] Config: linearMaxSpeed=${this.config.linearMaxSpeed}, curveMaxSpeed=${this.config.curveMaxSpeed}`);

    // Debug: Log diverge edges and their nextEdgeIndices
    const divergeEdges = this.edges.filter(e => e.toNodeIsDiverge);
    console.log(`[SimulationEngine] Found ${divergeEdges.length} diverge edges:`);

    // Initialize LockMgr from edges
    this.lockMgr.initFromEdges(this.edges);

    // Initialize vehicles
    const result: InitializationResult = initializeVehicles({
      edges: this.edges,
      nodes: this.nodes,
      numVehicles: payload.numVehicles,
      vehicleConfigs: payload.vehicleConfigs,
      store: this.store,
      lockMgr: this.lockMgr,
      sensorPointArray: this.sensorPointArray,
      config: this.config,
      transferMode: payload.transferMode,
    });

    this.edgeNameToIndex = result.edgeNameToIndex;
    this.actualNumVehicles = result.actualNumVehicles;

    // Build vehicle loop map (simple loop for now)
    this.buildVehicleLoopMap();

    console.log(`[SimulationEngine] Initialized with ${this.actualNumVehicles} vehicles`);
  }

  /**
   * Build vehicle loop map for path following
   */
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
   * Single simulation step
   */
  step(delta: number): void {
    if (!this.isRunning) return;

    const stepStart = performance.now();

    const clampedDelta = Math.min(delta, this.config.maxDelta);

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
    this.stepTimes = [];

    self.postMessage({
      type: "PERF_STATS",
      avgStepMs,
    });
  }

  /**
   * Dispose the engine
   */
  dispose(): void {
    this.stop();
    this.store.clearAllVehicles();
    this.lockMgr.reset();
    this.transferMgr.clearQueue();
    console.log("[SimulationEngine] Disposed");
  }

  /**
   * Get vehicle data for rendering (Main Thread access via SharedArrayBuffer)
   */
  getVehicleData(): Float32Array {
    return this.vehicleDataArray.getData();
  }

  /**
   * Get actual vehicle count
   */
  getActualNumVehicles(): number {
    return this.actualNumVehicles;
  }
}
