// initializeVehicles.ts
// Vehicle initialization logic separated from main component
// Only handles data initialization, no rendering

import { edgeVehicleQueue } from "@/store/vehicle/arrayMode/edgeVehicleQueue";
import { getLinearAcceleration, getLinearDeceleration, getCurveMaxSpeed } from "@/config/movementConfig";
import { calculateVehiclePlacements, createPlacementsFromVehicleConfigs, VehiclePlacement } from "@/utils/vehicle/vehiclePlacement";
import { vehicleDataArray, SensorData, MovementData, NextEdgeState, VEHICLE_DATA_SIZE, MovingStatus } from "@/store/vehicle/arrayMode/vehicleDataArray";
import { PresetIndex } from "@/store/vehicle/arrayMode/sensorPresets";
import { updateSensorPoints } from "./helpers/sensorPoints";
import { useVehicleGeneralStore } from "@/store/vehicle/vehicleGeneralStore";
import { useVehicleRapierStore } from "@/store/vehicle/rapierMode/vehicleStore";
import { useVehicleTestStore } from "@/store/vehicle/vehicleTestStore";
import { VehicleConfig, EdgeType } from "@/types";
import { getLockMgr } from "./logic/LockMgr";

export interface InitializationResult {
  edgeNameToIndex: Map<string, number>;
  edgeArray: any[];
  actualNumVehicles: number;
}

export interface InitializeVehiclesParams {
  edges: any[];
  numVehicles: number;
  store: any;
  vehicleConfigs?: VehicleConfig[];
}

/**
 * Initialize all vehicles with placement and data (no rendering)
 */
export function initializeVehicles(params: InitializeVehiclesParams): InitializationResult {
  const { edges, numVehicles, store, vehicleConfigs } = params;

  console.log(`[VehicleArrayMode] Initializing...`);

  // 1. Initialize memory
  store.initArrayMemory();

  const directData = vehicleDataArray.getData();

  // 2. Build edge array and name-to-index map
  const edgeArray = edges;
  const nameToIndex = new Map<string, number>();
  for (let idx = 0; idx < edgeArray.length; idx++) {
    nameToIndex.set(edgeArray[idx].edge_name, idx);
  }

  // 3. Calculate vehicle placements
  let placements: VehiclePlacement[];

  placements = getVehiclePlacements(vehicleConfigs, numVehicles, edgeArray);

  // 4. Set vehicle data
  const edgeVehicleCount = new Map<number, number>();
    initializeVehicleState(placements, nameToIndex, edgeArray, store, edgeVehicleCount);

  // 5. Sort vehicles in each edge by edgeRatio (front to back)
  for (const [edgeIdx, _] of edgeVehicleCount) {
    edgeVehicleQueue.sortByEdgeRatio(edgeIdx, directData);
  }

  // 6. Verify edgeVehicleQueue
  verifyEdgeVehicleCounts(edgeVehicleCount);

  // 7. Initial lock requests for vehicles on merge edges
  // Issue lock requests in correct order (front to back) to prevent simultaneous requests
  processMergeEdgeLocks(edgeVehicleCount, edgeArray);

  return {
    edgeNameToIndex: nameToIndex,
    edgeArray: edgeArray,
    actualNumVehicles: placements.length,
  };
}

export interface RapierInitializationParams {
  numVehicles: number;
  mode: "rapier" | "array_single" | "array_shared";
  edges: any[];
  setInitialized: (val: boolean) => void;
  onPlacementComplete?: (result: {
    edgeNameToIndex: Map<string, number>;
  }) => void;
}

/**
 * Initialize vehicles for Rapier Mode (handles batching and asynchronous updates)
 */
