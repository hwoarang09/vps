// shmSimulator/helpers/distanceCalculator.ts

/**
 * Calculate distance between two vehicles
 */
export function calculateVehicleDistance(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  edge1IsLinear: boolean,
  edge2IsLinear: boolean
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.hypot(dx, dy);
}

/**
 * Calculate resume distance for linear-to-linear transitions
 */
export function calculateLinearResumeDistance(
  baseResumeDistance: number
): number {
  return baseResumeDistance;
}

/**
 * Calculate resume distance for transitions involving curves
 */
export function calculateCurveResumeDistance(
  yLead: number,
  yTarget: number,
  baseResumeDistance: number
): number {
  const yDiff = Math.abs(yTarget - yLead);

  if (yDiff < 0.1) {
    return baseResumeDistance;
  } else {
    return 0.1;
  }
}
