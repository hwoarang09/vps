import { VEHICLE_DATA_SIZE, MovementData, SensorData, MovingStatus, NextEdgeState, LogicData, StopReason, TrafficState } from "@/store/vehicle/arrayMode/vehicleDataArray";
import { enqueueVehicleTransfer, processTransferQueue } from "../logic/TransferMgr";
import { getLockMgr } from "../logic/LockMgr";

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

    // 3. Calculate Speed (accel OR decel, based on hitZone)
    const { appliedAccel, appliedDecel } = calculateAccDec(
       acceleration,
       deceleration,
       hitZone,
       currentEdge
    );

    // Hard stop for stop-zone contact (Sensor Stop)
    if (hitZone === 2) {
      data[ptr + MovementData.VELOCITY] = 0;
      data[ptr + MovementData.DECELERATION] = 0;
      // Do NOT set STOPPED status, otherwise we can't resume when obstacle clears.
      // Keeps status as MOVING (but velocity 0) or whatever it was.
      
      // Update Reason: SENSORED
      const currentReason = data[ptr + LogicData.STOP_REASON];
      data[ptr + LogicData.STOP_REASON] = currentReason | StopReason.SENSORED;
      // TrafficState: Unchanged (Free), but stopped.
      continue;
    } else {
      // Clear SENSORED bit if moving or not hitZone 2
      const currentReason = data[ptr + LogicData.STOP_REASON];
      if ((currentReason & StopReason.SENSORED) !== 0) {
          data[ptr + LogicData.STOP_REASON] = currentReason & ~StopReason.SENSORED;
      }
    }

    let newVelocity = calculateNextSpeed(
      velocity,
      appliedAccel,
      appliedDecel,
      currentEdge,
      clampedDelta
    );

    // 4. Calculate New Ratio
    const rawNewRatio = edgeRatio + (newVelocity * clampedDelta) / currentEdge.distance;

    // --- Transfer Request Trigger ---
    checkAndTriggerTransfer(data, ptr, i, rawNewRatio);
    // --------------------------------

    // 5. Handle Edge Transition
    // Note: handleEdgeTransition still returns a temporary object. 
    // This is the next optimization target if GC is still high.
    const transitionResult = handleEdgeTransition(
      i,
      currentEdgeIndex,
      rawNewRatio,
      edgeArray,
      store
    );
    // Destructure properties from the result object so they can be reassigned
    let { finalEdgeIndex, finalRatio, activeEdge } = transitionResult;

    // --- Lock Release Logic ---
    checkAndReleaseMergeLock(finalEdgeIndex, currentEdgeIndex, currentEdge, i);
    // --------------------------

    // 6. Interpolate Position
    if (activeEdge) {
      const posResult = interpolatePosition(activeEdge, finalRatio);
      finalX = posResult.x;
      finalY = posResult.y;
      finalZ = posResult.z;
      finalRotation = posResult.rotation;
    }

    // 7. LockMgr Wait Logic (Merge Point Control)
    // CRITICAL FIX: Use the NEW edge (finalEdgeIndex) for logic, not the old 'currentEdge'
    const finalEdge = edgeArray[finalEdgeIndex];
    
    const mergeResult = processMergeLogic(
      getLockMgr(),
      finalEdge,
      i,
      finalRatio,
      activeEdge,
      data,
      ptr
    );

    if (mergeResult.shouldWait) {
       finalRatio = mergeResult.newRatio;
       finalX = mergeResult.newX;
       finalY = mergeResult.newY;
       finalZ = mergeResult.newZ;
       finalRotation = mergeResult.newRotation;
       newVelocity = 0;
    }

    // 8. Write Back (Direct Write)
    data[ptr + MovementData.VELOCITY] = newVelocity;
    data[ptr + MovementData.EDGE_RATIO] = finalRatio;
    data[ptr + MovementData.CURRENT_EDGE] = finalEdgeIndex;

    data[ptr + MovementData.X] = finalX;
    data[ptr + MovementData.Y] = finalY;
    data[ptr + MovementData.Z] = finalZ;
    data[ptr + MovementData.ROTATION] = finalRotation;

    // 9. Update Sensor Points (Zero-GC)
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

/**
 * Helper: Check transfer request condition
 */
function checkAndTriggerTransfer(
  data: Float32Array,
  ptr: number,
  vehIdx: number,
  ratio: number
) {
  const nextEdgeState = data[ptr + MovementData.NEXT_EDGE_STATE];
  // Changed from 0.5 to 0.0 to determine next edge immediately upon entry as requested
  if (ratio >= 0 && nextEdgeState === NextEdgeState.EMPTY) {
    data[ptr + MovementData.NEXT_EDGE_STATE] = NextEdgeState.PENDING;
    enqueueVehicleTransfer(vehIdx);
  }
}

// Helper types for wait logic result
interface WaitLogicResult {
  shouldWait: boolean;
  newRatio: number;
  newX: number;
  newY: number;
  newZ: number;
  newRotation: number;
}

