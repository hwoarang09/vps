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
 * 같은 edge 내에서만 ratio 정렬
 * - 다른 edge 간에는 순서 유지 (path 순서대로 push되었으므로)
 * - 같은 edge가 연속으로 나오면 ratio 오름차순 정렬
 *
 * 예: [E2@0.5, E2@0.0, E3@0.8] → [E2@0.0, E2@0.5, E3@0.8]
 */
export function sortCheckpointsByRatioWithinEdge(
  checkpoints: Array<{ edge: number; ratio: number; flags: number }>
): void {
  if (checkpoints.length <= 1) return;

  let i = 0;
  while (i < checkpoints.length) {
    const currentEdge = checkpoints[i].edge;
    let j = i + 1;

    // 같은 edge 구간 찾기
    while (j < checkpoints.length && checkpoints[j].edge === currentEdge) {
      j++;
    }

    // 같은 edge 구간이 2개 이상이면 ratio 정렬
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

