// shmSimulator/movementLogic/speedCalculator.ts

import type { Edge } from "@/types/edge";
import { EdgeType } from "@/types";
import type { SimulationConfig } from "../types";

export function calculateNextSpeed(
  currentVelocity: number,
  acceleration: number,
  deceleration: number,
  edge: Edge,
  delta: number,
  config: SimulationConfig
): number {
  const isCurve = edge.vos_rail_type !== EdgeType.LINEAR;
  const maxSpeed = isCurve ? config.curveMaxSpeed : config.linearMaxSpeed;

  if (deceleration === -Infinity) {
    return 0;
  }

  const appliedAccel = deceleration < 0 ? deceleration : acceleration;
  let nextVelocity = currentVelocity + appliedAccel * delta;

  if (nextVelocity > maxSpeed) nextVelocity = maxSpeed;
  if (nextVelocity < 0) nextVelocity = 0;

  return nextVelocity;
}
