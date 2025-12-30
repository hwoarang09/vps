// Wrapper using global dependencies
import { vehicleDataArray } from "@/store/vehicle/arrayMode/vehicleDataArray";
import { sensorPointArray } from "@/store/vehicle/arrayMode/sensorPointArray";
import { getLockMgr } from "../logic/LockMgr";
import { VehicleArrayStore } from "@/store/vehicle/arrayMode/vehicleStore";
import { VehicleLoop } from "@/utils/vehicle/loopMaker";
import { Edge } from "@/types/edge";
import {
  getLinearMaxSpeed,
  getCurveMaxSpeed,
  getCurveAcceleration,
} from "@/config/movementConfig";
import { getBodyLength, getBodyWidth } from "@/config/vehicleConfig";
import { getMarkerConfig } from "@/config/mapConfig";
import {
  updateMovement as updateMovementBase,
  type MovementUpdateContext,
} from "@/common/vehicle/movement/movementUpdate";
import { TransferMgr } from "@/common/vehicle/logic/TransferMgr";
import { TransferMode } from "@/store/vehicle/arrayMode/vehicleStore";

// Singleton TransferMgr
const _transferMgr = new TransferMgr();

// Re-export for compatibility
export { enqueueVehicleTransfer, processTransferQueue } from "../logic/TransferMgr";

interface MovementUpdateParams {
  data: Float32Array;
  edgeArray: Edge[];
  actualNumVehicles: number;
  vehicleLoopMap: Map<number, VehicleLoop>;
  edgeNameToIndex: Map<string, number>;
  store: VehicleArrayStore;
  clampedDelta: number;
}

export function updateMovement(params: MovementUpdateParams) {
  const {
    edgeArray,
    actualNumVehicles,
    vehicleLoopMap,
    edgeNameToIndex,
    store,
    clampedDelta,
  } = params;

  const ctx: MovementUpdateContext = {
    vehicleDataArray,
    sensorPointArray,
    edgeArray,
    actualNumVehicles,
    vehicleLoopMap,
    edgeNameToIndex,
    store: {
      moveVehicleToEdge: store.moveVehicleToEdge.bind(store),
      transferMode: store.transferMode === TransferMode.LOOP ? 0 : 1,
    },
    lockMgr: getLockMgr(),
    transferMgr: _transferMgr,
    clampedDelta,
    config: {
      linearMaxSpeed: getLinearMaxSpeed(),
      curveMaxSpeed: getCurveMaxSpeed(),
      curveAcceleration: getCurveAcceleration(),
      bodyLength: getBodyLength(),
      bodyWidth: getBodyWidth(),
      vehicleZOffset: getMarkerConfig().Z,
    },
  };

  updateMovementBase(ctx);
}
