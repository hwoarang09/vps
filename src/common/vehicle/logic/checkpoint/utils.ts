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
 * 두 checkpoint가 같은 위치인지 확인 (edge + ratio)
 * @param edge1 - Edge ID 1
 * @param ratio1 - Ratio 1
 * @param edge2 - Edge ID 2
 * @param ratio2 - Ratio 2
 * @param tolerance - 허용 오차 (기본 0.0001 = 소수 4자리)
 * @returns 같은 위치면 true
 */
export function isSamePosition(
  edge1: number,
  ratio1: number,
  edge2: number,
  ratio2: number,
  tolerance: number = 0.0001
): boolean {
  if (edge1 !== edge2) return false;
  return Math.abs(ratio1 - ratio2) < tolerance;
}

/**
 * Checkpoint 리스트를 edge + ratio 순으로 정렬
 */
export function sortCheckpoints(checkpoints: Array<{ edge: number; ratio: number; flags: number }>): void {
  checkpoints.sort((a, b) => {
    if (a.edge !== b.edge) return a.edge - b.edge;
    return a.ratio - b.ratio;
  });
}

/**
 * Checkpoint 중복 제거 (같은 edge + ratio)
 * 같은 위치면 flags를 OR로 합침
 */
export function deduplicateCheckpoints(
  checkpoints: Array<{ edge: number; ratio: number; flags: number }>
): Array<{ edge: number; ratio: number; flags: number }> {
  if (checkpoints.length === 0) return [];

  sortCheckpoints(checkpoints);

  const result: Array<{ edge: number; ratio: number; flags: number }> = [];
  let current = { ...checkpoints[0] };

  for (let i = 1; i < checkpoints.length; i++) {
    const cp = checkpoints[i];

    if (isSamePosition(current.edge, current.ratio, cp.edge, cp.ratio)) {
      // 같은 위치 → flags 합치기
      current.flags |= cp.flags;
    } else {
      // 다른 위치 → 현재 저장하고 새로 시작
      result.push(current);
      current = { ...cp };
    }
  }

  result.push(current);
  return result;
}
