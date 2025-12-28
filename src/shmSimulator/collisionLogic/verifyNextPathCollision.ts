// shmSimulator/collisionLogic/verifyNextPathCollision.ts

import type { Edge } from "@/types/edge";
import { HitZone, VEHICLE_DATA_SIZE } from "../memory/vehicleDataArray";
import { applyCollisionZoneLogic } from "./collisionCommon";
import { checkSensorCollision } from "../helpers/sensorCollision";
import type { CollisionCheckContext } from "./collisionCheck";

export function verifyNextPathCollision(
  edgeIdx: number,
  edge: Edge,
  ctx: CollisionCheckContext
) {
  const { vehicleArrayData, edgeVehicleQueue, sensorPointArray } = ctx;

  const myQueue = edgeVehicleQueue.getData(edgeIdx);
  if (!myQueue || myQueue[0] === 0) return;
  const myVehIdx = myQueue[1];
  const ptrMe = myVehIdx * VEHICLE_DATA_SIZE;

  let mostCriticalHitZone: number = HitZone.NONE;
  let targetIdx = -1;

  const nextEdges = edge.nextEdgeIndices;
  if (!nextEdges || nextEdges.length === 0) {
    return;
  }

  for (const nextEdgeIdx of nextEdges) {
    const targetQueue = edgeVehicleQueue.getData(nextEdgeIdx);
    if (!targetQueue || targetQueue[0] === 0) continue;

    const count = targetQueue[0];
    const tailVehIdx = targetQueue[1 + count - 1];

    const hitZone = checkSensorCollision(sensorPointArray, myVehIdx, tailVehIdx);

    if (hitZone > mostCriticalHitZone) {
      mostCriticalHitZone = hitZone;
      targetIdx = tailVehIdx;
    }

    if (mostCriticalHitZone === HitZone.STOP) break;
  }

  applyCollisionZoneLogic(mostCriticalHitZone, vehicleArrayData, ptrMe, targetIdx);
}
