// shmSimulator/movementLogic/movementUpdate.ts
// Adapter that delegates to shared implementation

import VehicleDataArray from "../memory/vehicleDataArray";
import SensorPointArray from "../memory/sensorPointArray";
import { EngineStore } from "../core/EngineStore";
import { LockMgr } from "../logic/LockMgr";
import { TransferMgr, VehicleLoop } from "../logic/TransferMgr";
import type { Edge } from "@/types/edge";
import type { SimulationConfig } from "../types";

import {
  updateMovement as sharedUpdateMovement,
  type MovementUpdateContext,
  type MovementConfig,
} from "@/common/vehicle/movement/movementUpdate";

export interface MovementUpdateContextLocal {
  vehicleDataArray: VehicleDataArray;
  sensorPointArray: SensorPointArray;
  edgeArray: Edge[];
  actualNumVehicles: number;
  vehicleLoopMap: Map<number, VehicleLoop>;
  edgeNameToIndex: Map<string, number>;
  store: EngineStore;
  lockMgr: LockMgr;
  transferMgr: TransferMgr;
  clampedDelta: number;
  config: SimulationConfig;
}

/**
 * Adapter function for shmSimulator
 * Converts local context to MovementUpdateContext and delegates to shared implementation
 */
export function updateMovement(ctx: MovementUpdateContextLocal) {
  const {
    vehicleDataArray,
    sensorPointArray,
    edgeArray,
    actualNumVehicles,
    vehicleLoopMap,
    edgeNameToIndex,
    store,
    lockMgr,
    transferMgr,
    clampedDelta,
    config,
  } = ctx;

  // Build MovementConfig from SimulationConfig
  const movementConfig: MovementConfig = {
    linearMaxSpeed: config.linearMaxSpeed,
    curveMaxSpeed: config.curveMaxSpeed,
    curveAcceleration: config.curveAcceleration,
    vehicleZOffset: config.vehicleZOffset,
    bodyLength: config.bodyLength,
    bodyWidth: config.bodyWidth,
  };

  // Build context for shared implementation
  const sharedCtx: MovementUpdateContext = {
    vehicleDataArray,
    sensorPointArray,
    edgeArray,
    actualNumVehicles,
    vehicleLoopMap,
    edgeNameToIndex,
    store: {
      moveVehicleToEdge: store.moveVehicleToEdge.bind(store),
      transferMode: store.transferMode,
    },
    lockMgr,
    transferMgr,
    clampedDelta,
    config: movementConfig,
  };

  sharedUpdateMovement(sharedCtx);
}
