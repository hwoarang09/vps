// shmSimulator/movementLogic/edgeTransition.ts
// Adapter for common edgeTransition with shmSimulator store

import type { Edge } from "@/types/edge";
import VehicleDataArray from "../memory/vehicleDataArray";
import { EngineStore } from "../core/EngineStore";
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
  vehicleDataArray: VehicleDataArray,
  store: EngineStore,
  vehicleIndex: number,
  initialEdgeIndex: number,
  initialRatio: number,
  edgeArray: Edge[],
  target: EdgeTransitionResult
): void {
  // Adapt EngineStore to IEdgeTransitionStore
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
