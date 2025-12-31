// vehicleArrayMode/movementLogic/positionInterpolator.ts
// Adapter for common positionInterpolator with mapConfig Z value

import type { Edge } from "@/types/edge";
import { getMarkerConfig } from "@/config/mapConfig";
import {
  interpolatePositionTo as sharedInterpolatePositionTo,
  type PositionResult,
} from "@/common/vehicle/movement/positionInterpolator";

export type { PositionResult };

/**
 * Zero-GC: Calculates 3D position and rotation, writes to target object.
 * Uses mapConfig for Z value.
 */
export function interpolatePositionTo(
  edge: Edge,
  ratio: number,
  target: PositionResult
): void {
  sharedInterpolatePositionTo(edge, ratio, target, getMarkerConfig().Z);
}

/**
 * @deprecated Use interpolatePositionTo for Zero-GC
 */
export function interpolatePosition(edge: Edge, ratio: number): PositionResult {
  const target: PositionResult = { x: 0, y: 0, z: 0, rotation: 0 };
  interpolatePositionTo(edge, ratio, target);
  return target;
}
