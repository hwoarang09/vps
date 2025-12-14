import { VEHICLE_DATA_SIZE, MovementData, SensorData, MovingStatus, NextEdgeState } from "@/store/vehicle/arrayMode/vehicleDataArray";
import { enqueueVehicleTransfer, processTransferQueue } from "../logic/TransferMgr";

import { VehicleArrayStore } from "@/store/vehicle/arrayMode/vehicleStore";
import { VehicleLoop } from "@/utils/vehicle/loopMaker";
import { Edge } from "@/types/edge";

// Logic modules
import { calculateNextSpeed } from "./speedCalculator";
import { handleEdgeTransition } from "./edgeTransition";
import { interpolatePosition } from "./positionInterpolator";
import { updateSensorPoints } from "../helpers/sensorPoints";
import { logSensorSummary } from "../helpers/sensorDebug";
import { getCurveAcceleration } from "@/config/movementConfig";

interface MovementUpdateParams {
  data: Float32Array;
  edgeArray: Edge[];
  actualNumVehicles: number;
  vehicleLoopMap: Map<number, VehicleLoop>;
  edgeNameToIndex: Map<string, number>;
  store: VehicleArrayStore;
  clampedDelta: number;
}

// Debug flag
let frameCount = 0;
const DEBUG_INTERVAL = 300; // Log every 300 frames (~5 seconds at 60fps)

/**
 * Update vehicle movement and positions
 * Optimized for Zero-Allocation: Directly accesses Float32Array without creating temporary objects.
 */
export function updateMovement(params: MovementUpdateParams) {
  const {
    data,
    edgeArray,
    actualNumVehicles,
    vehicleLoopMap,
    edgeNameToIndex,
    store,
    clampedDelta,
  } = params;

  frameCount++;

  // Process Transfer Queue
  processTransferQueue(edgeArray, vehicleLoopMap, edgeNameToIndex, store.transferMode);

  for (let i = 0; i < actualNumVehicles; i++) {
    const ptr = i * VEHICLE_DATA_SIZE;

    // 1. Status Check (Early Return)
    if (shouldSkipUpdate(data, ptr)) {
      continue;
    }

    // 2. Data Read (Direct Access)
    // Extracted to helper for readability (Note: this creates a small object allocation)
    let {
      currentEdgeIndex,
      velocity,
      acceleration,
      deceleration,
      edgeRatio,
      hitZone,
      finalX,
      finalY,
      finalZ,
      finalRotation
    } = readVehicleState(data, ptr);

    // Safety check
    const currentEdge = edgeArray[currentEdgeIndex];
    if (!currentEdge) continue;

    // 3. Calculate Speed (accel OR decel, based on hitZone)
    const { appliedAccel, appliedDecel } = calculateAccDec(
       acceleration,
       deceleration,
       hitZone,
       currentEdge
    );

    // Hard stop for stop-zone contact
    if (hitZone === 2) {
      data[ptr + MovementData.VELOCITY] = 0;
      data[ptr + MovementData.DECELERATION] = 0;
      data[ptr + MovementData.MOVING_STATUS] = MovingStatus.STOPPED;
      continue;
    }

    const newVelocity = calculateNextSpeed(
      velocity,
      appliedAccel,
      appliedDecel,
      currentEdge,
      clampedDelta
    );

    // 4. Calculate New Ratio
    const rawNewRatio = edgeRatio + (newVelocity * clampedDelta) / currentEdge.distance;

    // --- Transfer Request Trigger ---
    const nextEdgeState = data[ptr + MovementData.NEXT_EDGE_STATE];
    // Request trigger condition: ratio >= 0.5 and STATE is EMPTY
    if (rawNewRatio >= 0.5 && nextEdgeState === NextEdgeState.EMPTY) {
      data[ptr + MovementData.NEXT_EDGE_STATE] = NextEdgeState.PENDING;
      enqueueVehicleTransfer(i);
    }
    // --------------------------------

    // 5. Handle Edge Transition
    // Note: handleEdgeTransition still returns a temporary object. 
    // This is the next optimization target if GC is still high.
    const { finalEdgeIndex, finalRatio, activeEdge } = handleEdgeTransition(
      i,
      currentEdgeIndex,
      rawNewRatio,
      edgeArray,
      store
    );

    // 6. Interpolate Position
    if (activeEdge) {
      const posResult = interpolatePosition(activeEdge, finalRatio);
      finalX = posResult.x;
      finalY = posResult.y;
      finalZ = posResult.z;
      finalRotation = posResult.rotation;
    }

    // 7. Write Back (Direct Write)
    data[ptr + MovementData.VELOCITY] = newVelocity;
    data[ptr + MovementData.EDGE_RATIO] = finalRatio;
    data[ptr + MovementData.CURRENT_EDGE] = finalEdgeIndex;

    data[ptr + MovementData.X] = finalX;
    data[ptr + MovementData.Y] = finalY;
    data[ptr + MovementData.Z] = finalZ;
    data[ptr + MovementData.ROTATION] = finalRotation;

    // 8. Update Sensor Points (Zero-GC)
    const presetIdx = Math.trunc(data[ptr + SensorData.PRESET_IDX]); // float -> int
    updateSensorPoints(i, finalX, finalY, finalRotation, presetIdx);
  }

  // Debug log every N frames
  if (frameCount % DEBUG_INTERVAL === 0) {
    logSensorSummary(actualNumVehicles);
  }
}

