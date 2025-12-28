// shmSimulator/types.ts
// Shared types for the SHM Simulator

import type { Edge } from "@/types/edge";
import type { Node } from "@/types";

// ============================================================================
// [1] SIMULATION CONFIG
// ============================================================================

export interface SimulationConfig {
  // Vehicle dimensions
  maxVehicles: number;
  bodyLength: number;
  bodyWidth: number;
  bodyHeight: number;
  sensorLength: number;
  sensorWidth: number;
  vehicleZOffset: number;

  // Movement parameters
  linearMaxSpeed: number;
  linearAcceleration: number;
  linearDeceleration: number;
  curveMaxSpeed: number;
  curveAcceleration: number;
  approachMinSpeed: number;
  brakeMinSpeed: number;

  // Spacing
  edgeMargin: number;
  vehicleSpacing: number;
  crossEdgeSafeDistance: number;

  // Simulation
  targetFps: number;
}

export interface VehicleInitConfig {
  acceleration: number;
  deceleration: number;
  maxSpeed: number;
}

// Default config factory
export function createDefaultConfig(): SimulationConfig {
  return {
    maxVehicles: 200000,
    bodyLength: 1.2,
    bodyWidth: 0.6,
    bodyHeight: 0.3,
    sensorLength: 0.6,
    sensorWidth: 0.5,
    vehicleZOffset: 3.8,
    linearMaxSpeed: 5.0,
    linearAcceleration: 3.0,
    linearDeceleration: 5.0,
    curveMaxSpeed: 1.0,
    curveAcceleration: 0.0,
    approachMinSpeed: 2.0,
    brakeMinSpeed: 1.0,
    edgeMargin: 0.5,
    vehicleSpacing: 0.6,
    crossEdgeSafeDistance: 1.0,
    targetFps: 60,
  };
}

// ============================================================================
// [2] INIT PAYLOAD (Main -> Worker)
// ============================================================================

export interface InitPayload {
  sharedBuffer: SharedArrayBuffer;
  sensorPointBuffer: SharedArrayBuffer;
  edges: Edge[];
  nodes: Node[];
  config: SimulationConfig;
  vehicleConfigs: VehicleInitConfig[];
  numVehicles: number;
  transferMode: TransferMode;
}

// ============================================================================
// [3] WORKER MESSAGES
// ============================================================================

// Main Thread -> Worker Messages
export type WorkerMessage =
  | { type: "INIT"; payload: InitPayload }
  | { type: "START" }
  | { type: "STOP" }
  | { type: "PAUSE" }
  | { type: "RESUME" }
  | { type: "DISPOSE" }
  | { type: "SET_TRANSFER_MODE"; mode: TransferMode };

// Worker -> Main Thread Messages
export type MainMessage =
  | { type: "READY" }
  | { type: "INITIALIZED"; actualNumVehicles: number }
  | { type: "ERROR"; error: string }
  | { type: "STATS"; fps: number; vehicleCount: number }
  | { type: "PERF_STATS"; avgStepMs: number };

// ============================================================================
// [4] TRANSFER MODE
// ============================================================================

export const TransferMode = {
  LOOP: 0,
  RANDOM: 1,
} as const;

export type TransferMode = (typeof TransferMode)[keyof typeof TransferMode];

// ============================================================================
// [5] RE-EXPORTS
// ============================================================================

export type { Edge, Node };
