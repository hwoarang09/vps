// shmSimulator/core/initializeVehicles.ts
// Uses shared initialization logic from common module

import { EngineStore } from "./EngineStore";
import { LockMgr } from "../logic/LockMgr";
import SensorPointArray from "../memory/sensorPointArray";
import { updateSensorPoints } from "../helpers/sensorPoints";
import type { Edge } from "@/types/edge";
import type { Node } from "@/types";
import type { SimulationConfig, VehicleInitConfig as SimVehicleInitConfig } from "../types";
import {
  initializeVehicles as initializeVehiclesCommon,
  VehiclePlacement,
  InitializationResult,
  ILockMgr,
  VehicleInitConfig,
} from "@/common/vehicle/initialize";
import { calculateVehiclePlacements } from "@/utils/vehicle/vehiclePlacement";

export type { VehiclePlacement, InitializationResult };

export interface InitializeVehiclesParams {
  edges: Edge[];
  nodes: Node[];
  numVehicles: number;
  vehicleConfigs: SimVehicleInitConfig[];
  store: EngineStore;
  lockMgr: LockMgr;
  sensorPointArray: SensorPointArray;
  config: SimulationConfig;
}

/**
 * Create adapter for LockMgr to implement ILockMgr
 */
function createLockMgrAdapter(lockMgr: LockMgr): ILockMgr {
  return {
    isMergeNode: lockMgr.isMergeNode.bind(lockMgr),
    requestLock: lockMgr.requestLock.bind(lockMgr),
  };
}

/**
 * Create config from SimulationConfig
 */
function createVehicleInitConfig(config: SimulationConfig): VehicleInitConfig {
  return {
    linearAcceleration: config.linearAcceleration,
    linearDeceleration: config.linearDeceleration,
    linearMaxSpeed: config.linearMaxSpeed,
    curveMaxSpeed: config.curveMaxSpeed,
    vehicleZOffset: config.vehicleZOffset,
  };
}

/**
 * Create updateSensorPoints wrapper with sensorPointArray and config
 */
function createUpdateSensorPointsWrapper(
  sensorPointArray: SensorPointArray,
  config: SimulationConfig
) {
  return (
    vehicleIndex: number,
    x: number,
    y: number,
    rotation: number,
    presetIndex: number
  ): void => {
    updateSensorPoints(
      sensorPointArray,
      vehicleIndex,
      x,
      y,
      rotation,
      presetIndex,
      config
    );
  };
}

export function initializeVehicles(params: InitializeVehiclesParams): InitializationResult {
  const { edges, numVehicles, store, lockMgr, sensorPointArray, config } = params;

  console.log(`[shmSimulator] Initializing ${numVehicles} vehicles...`);

  // Use shared placement calculation (same as arrayMode)
  const placementResult = calculateVehiclePlacements(numVehicles, edges);
  const placements = placementResult.placements;

  console.log(`[shmSimulator] Placement: requested=${numVehicles}, actual=${placements.length}, maxCapacity=${placementResult.maxCapacity}`);

  // Use common initialization logic
  const result = initializeVehiclesCommon({
    edges,
    placements,
    store,
    lockMgr: createLockMgrAdapter(lockMgr),
    config: createVehicleInitConfig(config),
    updateSensorPoints: createUpdateSensorPointsWrapper(sensorPointArray, config),
  });

  console.log(`[shmSimulator] Initialized ${placements.length} vehicles`);

  return result;
}
