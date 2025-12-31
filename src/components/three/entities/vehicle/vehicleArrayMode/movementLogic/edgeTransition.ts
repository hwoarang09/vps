// vehicleArrayMode/movementLogic/edgeTransition.ts
// Adapter for common edgeTransition with vehicleArrayMode store

import type { Edge } from "@/types/edge";
import { VehicleArrayStore } from "@store/vehicle/arrayMode/vehicleStore";
import { vehicleDataArray } from "@/store/vehicle/arrayMode/vehicleDataArray";
import {
  handleEdgeTransition as sharedHandleEdgeTransition,
  type EdgeTransitionResult,
  type IEdgeTransitionStore,
} from "@/common/vehicle/movement/edgeTransition";

export type { EdgeTransitionResult } from "@/common/vehicle/movement/edgeTransition";

/**
 * Zero-GC: Handles edge transition, writes result to target object.
 */
export function handleEdgeTransition(
  vehicleIndex: number,
  initialEdgeIndex: number,
  initialRatio: number,
  edgeArray: Edge[],
  store: VehicleArrayStore,
  target: EdgeTransitionResult
): void {
  // Adapt VehicleArrayStore to IEdgeTransitionStore
  const storeAdapter: IEdgeTransitionStore = {
    moveVehicleToEdge: (vIdx, nextEdgeIndex, ratio) => {
      store.moveVehicleToEdge(vIdx, nextEdgeIndex, ratio);
    },
  };

  sharedHandleEdgeTransition(
    vehicleDataArray,
    storeAdapter,
    vehicleIndex,
    initialEdgeIndex,
    initialRatio,
    edgeArray,
    target
  );
}
