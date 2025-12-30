// Re-export types from common
export {
  type EdgeTransitionResult,
  type IVehicleDataArray,
  type IEdgeTransitionStore,
} from "@/common/vehicle/movement/edgeTransition";

import type { Edge } from "@/types/edge";
import { VehicleArrayStore } from "@store/vehicle/arrayMode/vehicleStore";
import { vehicleDataArray } from "@/store/vehicle/arrayMode/vehicleDataArray";
import {
  handleEdgeTransition as handleEdgeTransitionBase,
  type EdgeTransitionResult,
} from "@/common/vehicle/movement/edgeTransition";

/**
 * Zero-GC: Handles edge transition, writes result to target object.
 * Uses global vehicleDataArray.
 */
export function handleEdgeTransition(
  vehicleIndex: number,
  initialEdgeIndex: number,
  initialRatio: number,
  edgeArray: Edge[],
  store: VehicleArrayStore,
  target: EdgeTransitionResult
): void {
  handleEdgeTransitionBase(
    vehicleDataArray,
    store,
    vehicleIndex,
    initialEdgeIndex,
    initialRatio,
    edgeArray,
    target
  );
}
