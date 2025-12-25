
import { edgeVehicleQueue } from "@/store/vehicle/arrayMode/edgeVehicleQueue";
import { Edge } from "@/types/edge";
import { EdgeType } from "@/types";

import { verifyLinearCollision } from "./verifyLinearCollision";
import { verifyCurveCollision } from "./verifyCurveCollision";

interface CollisionCheckParams {
  vehicleArrayData: Float32Array;
  edgeArray: Edge[];
}

// Check collisions and control vehicle stop/resume
export function checkCollisions(params: CollisionCheckParams) {
  const {
    vehicleArrayData,
    edgeArray
  } = params;

  for (let edgeIdx = 0; edgeIdx < edgeArray.length; edgeIdx++) {
    const edge = edgeArray[edgeIdx];
    // Safety check
    if (!edge) continue;

    // Zero-allocation: get count directly
    const count = edgeVehicleQueue.getCount(edgeIdx);
    if (count === 0) continue;

    if (edge.vos_rail_type === EdgeType.LINEAR) {
      verifyLinearCollision(edgeIdx, edge, vehicleArrayData);
    } else {
      verifyCurveCollision(edgeIdx, edge, vehicleArrayData);
    }
  }
}
