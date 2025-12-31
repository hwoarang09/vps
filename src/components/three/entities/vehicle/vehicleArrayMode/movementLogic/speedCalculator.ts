// vehicleArrayMode/movementLogic/speedCalculator.ts
// Re-export shared implementation with movementConfig adapter

import type { Edge } from "@/types/edge";
import { getLinearMaxSpeed, getCurveMaxSpeed } from "@/config/movementConfig";
import {
  calculateNextSpeed as sharedCalculateNextSpeed,
  type SpeedConfig,
} from "@/common/vehicle/physics/speedCalculator";

/**
 * Adapter function for vehicleArrayMode
 * Uses movementConfig for speed limits and delegates to shared implementation
 */
export function calculateNextSpeed(
  currentVelocity: number,
  acceleration: number,
  deceleration: number,
  edge: Edge,
  delta: number
): number {
  const speedConfig: SpeedConfig = {
    linearMaxSpeed: getLinearMaxSpeed(),
    curveMaxSpeed: getCurveMaxSpeed(),
  };

  return sharedCalculateNextSpeed(
    currentVelocity,
    acceleration,
    deceleration,
    edge,
    delta,
    speedConfig
  );
}
