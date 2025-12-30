// common/vehicle/collision/verifyNextPathCollision.ts

import type { Edge } from "@/types/edge";
import { EdgeType } from "@/types/index";
import { HitZone, VEHICLE_DATA_SIZE } from "@/common/vehicle/initialize/constants";
import { applyCollisionZoneLogic } from "./collisionCommon";
import { checkSensorCollision } from "./sensorCollision";
import type { CollisionCheckContext } from "./collisionCheck";

const SHORT_LINEAR_THRESHOLD = 2;

function checkEdgeTailCollision(
  nextEdgeIdx: number,
  myVehIdx: number,
  currentHitZone: number,
  ctx: CollisionCheckContext
): { hitZone: number; targetIdx: number } {
  const { edgeVehicleQueue, sensorPointArray } = ctx;

  const targetQueue = edgeVehicleQueue.getData(nextEdgeIdx);
  if (!targetQueue || targetQueue[0] === 0) {
    return { hitZone: currentHitZone, targetIdx: -1 };
  }

  const count = targetQueue[0];
  const tailVehIdx = targetQueue[1 + count - 1];
  const hitZone = checkSensorCollision(sensorPointArray, myVehIdx, tailVehIdx);

  if (hitZone > currentHitZone) {
    return { hitZone, targetIdx: tailVehIdx };
  }
  return { hitZone: currentHitZone, targetIdx: -1 };
}

function enqueueShortLinearNextEdges(
  nextEdge: Edge,
  checkedEdges: Set<number>,
  edgesToCheck: number[]
) {
  if (
    nextEdge.vos_rail_type === EdgeType.LINEAR &&
    nextEdge.distance < SHORT_LINEAR_THRESHOLD &&
    nextEdge.nextEdgeIndices
  ) {
    for (const furtherEdgeIdx of nextEdge.nextEdgeIndices) {
      if (!checkedEdges.has(furtherEdgeIdx)) {
        edgesToCheck.push(furtherEdgeIdx);
      }
    }
  }
}

export function verifyNextPathCollision(
  edgeIdx: number,
  edge: Edge,
  ctx: CollisionCheckContext
) {
  const { vehicleArrayData, edgeVehicleQueue, edgeArray, config } = ctx;

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

  const checkedEdges = new Set<number>();
  const edgesToCheck: number[] = [...nextEdges];

  while (edgesToCheck.length > 0 && mostCriticalHitZone !== HitZone.STOP) {
    const nextEdgeIdx = edgesToCheck.shift()!;

    if (checkedEdges.has(nextEdgeIdx)) continue;
    checkedEdges.add(nextEdgeIdx);

    const nextEdge = edgeArray[nextEdgeIdx];
    if (!nextEdge) continue;

    const result = checkEdgeTailCollision(nextEdgeIdx, myVehIdx, mostCriticalHitZone, ctx);
    if (result.hitZone > mostCriticalHitZone) {
      mostCriticalHitZone = result.hitZone;
      targetIdx = result.targetIdx;
    }

    enqueueShortLinearNextEdges(nextEdge, checkedEdges, edgesToCheck);
  }

  applyCollisionZoneLogic(mostCriticalHitZone, vehicleArrayData, ptrMe, targetIdx, {
    approachMinSpeed: config.approachMinSpeed,
    brakeMinSpeed: config.brakeMinSpeed,
  });
}
