// Re-export types from common
export {
  type CollisionCheckContext,
  type IEdgeVehicleQueue,
  type ISensorPointArray,
} from "@/common/vehicle/collision/collisionCheck";

import type { Edge } from "@/types/edge";
import { edgeVehicleQueue } from "@/store/vehicle/arrayMode/edgeVehicleQueue";
import { sensorPointArray } from "@/store/vehicle/arrayMode/sensorPointArray";
import { getApproachMinSpeed, getBrakeMinSpeed } from "@/config/movementConfig";
import { getBodyLength } from "@/config/vehicleConfig";
import { checkCollisions as checkCollisionsBase } from "@/common/vehicle/collision/collisionCheck";

interface CollisionCheckParams {
  vehicleArrayData: Float32Array;
  edgeArray: Edge[];
}

export function checkCollisions(params: CollisionCheckParams) {
  const { vehicleArrayData, edgeArray } = params;

  // Build context from global dependencies
  const ctx = {
    vehicleArrayData,
    edgeArray,
    edgeVehicleQueue,
    sensorPointArray,
    config: {
      approachMinSpeed: getApproachMinSpeed(),
      brakeMinSpeed: getBrakeMinSpeed(),
      bodyLength: getBodyLength(),
    },
  };

  checkCollisionsBase(ctx);
}
