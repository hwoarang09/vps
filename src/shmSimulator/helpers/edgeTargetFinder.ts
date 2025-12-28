// shmSimulator/helpers/edgeTargetFinder.ts

import type { Edge } from "@/types/edge";

/**
 * Find collision target edges for a lead vehicle
 */
export function findCollisionTargetEdges(
  currentEdge: Edge,
  edgeArray: Edge[]
): { mergeTargetIndices: number[]; nextTargetIndices: number[] } {
  const mergeTargetIndices: number[] = [];
  const nextTargetIndices: number[] = [];

  // [1] Merge Targets (Competitors entering same node)
  if (currentEdge.toNodeIsMerge && currentEdge.prevEdgeIndices) {
    for (const idx of currentEdge.prevEdgeIndices) {
      const otherEdge = edgeArray[idx];
      if (otherEdge && otherEdge.edge_name !== currentEdge.edge_name) {
        mergeTargetIndices.push(idx);
      }
    }
  }

  // [2] Next Targets (Paths leaving the node)
  if (currentEdge.nextEdgeIndices) {
    nextTargetIndices.push(...currentEdge.nextEdgeIndices);
  }

  return { mergeTargetIndices, nextTargetIndices };
}
