// TransferMgr/next-edge-handlers.ts
// Next edge 결정 및 채우기 관련 함수들

import type { Edge } from "@/types/edge";
import { NEXT_EDGE_COUNT, TransferMode } from "@/common/vehicle/initialize/constants";
import type { FillNextEdgesContext, VehicleLoop } from "./types";

/**
 * 첫 번째 next edge 설정 (i === 0)
 */
export function fillFirstNextEdge(
  data: Float32Array,
  ptr: number,
  firstNextEdgeIndex: number,
  nextEdgeOffset: number
): void {
  data[ptr + nextEdgeOffset] = firstNextEdgeIndex;
}

/**
 * 후속 next edges 설정 (i > 0)
 * @param determineNextEdgeFn - edge 결정 함수 (TransferMgr의 determineNextEdge 메서드)
 * @returns 마지막으로 설정된 edge index (다음 반복을 위해)
 */
export function fillSubsequentNextEdge(
  i: number,
  currentEdgeIdx: number,
  ctx: FillNextEdgesContext,
  nextEdgeOffsets: number[],
  determineNextEdgeFn: (
    edge: Edge,
    vehicleIndex: number,
    vehicleLoopMap: Map<number, VehicleLoop>,
    edgeNameToIndex: Map<string, number>,
    mode: TransferMode
  ) => number
): number {
  const { data, ptr, edgeArray, vehicleLoopMap, edgeNameToIndex, mode, vehicleIndex } = ctx;

  if (currentEdgeIdx < 1) {
    data[ptr + nextEdgeOffsets[i]] = 0;
    return 0;
  }

  const prevEdge = edgeArray[currentEdgeIdx - 1];
  if (!prevEdge) {
    data[ptr + nextEdgeOffsets[i]] = 0;
    return 0;
  }

  const nextIdx = determineNextEdgeFn(
    prevEdge,
    vehicleIndex,
    vehicleLoopMap,
    edgeNameToIndex,
    mode
  );

  data[ptr + nextEdgeOffsets[i]] = nextIdx;

  if (nextIdx === 0) {
    // Fill remaining slots with 0
    for (let j = i + 1; j < NEXT_EDGE_COUNT; j++) {
      data[ptr + nextEdgeOffsets[j]] = 0;
    }
  }

  return nextIdx;
}
