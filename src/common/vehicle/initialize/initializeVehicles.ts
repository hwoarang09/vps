// common/vehicle/initialize/initializeVehicles.ts
// Shared vehicle initialization logic for both arrayMode and shmSimulator

import { EdgeType } from "@/types";
import type { Edge } from "@/types/edge";
import {
  MovementData,
  SensorData,
  NextEdgeState,
  MovingStatus,
  PresetIndex,
  VEHICLE_DATA_SIZE,
  TransferMode,
} from "./constants";
import type {
  VehiclePlacement,
  InitializationResult,
  IVehicleStore,
  ILockMgr,
  VehicleInitConfig,
  InitializeVehiclesCommonParams,
} from "./types";

/**
 * Build edge name to index map
 */
export function buildEdgeNameToIndex(edges: Edge[]): Map<string, number> {
  const nameToIndex = new Map<string, number>();
  for (let idx = 0; idx < edges.length; idx++) {
    nameToIndex.set(edges[idx].edge_name, idx);
  }
  return nameToIndex;
}

/**
 * Parameters for initializeSingleVehicle function
 */
export interface InitializeSingleVehicleParams {
  placement: VehiclePlacement;
  edgeIndex: number;
  edge: Edge;
  store: IVehicleStore;
  config: VehicleInitConfig;
  initialTargetRatio: number;
  updateSensorPoints: (
    vehicleIndex: number,
    x: number,
    y: number,
    rotation: number,
    presetIndex: number
  ) => void;
  onVehicleCreated?: (placement: VehiclePlacement, edgeIndex: number) => void;
}

/**
 * Initialize a single vehicle's state
 */
export function initializeSingleVehicle(
  params: InitializeSingleVehicleParams
): void {
  const {
    placement,
    edgeIndex,
    edge,
    store,
    config,
    initialTargetRatio,
    updateSensorPoints,
    onVehicleCreated,
  } = params;

  const isCurve = edge.vos_rail_type !== EdgeType.LINEAR;
  const initialVelocity = isCurve ? config.curveMaxSpeed : 0;

  // Add vehicle to store
  store.addVehicle(placement.vehicleIndex, {
    x: placement.x,
    y: placement.y,
    z: placement.z,
    edgeIndex: edgeIndex,
    edgeRatio: placement.edgeRatio,
    targetRatio: initialTargetRatio,
    rotation: placement.rotation,
    velocity: initialVelocity,
    acceleration: config.linearAcceleration,
    deceleration: config.linearDeceleration,
    movingStatus: MovingStatus.MOVING,
  });

  // Initialize sensor preset directly in data array
  const vehData = store.getVehicleData();
  const ptr = placement.vehicleIndex * VEHICLE_DATA_SIZE;
  vehData[ptr + SensorData.PRESET_IDX] = PresetIndex.STRAIGHT;
  vehData[ptr + SensorData.HIT_ZONE] = -1;

  // Initialize Target Ratio (New)
  vehData[ptr + MovementData.TARGET_RATIO] = initialTargetRatio;

  // Initialize NextEdge State
  vehData[ptr + MovementData.NEXT_EDGE] = -1;
  vehData[ptr + MovementData.NEXT_EDGE_STATE] = NextEdgeState.EMPTY;

  // Update sensor points
  updateSensorPoints(
    placement.vehicleIndex,
    placement.x,
    placement.y,
    placement.rotation,
    PresetIndex.STRAIGHT
  );

  // Call optional callback (e.g., for UI store updates)
  if (onVehicleCreated) {
    onVehicleCreated(placement, edgeIndex);
  }
}

/**
 * Parameters for initializeVehicleStates function
 */
export interface InitializeVehicleStatesParams {
  placements: VehiclePlacement[];
  nameToIndex: Map<string, number>;
  edgeArray: Edge[];
  store: IVehicleStore;
  config: VehicleInitConfig;
  transferMode: TransferMode;
  updateSensorPoints: (
    vehicleIndex: number,
    x: number,
    y: number,
    rotation: number,
    presetIndex: number
  ) => void;
  onVehicleCreated?: (placement: VehiclePlacement, edgeIndex: number) => void;
}

