// common/vehicle/collision/verifyCurveCollision.ts

import type { Edge } from "@/types/edge";
import { verifyNextPathCollision } from "./verifyNextPathCollision";
import { verifyFollowingCollision } from "./verifyFollowingCollision";
import { verifyMergeZoneCollision } from "./verifyMergeCollision";
import type { CollisionCheckContext } from "./collisionCheck";

export function verifyCurveCollision(
  edgeIdx: number,
  edge: Edge,
  ctx: CollisionCheckContext
) {
  const rawData = ctx.edgeVehicleQueue.getData(edgeIdx);
  if (!rawData || rawData[0] === 0) return;

  verifyNextPathCollision(edgeIdx, edge, ctx);
  verifyFollowingCollision(edgeIdx, edge, ctx);

  if (edge.toNodeIsMerge && edge.prevEdgeIndices && edge.prevEdgeIndices.length > 1) {
    verifyMergeZoneCollision(edgeIdx, edge, ctx, rawData);
  }
}
