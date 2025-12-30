// common/vehicle/collision/verifyMergeCollision.ts

import { EdgeType } from "@/types";
import type { Edge } from "@/types/edge";
import { MovementData, VEHICLE_DATA_SIZE, HitZone } from "@/common/vehicle/initialize/constants";
import { checkSensorCollision } from "./sensorCollision";
import { applyCollisionZoneLogic } from "./collisionCommon";
import type { CollisionCheckContext } from "./collisionCheck";

function getCurveTailLength(): number {
  return 0.5;
}

function checkCompetitorVehicles(
  ctx: CollisionCheckContext,
  myVehId: number,
  compQueue: Uint16Array | Int32Array,
  currentMaxHitZone: number,
  data: Float32Array,
  compThreshold: number,
  compEdgeLen: number
): { maxHitZone: number; targetId: number } {
  const { sensorPointArray } = ctx;
  const compCount = compQueue[0];
  let maxHitZone = currentMaxHitZone;
  let maxTargetId = -1;

  for (let j = 0; j < compCount; j++) {
    const compVehId = compQueue[1 + j];
    const compPtr = compVehId * VEHICLE_DATA_SIZE;

    const compRatio = data[compPtr + MovementData.EDGE_RATIO];
    const compOffset = compRatio * compEdgeLen;

    if (compOffset < compThreshold) continue;

    const hitZone = checkSensorCollision(sensorPointArray, myVehId, compVehId);

    if (hitZone > maxHitZone) {
      maxHitZone = hitZone;
      maxTargetId = compVehId;
    }

    if (maxHitZone === HitZone.STOP) break;
  }

  return { maxHitZone, targetId: maxTargetId };
}

function checkAgainstCompetitors(
  ctx: CollisionCheckContext,
  vehId: number,
  edgeIdx: number,
  edge: Edge,
  data: Float32Array,
  ptr: number,
  dangerZoneLen: number
) {
  const { edgeArray, edgeVehicleQueue, config } = ctx;

  if (!edge.prevEdgeIndices) return;

  let mostCriticalHitZone: number = HitZone.NONE;
  let criticalTargetId = -1;

  for (const compEdgeIdx of edge.prevEdgeIndices) {
    if (compEdgeIdx === edgeIdx) continue;

    const compQueue = edgeVehicleQueue.getData(compEdgeIdx);
    if (!compQueue || compQueue[0] === 0) continue;

    const compEdge = edgeArray[compEdgeIdx];
    if (!compEdge) continue;

    let compThreshold = 0;
    if (compEdge.vos_rail_type === EdgeType.LINEAR) {
      compThreshold = compEdge.distance - dangerZoneLen;
    }

    const result = checkCompetitorVehicles(
      ctx,
      vehId,
      compQueue,
      mostCriticalHitZone,
      data,
      compThreshold,
      compEdge.distance
    );

    if (result.maxHitZone > mostCriticalHitZone) {
      mostCriticalHitZone = result.maxHitZone;
      criticalTargetId = result.targetId;
    }
  }

  if (mostCriticalHitZone !== HitZone.NONE) {
    applyCollisionZoneLogic(mostCriticalHitZone, data, ptr, criticalTargetId, {
      approachMinSpeed: config.approachMinSpeed,
      brakeMinSpeed: config.brakeMinSpeed,
    });
  }
}

export function verifyMergeZoneCollision(
  edgeIdx: number,
  edge: Edge,
  ctx: CollisionCheckContext,
  queue: Uint16Array | Int32Array
) {
  const { vehicleArrayData, config } = ctx;

  const tailLength = getCurveTailLength();
  const vehicleLen = config.bodyLength;

  const dangerZoneLen = tailLength + vehicleLen * 2;

  const edgeLen = edge.distance;
  const dangerStartOffset = edgeLen - dangerZoneLen;

  const count = queue[0];

  for (let i = 0; i < count; i++) {
    const vehId = queue[1 + i];
    const ptr = vehId * VEHICLE_DATA_SIZE;

    let currentOffset = 0;

    if (edge.vos_rail_type === EdgeType.LINEAR) {
      const ratio = vehicleArrayData[ptr + MovementData.EDGE_RATIO];
      currentOffset = ratio * edgeLen;
    } else {
      currentOffset = vehicleArrayData[ptr + MovementData.OFFSET];
    }

    let effectiveStartOffset = dangerStartOffset;
    if (edge.vos_rail_type !== EdgeType.LINEAR) {
      effectiveStartOffset = 0;
    }

    if (currentOffset < effectiveStartOffset) continue;

    checkAgainstCompetitors(ctx, vehId, edgeIdx, edge, vehicleArrayData, ptr, dangerZoneLen);
  }
}
