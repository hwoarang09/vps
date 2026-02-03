// common/vehicle/collision/collisionCheck.ts
// Shared collision check logic for vehicleArrayMode and shmSimulator

import type { Edge } from "@/types/edge";
import type { CollisionConfig } from "./collisionCommon";
import { verifyEdgeCollision } from "./verifyEdgeCollision";

// Interfaces for dependency injection
export interface IEdgeVehicleQueue {
  getData(edgeIdx: number): Int32Array | Uint16Array | null;
  getCount(edgeIdx: number): number;
  // Direct access methods for performance (hot paths)
  getDataDirect(): Int32Array | Uint16Array;
  getOffsetForEdge(edgeIdx: number): number;
  readonly edgeListSize: number;
}

export interface ISensorPointArray {
  getData(): Float32Array;
}

export interface CollisionCheckContext {
  vehicleArrayData: Float32Array;
  edgeArray: Edge[];
  edgeVehicleQueue: IEdgeVehicleQueue;
  sensorPointArray: ISensorPointArray;
  config: CollisionConfig;
  /** 프레임 delta 시간 (초 단위) */
  delta?: number;
  /** 차량별 충돌 체크 누적 시간 (ms) */
  collisionCheckTimers?: Map<number, number>;
}

export function checkCollisions(ctx: CollisionCheckContext) {
  const { edgeArray, edgeVehicleQueue } = ctx;

  // NOTE: Internal loop uses 0-based index for array access,
  // but passes 1-based index to verifyEdgeCollision
  for (let arrayIdx = 0; arrayIdx < edgeArray.length; arrayIdx++) {
    const edge = edgeArray[arrayIdx];
    if (!edge) continue;

    const edgeIdx = arrayIdx + 1; // Convert to 1-based for external use
    const count = edgeVehicleQueue.getCount(edgeIdx);
    if (count === 0) continue;

    verifyEdgeCollision(edgeIdx, edge, ctx);
  }
}
