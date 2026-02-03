// common/vehicle/movement/mergeBraking.ts
// TODO: 새로운 락 시스템 구현 후 필요시 다시 구현

import type { Edge } from "@/types/edge";
import type { MovementConfig } from "./movementUpdate";
import type { LockMgr } from "@/common/vehicle/logic/LockMgr";

export interface MergeBrakeCheckResult {
  shouldBrake: boolean;
  deceleration: number;
  distanceToMerge: number;
}

/**
 * 합류점 사전 감속 체크 - 비활성화됨
 * 새로운 락 시스템 구현 후 필요시 다시 구현
 */
export function checkMergePreBraking(_params: {
  vehId: number;
  currentEdge: Edge;
  currentRatio: number;
  currentVelocity: number;
  edgeArray: Edge[];
  lockMgr: LockMgr;
  config: MovementConfig;
  data: Float32Array;
  ptr: number;
}): MergeBrakeCheckResult {
  return {
    shouldBrake: false,
    deceleration: 0,
    distanceToMerge: Infinity,
  };
}
