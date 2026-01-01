// common/vehicle/movement/positionInterpolator.ts
// Shared position interpolator for vehicleArrayMode and shmSimulator

import type { Edge } from "@/types/edge";
import { EdgeType } from "@/types";

const RAD_TO_DEG = 180 / Math.PI;

export interface PositionResult {
  x: number;
  y: number;
  z: number;
  rotation: number;
}

/**
 * Zero-GC: Calculates 3D position and rotation, writes to target object.
 * @param edge - Edge to interpolate on
 * @param ratio - Position ratio (0-1)
 * @param target - Target object to write position to
 * @param defaultZ - Z value to use (default: 0.15)
 */
export function interpolatePositionTo(
  edge: Edge,
  ratio: number,
  target: PositionResult,
  defaultZ: number = 0.15
): void {
  const points = edge.renderingPoints;

  if (!points || points.length === 0) {
    setFallbackPosition(target, edge, defaultZ);
    return;
  }

  // LINEAR EDGES
  if (edge.vos_rail_type === EdgeType.LINEAR) {
    interpolateLinearPosition(target, points, ratio, defaultZ);
    return;
  }

  // CURVE EDGES
  const safeRatio = ratio < 0 ? 0 : Math.min(ratio, 1);

  const maxIndex = points.length - 1;
  const floatIndex = safeRatio * maxIndex;
  const index = Math.floor(floatIndex);

  const nextIndex = index < maxIndex ? index + 1 : maxIndex;
  const segmentRatio = floatIndex - index;

  const p1 = points[index];
  const p2 = points[nextIndex];

  target.x = p1.x + (p2.x - p1.x) * segmentRatio;
  target.y = p1.y + (p2.y - p1.y) * segmentRatio;
  target.z = defaultZ;

  const { dx, dy, distSq } = calculateStableVector(
    points,
    index,
    nextIndex,
    p1,
    p2
  );

  let rawRotation = 0;
  if (distSq > 0.000001) {
    rawRotation = Math.atan2(dy, dx) * RAD_TO_DEG;
  }

  target.rotation = ((rawRotation % 360) + 360) % 360;
}

function setFallbackPosition(
  target: PositionResult,
  edge: Edge,
  defaultZ: number
): void {
  target.x = 0;
  target.y = 0;
  target.z = defaultZ;
  target.rotation = (edge as any).axis ?? 0;
}

function interpolateLinearPosition(
  target: PositionResult,
  points: { x: number; y: number }[],
  ratio: number,
  defaultZ: number
): void {
  const pStart = points[0];
  const pEnd = points.at(-1)!;

  target.x = pStart.x + (pEnd.x - pStart.x) * ratio;
  target.y = pStart.y + (pEnd.y - pStart.y) * ratio;
  target.z = defaultZ;

  const dx = pEnd.x - pStart.x;
  const dy = pEnd.y - pStart.y;

  if (Math.abs(dx) >= Math.abs(dy)) {
    target.rotation = dx >= 0 ? 0 : 180;
  } else {
    target.rotation = dy >= 0 ? 90 : -90;
  }
}

function calculateStableVector(
  points: { x: number; y: number }[],
  index: number,
  nextIndex: number,
  p1: { x: number; y: number },
  p2: { x: number; y: number }
): { dx: number; dy: number; distSq: number } {
  // Calculate rotation using points far enough apart for stability
  // Minimum distance threshold for stable direction calculation
  const MIN_DIST_SQ = 0.01; // 0.1m minimum distance
  const maxIndex = points.length - 1;

  let dx = p2.x - p1.x;
  let dy = p2.y - p1.y;
  let distSq = dx * dx + dy * dy;

  // If current segment is too short, look ahead for a farther point
  if (distSq < MIN_DIST_SQ) {
    let lookAheadIdx = nextIndex + 1;
    while (lookAheadIdx <= maxIndex && distSq < MIN_DIST_SQ) {
      const pAhead = points[lookAheadIdx];
      dx = pAhead.x - p1.x;
      dy = pAhead.y - p1.y;
      distSq = dx * dx + dy * dy;
      lookAheadIdx++;
    }

    // If still too short, try looking back
    if (distSq < MIN_DIST_SQ && index > 0) {
      let lookBackIdx = index - 1;
      while (lookBackIdx >= 0 && distSq < MIN_DIST_SQ) {
        const pBack = points[lookBackIdx];
        dx = p1.x - pBack.x;
        dy = p1.y - pBack.y;
        distSq = dx * dx + dy * dy;
        lookBackIdx--;
      }
    }
  }

  return { dx, dy, distSq };
}
