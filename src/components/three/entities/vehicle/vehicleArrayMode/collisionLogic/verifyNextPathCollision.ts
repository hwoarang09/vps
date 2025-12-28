import { Edge } from "@/types/edge";
import { EdgeType } from "@/types/index";
import { edgeVehicleQueue } from "@/store/vehicle/arrayMode/edgeVehicleQueue";
import { HitZone, VEHICLE_DATA_SIZE } from "@/store/vehicle/arrayMode/vehicleDataArray";
import { applyCollisionZoneLogic } from "./collisionCommon";
import { checkSensorCollision } from "@/components/three/entities/vehicle/vehicleArrayMode/helpers/sensorCollision";
import { useEdgeStore } from "@/store/map/edgeStore";

/** 짧은 직선 edge를 "투과"해서 볼 최소 길이 (미터) */
const SHORT_LINEAR_THRESHOLD = 2.0;

/**
 * Handles Case 1 (!Merge, !Diverge) and Case 2 (!Merge, Diverge).
 * Checks collision with the tail vehicle of all next edges.
 * If next edge is a short LINEAR (< 2m), also checks edges beyond it.
 */
export function verifyNextPathCollision(edgeIdx: number, edge: Edge, vehicleArrayData: Float32Array) {
  // 1. Get My Vehicle (Lead Vehicle of current edge)
  const myQueue = edgeVehicleQueue.getData(edgeIdx);
  if (!myQueue || myQueue[0] === 0) return;
  const myVehIdx = myQueue[1];
  const ptrMe = myVehIdx * VEHICLE_DATA_SIZE;

  // 2. Check All Next Edges (Works for 1 or Many)
  let mostCriticalHitZone: number = HitZone.NONE;
  let targetIdx = -1;

  const nextEdges = edge.nextEdgeIndices;
  if (!nextEdges || nextEdges.length === 0) {
    return;
  }

  // Get edge array for looking up next edges
  const edgeArray = useEdgeStore.getState().edges as Edge[];

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

      const hitZone = checkSensorCollision(myVehIdx, tailVehIdx);

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

  // 4. Apply Logic
  applyCollisionZoneLogic(mostCriticalHitZone, vehicleArrayData, ptrMe, targetIdx);
}
