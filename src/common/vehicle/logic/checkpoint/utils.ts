// common/vehicle/logic/checkpoint/utils.ts
// Checkpoint 계산 유틸리티

import type { Edge } from "@/types/edge";
import { EdgeType } from "@/types";

/**
 * Edge 길이로부터 거리를 ratio로 변환
 * @param edge - Edge 객체
 * @param distanceFromEnd - edge 끝에서부터의 거리 (m, 음수면 끝 전, 양수면 끝 후)
 * @returns ratio (0.0~1.0)
 */
export function distanceToRatio(edge: Edge, distanceFromEnd: number): number {
  const edgeLength = edge.distance;
  if (edgeLength <= 0) return 0;

  // distanceFromEnd가 음수면 끝 전, 양수면 끝 후
  // 예: distanceFromEnd = -20 → edge 끝에서 20m 전
  const distanceFromStart = edgeLength + distanceFromEnd;
  const ratio = distanceFromStart / edgeLength;

  // 0.0 ~ 1.0 범위로 제한
  return Math.max(0, Math.min(1, ratio));
}

/**
 * Ratio를 거리로 변환
 * @param edge - Edge 객체
 * @param ratio - ratio (0.0~1.0)
 * @returns 거리 (m)
 */
export function ratioToDistance(edge: Edge, ratio: number): number {
  return edge.distance * ratio;
}

/**
 * Edge가 곡선인지 확인
 * @param edge - Edge 객체
 * @returns 곡선이면 true
 */
export function isCurveEdge(edge: Edge): boolean {
  return edge.vos_rail_type !== EdgeType.LINEAR;
}

/**
 * Checkpoint ratio를 정규화 (소수 4자리)
 * 나중에 정수 변환 시 사용
 * @param ratio - 원본 ratio
 * @returns 정규화된 ratio
 */
export function normalizeRatio(ratio: number): number {
  // 현재는 그대로 반환 (나중에 Math.round(ratio * 10000) / 10000 로 변경 가능)
  return ratio;
}

/**
 * 같은 edge 내에서만 ratio 정렬 (legacy, sortCheckpointsByPathOrder 사용 권장)
 */
export function sortCheckpointsByRatioWithinEdge(
  checkpoints: Array<{ edge: number; ratio: number; flags: number }>
): void {
  if (checkpoints.length <= 1) return;

  let i = 0;
  while (i < checkpoints.length) {
    const currentEdge = checkpoints[i].edge;
    let j = i + 1;

    while (j < checkpoints.length && checkpoints[j].edge === currentEdge) {
      j++;
    }

    if (j - i > 1) {
      const segment = checkpoints.slice(i, j);
      segment.sort((a, b) => a.ratio - b.ratio);
      for (let k = 0; k < segment.length; k++) {
        checkpoints[i + k] = segment[k];
      }
    }

    i = j;
  }
}

/**
 * 경로 순서 기반 전체 정렬
 * - 1차: edge의 경로 내 위치 (path에서 먼저 나오는 edge가 앞)
 * - 2차: 같은 edge 내에서 ratio 오름차순
 *
 * @param checkpoints - 정렬할 checkpoint 배열 (in-place)
 * @param edgeIndices - 경로 edge ID 배열 (1-based edge IDs)
 */
export function sortCheckpointsByPathOrder(
  checkpoints: Array<{ edge: number; ratio: number; flags: number }>,
  edgeIndices: number[]
): void {
  if (checkpoints.length <= 1) return;

  // edgeId → 경로 내 첫 번째 출현 인덱스
  const edgePathIndex = new Map<number, number>();
  for (let i = 0; i < edgeIndices.length; i++) {
    if (!edgePathIndex.has(edgeIndices[i])) {
      edgePathIndex.set(edgeIndices[i], i);
    }
  }

  checkpoints.sort((a, b) => {
    const aIdx = edgePathIndex.get(a.edge) ?? 999999;
    const bIdx = edgePathIndex.get(b.edge) ?? 999999;
    if (aIdx !== bIdx) return aIdx - bIdx;
    return a.ratio - b.ratio;
  });
}

