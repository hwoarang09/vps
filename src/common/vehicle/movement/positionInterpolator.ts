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
    target.x = 0;
    target.y = 0;
    target.z = defaultZ;
    target.rotation = (edge as any).axis ?? 0;
    return;
  }

  // LINEAR EDGES
  if (edge.vos_rail_type === EdgeType.LINEAR) {
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

  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;

  const distSq = dx * dx + dy * dy;
  let rawRotation = 0;

  if (distSq > 0.000001) {
    rawRotation = Math.atan2(dy, dx) * RAD_TO_DEG;
  } else if (index > 0) {
    const pPrev = points[index - 1];
    rawRotation = Math.atan2(p1.y - pPrev.y, p1.x - pPrev.x) * RAD_TO_DEG;
  }

  target.rotation = ((rawRotation % 360) + 360) % 360;
}
