// shmSimulator/collisionLogic/verifyNextPathCollision.ts

import type { Edge } from "@/types/edge";
import { EdgeType } from "@/types/index";
import { HitZone, VEHICLE_DATA_SIZE } from "../memory/vehicleDataArray";
import { applyCollisionZoneLogic } from "./collisionCommon";
import { checkSensorCollision } from "../helpers/sensorCollision";
import type { CollisionCheckContext } from "./collisionCheck";

/** 짧은 직선 edge를 "투과"해서 볼 최소 길이 (미터) */
const SHORT_LINEAR_THRESHOLD = 2.0;

export function verifyNextPathCollision(
  edgeIdx: number,
  edge: Edge,
  ctx: CollisionCheckContext
) {
  const { vehicleArrayData, edgeVehicleQueue, sensorPointArray, edgeArray } = ctx;

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

  // 이미 체크한 edge를 추적 (무한 루프 방지)
  const checkedEdges = new Set<number>();

  // 체크할 edge 큐 (BFS 방식)
  const edgesToCheck: number[] = [...nextEdges];

  while (edgesToCheck.length > 0 && mostCriticalHitZone !== HitZone.STOP) {
    const nextEdgeIdx = edgesToCheck.shift()!;

    // 이미 체크한 edge는 스킵
    if (checkedEdges.has(nextEdgeIdx)) continue;
    checkedEdges.add(nextEdgeIdx);

    const nextEdge = edgeArray[nextEdgeIdx];
    if (!nextEdge) continue;

    // 해당 edge에 차량이 있으면 충돌 체크
    const targetQueue = edgeVehicleQueue.getData(nextEdgeIdx);
    if (targetQueue && targetQueue[0] > 0) {
      const count = targetQueue[0];
      const tailVehIdx = targetQueue[1 + count - 1];

      const hitZone = checkSensorCollision(sensorPointArray, myVehIdx, tailVehIdx);

      if (hitZone > mostCriticalHitZone) {
        mostCriticalHitZone = hitZone;
        targetIdx = tailVehIdx;
      }
    }

    // 짧은 직선 edge면 그 뒤의 edge들도 체크 대상에 추가
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

  applyCollisionZoneLogic(mostCriticalHitZone, vehicleArrayData, ptrMe, targetIdx);
}
