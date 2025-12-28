// shmSimulator/movementLogic/speedCalculator.ts
// Re-export shared implementation with SimulationConfig adapter

import type { Edge } from "@/types/edge";
import type { SimulationConfig } from "../types";
import {
  calculateNextSpeed as sharedCalculateNextSpeed,
  type SpeedConfig
} from "@/shared/vehicle/physics/speedCalculator";

/**
 * Adapter function for shmSimulator
 * Converts SimulationConfig to SpeedConfig and delegates to shared implementation
 */
export function calculateNextSpeed(
  currentVelocity: number,
  acceleration: number,
  deceleration: number,
  edge: Edge,
  delta: number,
  config: SimulationConfig
): number {
  // Adapt SimulationConfig to SpeedConfig
  const speedConfig: SpeedConfig = {
    linearMaxSpeed: config.linearMaxSpeed,
    curveMaxSpeed: config.curveMaxSpeed,
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
