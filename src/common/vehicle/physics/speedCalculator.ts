// common/vehicle/physics/speedCalculator.ts
// Shared speed calculation logic for both arrayMode and shmMode

import { Edge, EdgeType } from "@/types";

export interface SpeedConfig {
  linearMaxSpeed: number;
  curveMaxSpeed: number;
}

/**
 * Calculate next velocity based on acceleration/deceleration and edge type
 * @param currentVelocity - Current velocity (m/s)
 * @param acceleration - Acceleration value (m/s²), positive
 * @param deceleration - Deceleration value (m/s²), negative when braking, 0 otherwise
 * @param edge - Current edge (to determine max speed based on rail type)
 * @param delta - Time delta (seconds)
 * @param config - Speed configuration (linearMaxSpeed, curveMaxSpeed)
 * @returns Next velocity (m/s)
 */
export function calculateNextSpeed(
  currentVelocity: number,
  acceleration: number,
  deceleration: number,
  edge: Edge,
  delta: number,
  config: SpeedConfig
): number {
  const isCurve = edge.vos_rail_type !== EdgeType.LINEAR;
  const maxSpeed = isCurve ? config.curveMaxSpeed : config.linearMaxSpeed;

  // deceleration is expected to be <= 0 when braking
  // Rule: acceleration OR deceleration applies, not both.
  if (deceleration === -Infinity) {
    return 0; // hard stop
  }

  const appliedAccel = deceleration < 0 ? deceleration : acceleration;
  let nextVelocity = currentVelocity + appliedAccel * delta;

  // Clamp to physical limits
  if (nextVelocity > maxSpeed) nextVelocity = maxSpeed;
  if (nextVelocity < 0) nextVelocity = 0;

  return nextVelocity;
}