/**
 * Checks vehicle status for early exit conditions.
 * Returns true if the update should be skipped.
 */
function shouldSkipUpdate(data: Float32Array, ptr: number): boolean {
  const status = data[ptr + MovementData.MOVING_STATUS];

  // Skip if paused (preserve state - freeze)
  if (status === MovingStatus.PAUSED) {
    return true;
  }

  // Skip if stopped (reset state - hard stop)
  if (status === MovingStatus.STOPPED) {
    data[ptr + MovementData.VELOCITY] = 0;
    return true;
  }

  // Double check: if explicit MOVING state is missing (safety)
  if (status !== MovingStatus.MOVING) {
    data[ptr + MovementData.VELOCITY] = 0;
    return true;
  }

  return false;
}

/**
 * Determines the applied acceleration and deceleration based on edge type and sensor hit status.
 */
function calculateAccDec(
  baseAccel: number,
  baseDecel: number,
  hitZone: number,
  currentEdge: Edge
): { appliedAccel: number; appliedDecel: number } {
  let appliedAccel = baseAccel;
  let appliedDecel = 0;

  // Override acceleration for curves if not braking
  if (currentEdge.vos_rail_type !== "LINEAR") {
    appliedAccel = getCurveAcceleration();
  }

  if (hitZone >= 0) {
    appliedAccel = 0;
    appliedDecel = baseDecel;
  }

  return { appliedAccel, appliedDecel };
}

/**
 * Reads vehicle state from Float32Array into a structured object.
 * Note: Creates a temporary object, but improves readability vs inline access.
 */
function readVehicleState(data: Float32Array, ptr: number) {
  const currentEdgeIndex = data[ptr + MovementData.CURRENT_EDGE];
  const velocity = data[ptr + MovementData.VELOCITY];
  const acceleration = data[ptr + MovementData.ACCELERATION];
  const deceleration = data[ptr + MovementData.DECELERATION];
  const edgeRatio = data[ptr + MovementData.EDGE_RATIO];

  const rawHit = Math.trunc(data[ptr + SensorData.HIT_ZONE]);
  let hitZone = -1;
  if (rawHit === 2) {
    hitZone = 2;
  } else if (deceleration !== 0) {
    hitZone = rawHit;
  }

  const finalX = data[ptr + MovementData.X];
  const finalY = data[ptr + MovementData.Y];
  const finalZ = data[ptr + MovementData.Z];
  const finalRotation = data[ptr + MovementData.ROTATION];

  return {
    currentEdgeIndex,
    velocity,
    acceleration,
    deceleration,
    edgeRatio,
    hitZone,
    finalX,
    finalY,
    finalZ,
    finalRotation
  };
}
