// Re-export from common
export {
  interpolatePositionTo as interpolatePositionToBase,
  type PositionResult,
} from "@/common/vehicle/movement/positionInterpolator";

import type { Edge } from "@/types/edge";
import { EdgeType } from "@/types";
import { getMarkerConfig } from "@/config/mapConfig";
import type { PositionResult } from "@/common/vehicle/movement/positionInterpolator";
import { interpolatePositionTo as interpolatePositionToBase } from "@/common/vehicle/movement/positionInterpolator";

const RAD_TO_DEG = 180 / Math.PI;

/**
 * Zero-GC: Calculates 3D position and rotation, writes to target object.
 * Uses getMarkerConfig().Z for Z value.
 */
export function interpolatePositionTo(edge: Edge, ratio: number, target: PositionResult): void {
  interpolatePositionToBase(edge, ratio, target, getMarkerConfig().Z);
}

/**
 * Calculates 3D position and rotation based on edge and ratio.
 * @deprecated Use interpolatePositionTo for Zero-GC
 */
export function interpolatePosition(edge: Edge, ratio: number) {
  const points = edge.renderingPoints;

  if (!points || points.length === 0) {
    return { x: 0, y: 0, z: getMarkerConfig().Z, rotation: (edge as any).axis ?? 0 };
  }

  if (edge.vos_rail_type === EdgeType.LINEAR) {
    const pStart = points[0];
    const pEnd = points.at(-1)!;

    const x = pStart.x + (pEnd.x - pStart.x) * ratio;
    const y = pStart.y + (pEnd.y - pStart.y) * ratio;
    const z = getMarkerConfig().Z;

    const dx = pEnd.x - pStart.x;
    const dy = pEnd.y - pStart.y;
    let rotation: number;

    if (Math.abs(dx) >= Math.abs(dy)) {
      rotation = dx >= 0 ? 0 : 180;
    } else {
      rotation = dy >= 0 ? 90 : -90;
    }
    return { x, y, z, rotation };
  }

  const safeRatio = ratio < 0 ? 0 : Math.min(ratio, 1);

  const maxIndex = points.length - 1;
  const floatIndex = safeRatio * maxIndex;
  const index = Math.floor(floatIndex);

  const nextIndex = index < maxIndex ? index + 1 : maxIndex;
  const segmentRatio = floatIndex - index;

  const p1 = points[index];
  const p2 = points[nextIndex];

  const x = p1.x + (p2.x - p1.x) * segmentRatio;
  const y = p1.y + (p2.y - p1.y) * segmentRatio;
  const z = getMarkerConfig().Z;

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

  const rotation = ((rawRotation) % 360 + 360) % 360;

  return { x, y, z, rotation };
}
