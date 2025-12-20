// initializeVehicles.ts
// Vehicle initialization logic separated from main component
// Only handles data initialization, no rendering

import { edgeVehicleQueue } from "@/store/vehicle/arrayMode/edgeVehicleQueue";
import { getLinearAcceleration, getLinearDeceleration, getCurveMaxSpeed } from "@/config/movementConfig";
import { calculateVehiclePlacementsOnLoops, createPlacementsFromVehicleConfigs, VehiclePlacement } from "@/utils/vehicle/vehiclePlacement";
import { findEdgeLoops, VehicleLoop } from "@/utils/vehicle/loopMaker";
import { vehicleDataArray, SensorData, MovementData, NextEdgeState, VEHICLE_DATA_SIZE, MovingStatus } from "@/store/vehicle/arrayMode/vehicleDataArray";
import { PresetIndex } from "@/store/vehicle/arrayMode/sensorPresets";
import { updateSensorPoints } from "./helpers/sensorPoints";
import { useVehicleGeneralStore } from "@/store/vehicle/vehicleGeneralStore";
import { useVehicleRapierStore } from "@/store/vehicle/rapierMode/vehicleStore";
import { useVehicleTestStore } from "@/store/vehicle/vehicleTestStore";
import { VehicleConfig } from "@/types";

export interface InitializationResult {
  vehicleLoops: VehicleLoop[];
  vehicleLoopMap: Map<number, VehicleLoop>;
  edgeNameToIndex: Map<string, number>;
  edgeArray: any[];
  actualNumVehicles: number;
}

export interface InitializeVehiclesParams {
  edges: any[]; // Edge array from useEdgeStore
  numVehicles: number;
  store: any;
  vehicleConfigs?: VehicleConfig[]; // Optional: if provided, use these instead of auto-placement
}

/**
 * Initialize all vehicles with placement and data (no rendering)
 */
export function initializeVehicles(params: InitializeVehiclesParams): InitializationResult {
  const { edges, numVehicles, store, vehicleConfigs } = params;

  console.log(`[VehicleArrayMode] Initializing...`);

  // 1. Initialize memory
  store.initArrayMemory();

  // Get direct data access
  const directData = vehicleDataArray.getData();

  // 2. Build edge array and name-to-index map
  const edgeArray = edges; // Already an array
  const nameToIndex = new Map<string, number>();
  for (let idx = 0; idx < edgeArray.length; idx++) {
    nameToIndex.set(edgeArray[idx].edge_name, idx);
  }

  // 3. Calculate vehicle placements
  let placements: VehiclePlacement[];
  let vehicleLoops: VehicleLoop[] = [];

  if (vehicleConfigs && vehicleConfigs.length > 0) {
    // Use vehicle configs from vehicles.cfg
    console.log(`[VehicleArrayMode] Using ${vehicleConfigs.length} vehicles from vehicles.cfg`);
    placements = createPlacementsFromVehicleConfigs(vehicleConfigs, edgeArray);
  } else {
    // Auto-placement on loops
    console.log(`[VehicleArrayMode] Auto-placing ${numVehicles} vehicles on loops`);
    const edgeLoops = findEdgeLoops(edgeArray);
    const result = calculateVehiclePlacementsOnLoops(edgeLoops, numVehicles, edgeArray);
    placements = result.placements;
    vehicleLoops = result.vehicleLoops;
  }

  // 4. Build vehicle loop map
  const loopMap = new Map<number, VehicleLoop>();
  for (const loop of vehicleLoops) {
    loopMap.set(loop.vehicleIndex, loop);
  }

  // 5. Set vehicle data
  const edgeVehicleCount = new Map<number, number>();
  for (const placement of placements) {
    const edgeIndex = nameToIndex.get(placement.edgeName);

    // edgeIndex가 없으면 건너뜀 (Guard Clause 패턴으로 변경하여 들여쓰기 감소 추천)
    if (edgeIndex === undefined) continue;

    const edge = edgeArray[edgeIndex];
    const isCurve = edge.vos_rail_type !== "LINEAR";
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

  // 7. Sort vehicles in each edge by edgeRatio (front to back)
  for (const [edgeIdx, _] of edgeVehicleCount) {
    edgeVehicleQueue.sortByEdgeRatio(edgeIdx, directData);
  }

  // 8. Verify edgeVehicleQueue
  let totalInByEdge = 0;
  for (const [edgeIdx, count] of edgeVehicleCount) {
    const actualCount = edgeVehicleQueue.getCount(edgeIdx);
    totalInByEdge += actualCount;
    if (actualCount !== count) {
      console.error(`[VehicleArrayMode] Edge ${edgeIdx} mismatch! Expected: ${count}, Got: ${actualCount}`);
    }
  }

  return {
    vehicleLoops: vehicleLoops,
    vehicleLoopMap: loopMap,
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
    vehicleLoops: VehicleLoop[];
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

  const edgeLoops = findEdgeLoops(edgeArray);
  console.log(`[initializeRapierVehicles] Found ${edgeLoops.length} loops`);

  const result = calculateVehiclePlacementsOnLoops(
    edgeLoops,
    numVehicles,
    edgeArray
  );

  console.log(`[initializeRapierVehicles] ✅ Placement calculation completed!`);
  console.log(`[initializeRapierVehicles]    - Requested vehicles: ${numVehicles}`);
  console.log(`[initializeRapierVehicles]    - Calculated placements: ${result.placements.length}`);
  console.log(`[initializeRapierVehicles]    - Max capacity: ${result.maxCapacity}`);
  console.log(`[initializeRapierVehicles]    - Vehicle loops: ${result.vehicleLoops.length}`);

  if (onPlacementComplete) {
    onPlacementComplete({
      vehicleLoops: result.vehicleLoops,
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

    // Collect all vehicles in this batch
    const vehicleBatch = createVehicleBatch(startIndex, endIndex, result.placements, nameToIndex);

    // Single store update = single re-render
    store.batchAddVehicles(vehicleBatch);

    if (endIndex < totalPlacements) {
      setTimeout(() => processBatch(endIndex), 0);
    } else {
      console.log(`[initializeRapierVehicles] ✅ All ${totalPlacements} vehicles initialized!`);

      // Store initial vehicle distribution for UI display and log edge-based arrays
      const distribution = createVehicleDistribution(result.placements, nameToIndex);

      useVehicleTestStore.getState().setInitialVehicleDistribution(distribution);

      // Set initialized AFTER all batches are complete
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
  placements: any[],
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
  placements: any[],
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
