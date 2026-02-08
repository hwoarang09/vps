// shmSimulator/core/initializeVehicles.ts
// Uses shared initialization logic from common module

import { EngineStore } from "./EngineStore";
import { LockMgr } from "@/common/vehicle/logic/LockMgr/index";
import { SensorPointArrayBase } from "@/common/vehicle/memory/SensorPointArrayBase";
import { updateSensorPoints } from "@/common/vehicle/helpers/sensorPoints";
import type { Edge } from "@/types/edge";
import type { Node } from "@/types";
import type { SimulationConfig, VehicleInitConfig as SimVehicleInitConfig } from "../types";
import {
  initializeVehicles as initializeVehiclesCommon,
  type InitializationResult,
  type ILockMgr,
  type VehicleInitConfig,
  TransferMode,
} from "@/common/vehicle/initialize";
import { calculateVehiclePlacements } from "@/utils/vehicle/vehiclePlacement";

export type { VehiclePlacement, InitializationResult } from "@/common/vehicle/initialize";

export interface InitializeVehiclesParams {
  edges: Edge[];
  nodes: Node[];
  numVehicles: number;
  vehicleConfigs: SimVehicleInitConfig[];
  store: EngineStore;
  lockMgr: LockMgr;
  sensorPointArray: SensorPointArrayBase;
  config: SimulationConfig;
  transferMode: TransferMode;
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
  sensorPointArray: SensorPointArrayBase,
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
  const { edges, numVehicles, store, lockMgr, sensorPointArray, config, transferMode } = params;


  // Use shared placement calculation (same as arrayMode)
  const placementResult = calculateVehiclePlacements(numVehicles, edges);
  const placements = placementResult.placements;


  // Use common initialization logic
  const result = initializeVehiclesCommon({
    edges,
    placements,
    store,
    lockMgr: createLockMgrAdapter(lockMgr),
    config: createVehicleInitConfig(config),
    transferMode,
    updateSensorPoints: createUpdateSensorPointsWrapper(sensorPointArray, config),
  });


  return result;
}
