// common/vehicle/physics/speedCalculator.ts
// Shared speed calculation logic for both arrayMode and shmMode

import { Edge, EdgeType } from "@/types";

export interface SpeedConfig {
  linearMaxSpeed: number;
  curveMaxSpeed: number;
}

/**
 * 감속에 필요한 거리 계산 (등가속도 운동)
 * d = (v₀² - v₁²) / (2|a|)
 * @param fromSpeed 초기 속도 (m/s)
 * @param toSpeed 목표 속도 (m/s)
 * @param deceleration 감속도 (음수, m/s²)
 * @returns 감속 필요 거리 (m)
 */
export function calculateBrakeDistance(
  fromSpeed: number,
  toSpeed: number,
  deceleration: number
): number {
  if (deceleration >= 0) return 0;
  const absDecel = Math.abs(deceleration);
  const distance = (fromSpeed * fromSpeed - toSpeed * toSpeed) / (2 * absDecel);
  return Math.max(0, distance);
}

/**
 * 주어진 거리에서 도달할 수 있는 최대 속도 계산
 * v² = v₀² + 2ad → v = sqrt(v₀² + 2ad)
 * 감속의 경우 a < 0이므로 v₀² - 2|a|d
 * @param targetSpeed 곡선에서 도달해야 하는 속도 (m/s)
 * @param distance 남은 거리 (m)
 * @param deceleration 감속도 (음수, m/s²)
 * @returns 현재 위치에서 허용되는 최대 속도 (m/s)
 */
export function calculateMaxSpeedForDistance(
  targetSpeed: number,
  distance: number,
  deceleration: number
): number {
  if (deceleration >= 0 || distance <= 0) return Infinity;
  const absDecel = Math.abs(deceleration);
  // v² = v_target² + 2|a|d
  const vSquared = targetSpeed * targetSpeed + 2 * absDecel * distance;
  return Math.sqrt(vSquared);
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
