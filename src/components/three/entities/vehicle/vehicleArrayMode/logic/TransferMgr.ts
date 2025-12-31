// vehicleArrayMode/logic/TransferMgr.ts
// Wrapper using global vehicleDataArray

import { vehicleDataArray } from "@/store/vehicle/arrayMode/vehicleDataArray";
import type { Edge } from "@/types/edge";
import { VehicleLoop, getNextEdgeInLoop } from "@/utils/vehicle/loopMaker";
import { TransferMode } from "@/store/vehicle/arrayMode/vehicleStore";
import {
  TransferMgr,
  type TransferMode as TransferModeBase,
} from "@/common/vehicle/logic/TransferMgr";

// Re-export types and functions
export { TransferMgr } from "@/common/vehicle/logic/TransferMgr";
export { getNextEdgeInLoop, type VehicleLoop } from "@/utils/vehicle/loopMaker";

// Singleton instance
const _transferMgr = new TransferMgr();

export function getTransferMgr() {
  return _transferMgr;
}

export function enqueueVehicleTransfer(vehicleIndex: number) {
  _transferMgr.enqueueVehicleTransfer(vehicleIndex);
}

export function getTransferQueueLength() {
  return _transferMgr.getTransferQueueLength();
}

export function processTransferQueue(
  edgeArray: Edge[],
  vehicleLoopMap: Map<number, VehicleLoop>,
  edgeNameToIndex: Map<string, number>,
  mode: TransferMode
) {
  const modeValue: TransferModeBase = mode === TransferMode.LOOP ? 0 : 1;
  _transferMgr.processTransferQueue(
    vehicleDataArray,
    edgeArray,
    vehicleLoopMap,
    edgeNameToIndex,
    modeValue
  );
}
