// vehicleArrayMode/movementLogic/movementUpdate.ts
// Adapter that delegates to shared implementation

import { vehicleDataArray } from "@/store/vehicle/arrayMode/vehicleDataArray";
import { sensorPointArray } from "@/store/vehicle/arrayMode/sensorPointArray";
import { VehicleArrayStore, TransferMode } from "@/store/vehicle/arrayMode/vehicleStore";
import { VehicleLoop } from "@/utils/vehicle/loopMaker";
import { Edge } from "@/types/edge";

import { getLockMgr } from "../logic/LockMgr";
import { getTransferMgr } from "../logic/TransferMgr";

import {
  updateMovement as sharedUpdateMovement,
  type MovementUpdateContext,
  type MovementConfig,
} from "@/common/vehicle/movement/movementUpdate";
import {
  getLinearMaxSpeed,
  getCurveMaxSpeed,
  getCurveAcceleration,
} from "@/config/movementConfig";
import { getBodyLength, getBodyWidth } from "@/config/vehicleConfig";
import type { TransferMode as TransferModeBase } from "@/common/vehicle/logic/TransferMgr";

export interface MovementUpdateParams {
  data: Float32Array;
  edgeArray: Edge[];
  actualNumVehicles: number;
  vehicleLoopMap: Map<number, VehicleLoop>;
  edgeNameToIndex: Map<string, number>;
  store: VehicleArrayStore;
  clampedDelta: number;
}

/**
 * Adapter function for vehicleArrayMode
 * Converts params to MovementUpdateContext and delegates to shared implementation
 */
export function updateMovement(params: MovementUpdateParams) {
  const {
    edgeArray,
    actualNumVehicles,
    vehicleLoopMap,
    edgeNameToIndex,
    store,
    clampedDelta,
  } = params;

  // Build MovementConfig from config getters
  const config: MovementConfig = {
    linearMaxSpeed: getLinearMaxSpeed(),
    curveMaxSpeed: getCurveMaxSpeed(),
    curveAcceleration: getCurveAcceleration(),
    vehicleZOffset: 0.15,
    bodyLength: getBodyLength(),
    bodyWidth: getBodyWidth(),
  };

  // Convert TransferMode enum to number
  const transferModeValue: TransferModeBase =
    store.transferMode === TransferMode.LOOP ? 0 : 1;

  // Build context for shared implementation
  const ctx: MovementUpdateContext = {
    vehicleDataArray,
    sensorPointArray,
    edgeArray,
    actualNumVehicles,
    vehicleLoopMap,
    edgeNameToIndex,
    store: {
      moveVehicleToEdge: store.moveVehicleToEdge,
      transferMode: transferModeValue,
    },
    lockMgr: getLockMgr(),
    transferMgr: getTransferMgr(),
    clampedDelta,
    config,
  };

  sharedUpdateMovement(ctx);
}
