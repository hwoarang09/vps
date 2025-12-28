import { Edge } from "@/types/edge";
import { EdgeType } from "@/types/index";
import { edgeVehicleQueue } from "@/store/vehicle/arrayMode/edgeVehicleQueue";
import { HitZone, VEHICLE_DATA_SIZE } from "@/store/vehicle/arrayMode/vehicleDataArray";
import { applyCollisionZoneLogic } from "./collisionCommon";
import { checkSensorCollision } from "@/components/three/entities/vehicle/vehicleArrayMode/helpers/sensorCollision";
import { useEdgeStore } from "@/store/map/edgeStore";

/** 짧은 직선 edge를 "투과"해서 볼 최소 길이 (미터) */
const SHORT_LINEAR_THRESHOLD = 2;

/** edge의 tail 차량과 충돌 체크 후 결과 반환 */
function checkEdgeTailCollision(
  nextEdgeIdx: number,
  myVehIdx: number,
  currentHitZone: number
): { hitZone: number; targetIdx: number } {
  const targetQueue = edgeVehicleQueue.getData(nextEdgeIdx);
  if (!targetQueue || targetQueue[0] === 0) {
    return { hitZone: currentHitZone, targetIdx: -1 };
  }

  const count = targetQueue[0];
  const tailVehIdx = targetQueue[1 + count - 1];
  const hitZone = checkSensorCollision(myVehIdx, tailVehIdx);

  if (hitZone > currentHitZone) {
    return { hitZone, targetIdx: tailVehIdx };
  }
  return { hitZone: currentHitZone, targetIdx: -1 };
}

/** 짧은 직선 edge면 그 뒤 edge들을 큐에 추가 */
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

/**
 * Handles Case 1 (!Merge, !Diverge) and Case 2 (!Merge, Diverge).
 * Checks collision with the tail vehicle of all next edges.
 * If next edge is a short LINEAR (< 2m), also checks edges beyond it.
 */
export function verifyNextPathCollision(edgeIdx: number, edge: Edge, vehicleArrayData: Float32Array) {
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

  const edgeArray = useEdgeStore.getState().edges as Edge[];
  const checkedEdges = new Set<number>();
  const edgesToCheck: number[] = [...nextEdges];

  while (edgesToCheck.length > 0 && mostCriticalHitZone !== HitZone.STOP) {
    const nextEdgeIdx = edgesToCheck.shift()!;

    if (checkedEdges.has(nextEdgeIdx)) continue;
    checkedEdges.add(nextEdgeIdx);

    const nextEdge = edgeArray[nextEdgeIdx];
    if (!nextEdge) continue;

    // 충돌 체크
    const result = checkEdgeTailCollision(nextEdgeIdx, myVehIdx, mostCriticalHitZone);
    if (result.hitZone > mostCriticalHitZone) {
      mostCriticalHitZone = result.hitZone;
      targetIdx = result.targetIdx;
    }

    // 짧은 직선이면 뒤 edge들도 큐에 추가
    enqueueShortLinearNextEdges(nextEdge, checkedEdges, edgesToCheck);
  }

  applyCollisionZoneLogic(mostCriticalHitZone, vehicleArrayData, ptrMe, targetIdx);
}