/**
 * Helper: Process Merge and Traffic Logic (Section 7)
 * Checks intersection grants, applies wait logic, and updates TrafficState/StopReason.
 */
function processMergeLogic(
  lockMgr: ReturnType<typeof getLockMgr>,
  currentEdge: Edge,
  vehId: number,
  currentRatio: number,
  activeEdge: Edge | null | undefined,
  data: Float32Array,
  ptr: number
): WaitLogicResult {
  // If NOT a merge node, maintain FREE state and clear LOCKED reason
  if (!lockMgr.isMergeNode(currentEdge.to_node)) {
    const currentReason = data[ptr + LogicData.STOP_REASON];
    if ((currentReason & StopReason.LOCKED) !== 0) {
      data[ptr + LogicData.STOP_REASON] = currentReason & ~StopReason.LOCKED;
    }
    data[ptr + LogicData.TRAFFIC_STATE] = TrafficState.FREE;
    return { shouldWait: false, newRatio: 0, newX: 0, newY: 0, newZ: 0, newRotation: 0 };
  }

  // If IS a merge node, check grant
  
  // 1. Register Request (Idempotent)
  // Optimization: Only request if we are not already waiting or acquired (FREE)
  const currentTrafficState = data[ptr + LogicData.TRAFFIC_STATE];
  if (currentTrafficState === TrafficState.FREE) {
      lockMgr.requestLock(currentEdge.to_node, currentEdge.edge_name, vehId);
  }

  // 2. Check Grant
  const isGranted = lockMgr.checkGrant(currentEdge.to_node, vehId);
  // Update Logic Data
  let currentReason = data[ptr + LogicData.STOP_REASON];

  // Logic: 
  // 1. If ToNode is Merge -> TrafficState is WAITING by default (unless granted).
  // 2. If Granted -> TrafficState is ACQUIRED. Clear LOCKED reason.
  // 3. If Not Granted -> TrafficState is WAITING.
  //    - If reached wait point -> Stop. Set LOCKED reason.
  //    - If not reached -> Moving. Clear LOCKED reason.

  if (isGranted) {
     // Granted -> ACQUIRED
     // Clear LOCKED bit if set
     if ((currentReason & StopReason.LOCKED) !== 0) {
        data[ptr + LogicData.STOP_REASON] = currentReason & ~StopReason.LOCKED;
     }
     data[ptr + LogicData.TRAFFIC_STATE] = TrafficState.ACQUIRED;
     
     return { shouldWait: false, newRatio: 0, newX: 0, newY: 0, newZ: 0, newRotation: 0 };
  }

  // Not Granted -> WAITING
  data[ptr + LogicData.TRAFFIC_STATE] = TrafficState.WAITING;

  const waitDist = lockMgr.getWaitDistance(currentEdge);
  const currentDist = currentRatio * currentEdge.distance;

  if (currentDist >= waitDist) {
      // Reached Wait Point -> Stop & Set LOCKED Reason
      data[ptr + LogicData.STOP_REASON] = currentReason | StopReason.LOCKED;

      // Force wait at waitDist
      const newRatio = waitDist / currentEdge.distance;
      
      let newX = 0, newY = 0, newZ = 0, newRotation = 0;

      if (activeEdge) {
         const posResult = interpolatePosition(activeEdge, newRatio);
         newX = posResult.x;
         newY = posResult.y;
         newZ = posResult.z;
         newRotation = posResult.rotation;
      }

      return {
        shouldWait: true,
        newRatio,
        newX,
        newY,
        newZ,
        newRotation
      };
  } else if ((currentReason & StopReason.LOCKED) !== 0) {
      // Not yet at wait point -> Clear LOCKED Reason (we are moving, just in WAITING state)
      
          data[ptr + LogicData.STOP_REASON] = currentReason & ~StopReason.LOCKED;
      }
  return { shouldWait: false, newRatio: 0, newX: 0, newY: 0, newZ: 0, newRotation: 0 };
}

/**
 * Checks if the vehicle has changed edges and releases the lock on the previous merge node if applicable.
 */
function checkAndReleaseMergeLock(
  finalEdgeIndex: number,
  currentEdgeIndex: number,
  currentEdge: Edge,
  vehId: number
) {
    // If we changed edges, check if we left a merge node lock
    if (finalEdgeIndex !== currentEdgeIndex) {
        // The vehicle has left 'currentEdge'.
        // If 'currentEdge.to_node' was a merge node, we must release it.
        // Note: We released it effectively by passing the node.
        const prevToNode = currentEdge.to_node;
        if (getLockMgr().isMergeNode(prevToNode)) {
            console.log(`[LockMgr ${prevToNode} VEH${vehId}] RELEASE (Movement: Left ${currentEdge.edge_name})`);
            getLockMgr().releaseLock(prevToNode, vehId);
        }
    }
}

