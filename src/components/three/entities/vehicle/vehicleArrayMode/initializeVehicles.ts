// initializeVehicles.ts
// Vehicle initialization logic separated from main component
// Uses shared initialization logic from common module

import { edgeVehicleQueue } from "@/store/vehicle/arrayMode/edgeVehicleQueue";
import { getLinearAcceleration, getLinearDeceleration, getCurveMaxSpeed, getLinearMaxSpeed } from "@/config/movementConfig";
import { calculateVehiclePlacements, createPlacementsFromVehicleConfigs, VehiclePlacement } from "@/utils/vehicle/vehiclePlacement";
import { vehicleDataArray } from "@/store/vehicle/arrayMode/vehicleDataArray";
import { updateSensorPoints } from "@/common/vehicle/helpers/sensorPoints";
import { sensorPointArray } from "@/store/vehicle/arrayMode/sensorPointArray";
import { getBodyLength, getBodyWidth } from "@/config/vehicleConfig";
import { useVehicleGeneralStore } from "@/store/vehicle/vehicleGeneralStore";
import { useVehicleRapierStore } from "@/store/vehicle/rapierMode/vehicleStore";
import { useVehicleTestStore } from "@/store/vehicle/vehicleTestStore";
import { VehicleConfig } from "@/types";
import { getLockMgr } from "@/common/vehicle/logic/LockMgr";
import {
  initializeVehicles as initializeVehiclesCommon,
  buildEdgeNameToIndex,
  VehiclePlacement as CommonVehiclePlacement,
  IVehicleStore,
  ILockMgr,
  VehicleInitConfig,
  type InitializationResult,
  TransferMode,
} from "@/common/vehicle/initialize";

export type { InitializationResult } from "@/common/vehicle/initialize";

export interface InitializeVehiclesParams {
  edges: any[];
  numVehicles: number;
  store: any;
  vehicleConfigs?: VehicleConfig[];
  transferMode?: TransferMode;
}

/**
 * Create adapter for arrayMode store to implement IVehicleStore
 */
function createStoreAdapter(store: any): IVehicleStore {
  return {
    addVehicle: store.addVehicle.bind(store),
    setActualNumVehicles: store.setActualNumVehicles.bind(store),
    getVehicleData: () => vehicleDataArray.getData(),
    getEdgeVehicleQueue: () => edgeVehicleQueue,
  };
}

/**
 * Create adapter for LockMgr to implement ILockMgr
 */
function createLockMgrAdapter(): ILockMgr {
  const lockMgr = getLockMgr();
  return {
    isMergeNode: lockMgr.isMergeNode.bind(lockMgr),
    requestLock: lockMgr.requestLock.bind(lockMgr),
  };
}

/**
 * Create config from movement config
 */
function createVehicleInitConfig(): VehicleInitConfig {
  return {
    linearAcceleration: getLinearAcceleration(),
    linearDeceleration: getLinearDeceleration(),
    linearMaxSpeed: getLinearMaxSpeed(),
    curveMaxSpeed: getCurveMaxSpeed(),
    vehicleZOffset: 0, // arrayMode doesn't use zOffset
  };
}

/**
 * Callback for vehicle creation - adds to UI store
 */
function onVehicleCreated(placement: CommonVehiclePlacement, _edgeIndex: number): void {
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

/**
 * Wrapper for updateSensorPoints to match common interface
 */
function updateSensorPointsWrapper(
  vehicleIndex: number,
  x: number,
  y: number,
  rotation: number,
  presetIndex: number
): void {
  updateSensorPoints(sensorPointArray, vehicleIndex, x, y, rotation, presetIndex, {
    bodyLength: getBodyLength(),
    bodyWidth: getBodyWidth(),
  });
}

/**
 * Initialize all vehicles with placement and data (no rendering)
 */
export function initializeVehicles(params: InitializeVehiclesParams): InitializationResult {
  const { edges, numVehicles, store, vehicleConfigs, transferMode } = params;

  console.log(`[VehicleArrayMode] Initializing...`);

  // 1. Initialize memory
  store.initArrayMemory();

  // 2. Calculate vehicle placements
  const placements = getVehiclePlacements(vehicleConfigs, numVehicles, edges);

  // 3. Use common initialization logic
  const result = initializeVehiclesCommon({
    edges,
    placements,
    store: createStoreAdapter(store),
    lockMgr: createLockMgrAdapter(),
    config: createVehicleInitConfig(),
    transferMode: transferMode || TransferMode.LOOP, // Use passed mode or default
    updateSensorPoints: updateSensorPointsWrapper,
    onVehicleCreated,
  });

  return result;
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
  const nameToIndex = buildEdgeNameToIndex(edgeArray);

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
): CommonVehiclePlacement[] {
  if (vehicleConfigs && vehicleConfigs.length > 0) {
    console.log(`[VehicleArrayMode] Using ${vehicleConfigs.length} vehicles from vehicles.cfg`);
    return createPlacementsFromVehicleConfigs(vehicleConfigs, edgeArray);
  } else {
    console.log(`[VehicleArrayMode] Auto-placing ${numVehicles} vehicles`);
    const result = calculateVehiclePlacements(numVehicles, edgeArray);
    return result.placements;
  }
}
