// Re-export from common
export {
  determineLinearHitZone,
  calculateLinearDistance,
  calculateEuclideanDistance,
  type CollisionConfig,
} from "@/common/vehicle/collision/collisionCommon";

import { getApproachMinSpeed, getBrakeMinSpeed } from "@/config/movementConfig";
import { getBodyLength } from "@/config/vehicleConfig";
import {
  getCollisionCheckParams as getCollisionCheckParamsBase,
  applyCollisionZoneLogic as applyCollisionZoneLogicBase,
} from "@/common/vehicle/collision/collisionCommon";

/**
 * Extract basic collision check parameters for a specific vehicle.
 * Uses global config functions.
 */
export function getCollisionCheckParams(vehicleArrayData: Float32Array, ptr: number) {
  return getCollisionCheckParamsBase(vehicleArrayData, ptr, {
    approachMinSpeed: getApproachMinSpeed(),
    brakeMinSpeed: getBrakeMinSpeed(),
    bodyLength: getBodyLength(),
  });
}

/**
 * Apply the logic (Velocity/Deceleration/Status) based on the determined HitZone.
 * Uses global config functions.
 */
export function applyCollisionZoneLogic(
  hitZone: number,
  data: Float32Array,
  ptrBack: number,
  targetVehId: number = -1
) {
  return applyCollisionZoneLogicBase(hitZone, data, ptrBack, targetVehId, {
    approachMinSpeed: getApproachMinSpeed(),
    brakeMinSpeed: getBrakeMinSpeed(),
  });
}
