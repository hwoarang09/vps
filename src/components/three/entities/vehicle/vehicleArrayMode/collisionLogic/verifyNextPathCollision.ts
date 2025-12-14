import { Edge } from "@/types/edge";
import { edgeVehicleQueue } from "@/store/vehicle/arrayMode/edgeVehicleQueue";
import { HitZone, VEHICLE_DATA_SIZE } from "@/store/vehicle/arrayMode/vehicleDataArray";
import { applyCollisionZoneLogic } from "./collisionCommon";
import { checkSensorCollision } from "@/components/three/entities/vehicle/vehicleArrayMode/helpers/sensorCollision";

/**
 * Handles Case 1 (!Merge, !Diverge) and Case 2 (!Merge, Diverge).
 * Checks collision with the tail vehicle of all next edges.
 */
export function verifyNextPathCollision(edgeIdx: number, edge: Edge, vehicleArrayData: Float32Array) {
  // 1. Get My Vehicle (Lead Vehicle of current edge)
  const myQueue = edgeVehicleQueue.getData(edgeIdx);
  if (!myQueue || myQueue[0] === 0) return;
  const myVehIdx = myQueue[1]; // Index 0 is the Lead Vehicle (index 1 in array)
  const ptrMe = myVehIdx * VEHICLE_DATA_SIZE;

  // 2. Check All Next Edges (Works for 1 or Many)
  let mostCriticalHitZone: number = HitZone.NONE;
  let targetIdx = -1;

  const nextEdges = edge.nextEdgeIndices;
  if (!nextEdges || nextEdges.length === 0) {
    // End of line, no next path. Maybe stop?
    // For now, if no path, we do nothing (or could force stop)
    // Assuming standard behavior is free unless blocked.
    // If we want "Stop at end of world", we'd do it here.
    return;
  }

  for (const nextEdgeIdx of nextEdges) {
    const targetQueue = edgeVehicleQueue.getData(nextEdgeIdx);
    if (!targetQueue || targetQueue[0] === 0) continue;

    const count = targetQueue[0];
    const tailVehIdx = targetQueue[1 + count - 1]; // Last vehicle (Tail)

    // Use SAT Collision Check (Global Coordinates)
    // Use SAT Collision Check (Global Coordinates)
    // Returns HitZone (0, 1, 2) or -1 (NONE)
    const hitZone = checkSensorCollision(myVehIdx, tailVehIdx);

    // Upgrade critical zone
    if (hitZone > mostCriticalHitZone) {
      mostCriticalHitZone = hitZone;
      targetIdx = tailVehIdx;
    }

    // Optimization: If STOP, we can break early as it's the max severity
    if (mostCriticalHitZone === HitZone.STOP) break;
  }

  // 4. Apply Logic
  applyCollisionZoneLogic(mostCriticalHitZone, vehicleArrayData, ptrMe, targetIdx);
}