/**
 * Initialize all vehicles from placements
 */
export function initializeVehicleStates(
  params: InitializeVehicleStatesParams
): Map<number, number> {
  const {
    placements,
    nameToIndex,
    edgeArray,
    store,
    config,
    transferMode,
    updateSensorPoints,
    onVehicleCreated,
  } = params;
  
  const edgeVehicleCount = new Map<number, number>();

  // Determine initial target ratio logic based on transfer mode
  // MQTT_CONTROL -> vehicles spawn stopped at their current placement (Target = edgeRatio)
  // Others -> vehicles spawn and move (Target = 1)
  const isMqtt = transferMode === TransferMode.MQTT_CONTROL;

  for (const placement of placements) {
    const edgeIndex = nameToIndex.get(placement.edgeName);
    if (edgeIndex === undefined) continue;

    const edge = edgeArray[edgeIndex];

    const initialTargetRatio = isMqtt ? placement.edgeRatio : 1;

    initializeSingleVehicle({
      placement,
      edgeIndex,
      edge,
      store,
      config,
      initialTargetRatio,
      updateSensorPoints,
      onVehicleCreated,
    });

    edgeVehicleCount.set(edgeIndex, (edgeVehicleCount.get(edgeIndex) || 0) + 1);
  }

  return edgeVehicleCount;
}

/**
 * Sort vehicles in each edge by edgeRatio (front to back)
 */
export function sortVehiclesInEdges(
  edgeVehicleCount: Map<number, number>,
  store: IVehicleStore
): void {
  const edgeVehicleQueue = store.getEdgeVehicleQueue();
  const directData = store.getVehicleData();

  for (const [edgeIdx] of edgeVehicleCount) {
    edgeVehicleQueue.sortByEdgeRatio(edgeIdx, directData);
  }
}

/**
 * Process initial lock requests for vehicles on merge edges
 */
export function processMergeEdgeLocks(
  edgeVehicleCount: Map<number, number>,
  edgeArray: Edge[],
  store: IVehicleStore,
  lockMgr: ILockMgr
): void {
  const edgeVehicleQueue = store.getEdgeVehicleQueue();

  for (const [edgeIdx] of edgeVehicleCount) {
    const edge = edgeArray[edgeIdx];

    if (lockMgr.isMergeNode(edge.to_node)) {
      const vehiclesOnEdge = edgeVehicleQueue.getVehicles(edgeIdx);

      for (const vehId of vehiclesOnEdge) {
        lockMgr.requestLock(edge.to_node, edge.edge_name, vehId);
      }
    }
  }
}

/**
 * Main initialization function
 * Orchestrates the full vehicle initialization flow
 */
export function initializeVehicles(
  params: InitializeVehiclesCommonParams
): InitializationResult {
  const {
    edges,
    placements,
    store,
    lockMgr,
    config,
    transferMode,
    updateSensorPoints,
    onVehicleCreated,
  } = params;

  const edgeArray = edges;
  const nameToIndex = buildEdgeNameToIndex(edgeArray);

  // Initialize all vehicle states
  // Initialize all vehicle states
  const edgeVehicleCount = initializeVehicleStates({
    placements,
    nameToIndex,
    edgeArray,
    store,
    config,
    transferMode,
    updateSensorPoints,
    onVehicleCreated,
  });

  // Sort vehicles in each edge
  sortVehiclesInEdges(edgeVehicleCount, store);

  // Process merge edge locks
  processMergeEdgeLocks(edgeVehicleCount, edgeArray, store, lockMgr);

  // Set actual number of vehicles
  store.setActualNumVehicles(placements.length);

  return {
    edgeNameToIndex: nameToIndex,
    edgeArray: edgeArray,
    actualNumVehicles: placements.length,
  };
}