export function initializeRapierVehicles(params: RapierInitializationParams) {
  const { numVehicles, mode, edges, setInitialized, onPlacementComplete } = params;

  console.log(`[initializeRapierVehicles] Initializing ${mode} mode with Rapier physics`);

  const store = useVehicleRapierStore.getState();
  store.initRapierMode();

  const edgeArray = Array.from(edges.values());

  const nameToIndex = new Map<string, number>();
  for (let idx = 0; idx < edgeArray.length; idx++) {
    nameToIndex.set(edgeArray[idx].edge_name, idx);
  }

  const result = calculateVehiclePlacements(numVehicles, edgeArray);

  console.log(`[initializeRapierVehicles] ✅ Placement calculation completed!`);
  console.log(`[initializeRapierVehicles]    - Requested vehicles: ${numVehicles}`);
  console.log(`[initializeRapierVehicles]    - Calculated placements: ${result.placements.length}`);
  console.log(`[initializeRapierVehicles]    - Max capacity: ${result.maxCapacity}`);

  if (onPlacementComplete) {
    onPlacementComplete({
      edgeNameToIndex: nameToIndex
    });
  }

  // Rapier mode: batch initialization with SINGLE re-render per batch
  const BATCH_SIZE = 100;
  const totalPlacements = result.placements.length;

  const processBatch = (startIndex: number) => {
    const endIndex = Math.min(startIndex + BATCH_SIZE, totalPlacements);
    const batchNumber = Math.floor(startIndex / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(totalPlacements / BATCH_SIZE);

    console.log(`[initializeRapierVehicles] 🚗 Creating batch ${batchNumber}/${totalBatches} (vehicles ${startIndex}-${endIndex - 1})`);

    const vehicleBatch = createVehicleBatch(startIndex, endIndex, result.placements, nameToIndex);
    store.batchAddVehicles(vehicleBatch);

    if (endIndex < totalPlacements) {
      setTimeout(() => processBatch(endIndex), 0);
    } else {
      console.log(`[initializeRapierVehicles] ✅ All ${totalPlacements} vehicles initialized!`);

      const distribution = createVehicleDistribution(result.placements, nameToIndex);
      useVehicleTestStore.getState().setInitialVehicleDistribution(distribution);

      store.setActualNumVehicles(result.placements.length);
      store.setMaxPlaceableVehicles(result.maxCapacity);
      setInitialized(true);
      console.log(`[initializeRapierVehicles] setInitialized(true) called`);
    }
  };

  processBatch(0);
}

// --- Helper Functions ---

function createVehicleBatch(
  startIndex: number,
  endIndex: number,
  placements: VehiclePlacement[],
  nameToIndex: Map<string, number>
) {
  const vehicleBatch = [];
  for (let i = startIndex; i < endIndex; i++) {
    const placement = placements[i];
    const edgeIndex = nameToIndex.get(placement.edgeName);

    if (edgeIndex !== undefined) {
      vehicleBatch.push({
        index: placement.vehicleIndex,
        x: placement.x,
        y: placement.y,
        z: placement.z,
        velocity: 0,
        edgeIndex: edgeIndex,
        edgeRatio: placement.edgeRatio,
        status: 1,
      });
    }
  }
  return vehicleBatch;
}

function createVehicleDistribution(
  placements: VehiclePlacement[],
  nameToIndex: Map<string, number>
) {
  const distribution = new Map<number, number[]>();
  for (const placement of placements) {
    const edgeIndex = nameToIndex.get(placement.edgeName);
    if (edgeIndex !== undefined) {
      if (!distribution.has(edgeIndex)) {
        distribution.set(edgeIndex, []);
      }
      distribution.get(edgeIndex)!.push(placement.vehicleIndex);
    }
  }
  return distribution;
}

function getVehiclePlacements(
  vehicleConfigs: VehicleConfig[] | undefined,
  numVehicles: number,
  edgeArray: any[]
): VehiclePlacement[] {
  if (vehicleConfigs && vehicleConfigs.length > 0) {
    console.log(`[VehicleArrayMode] Using ${vehicleConfigs.length} vehicles from vehicles.cfg`);
    return createPlacementsFromVehicleConfigs(vehicleConfigs, edgeArray);
  } else {
    console.log(`[VehicleArrayMode] Auto-placing ${numVehicles} vehicles`);
    const result = calculateVehiclePlacements(numVehicles, edgeArray);
    return result.placements;
  }
}

function initializeVehicleState(
  placements: VehiclePlacement[],
  nameToIndex: Map<string, number>,
  edgeArray: any[],
  store: any,
  edgeVehicleCount: Map<number, number>
) {
  for (const placement of placements) {
    const edgeIndex = nameToIndex.get(placement.edgeName);
    if (edgeIndex === undefined) continue;

    const edge = edgeArray[edgeIndex];
    const isCurve = edge.vos_rail_type !== EdgeType.LINEAR;
    const initialVelocity = isCurve ? getCurveMaxSpeed() : 0;

    store.addVehicle(placement.vehicleIndex, {
      x: placement.x,
      y: placement.y,
      z: placement.z,
      edgeIndex: edgeIndex,
      edgeRatio: placement.edgeRatio,
      rotation: placement.rotation,
      velocity: initialVelocity,
      acceleration: getLinearAcceleration(),
      deceleration: getLinearDeceleration(),
      movingStatus: MovingStatus.MOVING,
    });

    // Initialize sensor preset based on edge type
    const vehData = vehicleDataArray.getData();
    const ptr = placement.vehicleIndex * VEHICLE_DATA_SIZE;
    vehData[ptr + SensorData.PRESET_IDX] = PresetIndex.STRAIGHT;
    vehData[ptr + SensorData.HIT_ZONE] = -1;

    // Initialize NextEdge State
    vehData[ptr + MovementData.NEXT_EDGE] = -1;
    vehData[ptr + MovementData.NEXT_EDGE_STATE] = NextEdgeState.EMPTY;

    updateSensorPoints(
      placement.vehicleIndex,
      placement.x,
      placement.y,
      placement.rotation,
      PresetIndex.STRAIGHT
    );

    edgeVehicleCount.set(edgeIndex, (edgeVehicleCount.get(edgeIndex) || 0) + 1);

    const idNumber = placement.vehicleIndex;
    const formattedId = `VEH${String(idNumber).padStart(5, '0')}`;

    useVehicleGeneralStore.getState().addVehicle(placement.vehicleIndex, {
      id: formattedId,
      name: `Vehicle ${placement.vehicleIndex}`,
      color: "#ffffff",
      battery: 100,
      vehicleType: 0,
      taskType: 0,
    });
  }
}

function verifyEdgeVehicleCounts(edgeVehicleCount: Map<number, number>) {
  let totalInByEdge = 0;
  for (const [edgeIdx, count] of edgeVehicleCount) {
    const actualCount = edgeVehicleQueue.getCount(edgeIdx);
    totalInByEdge += actualCount;
    if (actualCount !== count) {
      console.error(`[VehicleArrayMode] Edge ${edgeIdx} mismatch! Expected: ${count}, Got: ${actualCount}`);
    }
  }
}

function processMergeEdgeLocks(
  edgeVehicleCount: Map<number, number>,
  edgeArray: any[]
) {
  const lockMgr = getLockMgr();
  for (const [edgeIdx, _] of edgeVehicleCount) {
    const edge = edgeArray[edgeIdx];

    // Check if this edge leads to a merge node
    if (lockMgr.isMergeNode(edge.to_node)) {
      // Get vehicles on this edge (already sorted by edgeRatio, front to back)
      const vehiclesOnEdge = edgeVehicleQueue.getVehicles(edgeIdx);

      console.log(`[InitVehicles] Merge edge ${edge.edge_name} -> ${edge.to_node}: Pre-requesting locks for ${vehiclesOnEdge.length} vehicles`);

      // Request lock in order (front to back)
      for (const vehId of vehiclesOnEdge) {
        lockMgr.requestLock(edge.to_node, edge.edge_name, vehId);
      }
    }
  }
}