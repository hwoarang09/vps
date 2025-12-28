// shmSimulator/core/SimulationEngine.ts

import VehicleDataArray from "../memory/vehicleDataArray";
import SensorPointArray from "../memory/sensorPointArray";
import EdgeVehicleQueue from "../memory/edgeVehicleQueue";
import { EngineStore } from "./EngineStore";
import { LockMgr } from "../logic/LockMgr";
import { TransferMgr, VehicleLoop } from "../logic/TransferMgr";
import { checkCollisions, CollisionCheckContext } from "../collisionLogic/collisionCheck";
import { updateMovement, MovementUpdateContext } from "../movementLogic/movementUpdate";
import { initializeVehicles, InitializationResult } from "./initializeVehicles";
import type { Edge } from "@/types/edge";
import type { Node } from "@/types";
import type { InitPayload, SimulationConfig } from "../types";
import { createDefaultConfig } from "../types";

export class SimulationEngine {
  // === Internal Store ===
  private store: EngineStore;

  // === Memory ===
  private vehicleDataArray: VehicleDataArray;
  private sensorPointArray: SensorPointArray;
  private edgeVehicleQueue: EdgeVehicleQueue;

  // === Map Data ===
  private edges: Edge[] = [];
  private nodes: Node[] = [];
  private edgeNameToIndex: Map<string, number> = new Map();
  private nodeNameToIndex: Map<string, number> = new Map();

  // === Logic Managers ===
  private lockMgr: LockMgr;
  private transferMgr: TransferMgr;

  // === Runtime ===
  private vehicleLoopMap: Map<number, VehicleLoop> = new Map();
  private config: SimulationConfig;
  private isRunning: boolean = false;
  private actualNumVehicles: number = 0;
  private loopHandle: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Use default config initially, will be overwritten by init()
    this.config = createDefaultConfig();

    this.store = new EngineStore(this.config.maxVehicles, 200000);
    this.vehicleDataArray = this.store.getVehicleDataArray();
    this.sensorPointArray = new SensorPointArray(this.config.maxVehicles);
    this.edgeVehicleQueue = this.store.getEdgeVehicleQueue();
    this.lockMgr = new LockMgr();
    this.transferMgr = new TransferMgr();
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
    console.log(`[SimulationEngine] TransferMode: ${payload.transferMode === 0 ? 'LOOP' : 'RANDOM'} (${payload.transferMode})`);

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
    for (const edge of divergeEdges.slice(0, 10)) { // First 10 only
      console.log(`  ${edge.edge_name} -> ${edge.to_node}: nextEdgeIndices=[${edge.nextEdgeIndices?.join(', ') || 'NONE'}]`);
    }

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

    // For now, create simple loops based on edge connectivity
    for (let i = 0; i < this.actualNumVehicles; i++) {
      const currentEdgeIndex = this.store.getVehicleCurrentEdge(i);
      const currentEdge = this.edges[currentEdgeIndex];

      if (currentEdge) {
        // Simple: just follow next edges
        const sequence: string[] = [currentEdge.edge_name];
        let edge = currentEdge;

        // Build a loop by following next edges (max 100 edges)
        for (let j = 0; j < 100; j++) {
          if (edge.nextEdgeIndices && edge.nextEdgeIndices.length > 0) {
            const nextIdx = edge.nextEdgeIndices[0];
            const nextEdge = this.edges[nextIdx];

            if (!nextEdge) break;

            if (nextEdge.edge_name === currentEdge.edge_name) {
              // Found loop
              break;
            }

            sequence.push(nextEdge.edge_name);
            edge = nextEdge;
          } else {
            break;
          }
        }

        this.vehicleLoopMap.set(i, { edgeSequence: sequence });
      }
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

    this.loopHandle = setInterval(() => {
      this.step(1 / this.config.targetFps);
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

    const clampedDelta = Math.min(delta, 0.1);

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
      store: this.store,
      lockMgr: this.lockMgr,
      transferMgr: this.transferMgr,
      clampedDelta,
      config: this.config,
    };
    updateMovement(movementCtx);
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
