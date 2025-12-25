import { getLinearMaxSpeed, getCurveMaxSpeed } from "@/config/movementConfig";
import { Edge, EdgeType } from "@/types"; // Edge 타입 가정

export function calculateNextSpeed(
  currentVelocity: number,
  acceleration: number,
  deceleration: number,
  edge: Edge,
  delta: number
): number {
  const isCurve = edge.vos_rail_type !== EdgeType.LINEAR;
  const linearMax = getLinearMaxSpeed();
  const curveMax = getCurveMaxSpeed();

  const maxSpeed = isCurve ? curveMax : linearMax;

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
