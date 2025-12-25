import { VEHICLE_DATA_SIZE, MovementData, SensorData, MovingStatus, NextEdgeState, LogicData, StopReason, TrafficState } from "@/store/vehicle/arrayMode/vehicleDataArray";
import { enqueueVehicleTransfer, processTransferQueue } from "../logic/TransferMgr";
import { getLockMgr } from "../logic/LockMgr";

import { VehicleArrayStore } from "@/store/vehicle/arrayMode/vehicleStore";
import { VehicleLoop } from "@/utils/vehicle/loopMaker";
import { Edge } from "@/types/edge";

// Logic modules
import { calculateNextSpeed } from "./speedCalculator";
import { handleEdgeTransition, EdgeTransitionResult } from "./edgeTransition";
import { interpolatePositionTo, PositionResult } from "./positionInterpolator";
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

// ============================================================================
// Zero-GC Scratchpads (모듈 레벨에서 한 번만 할당)
// ============================================================================
const SCRATCH_TRANSITION: EdgeTransitionResult = {
  finalEdgeIndex: 0,
  finalRatio: 0,
  activeEdge: null,
};

const SCRATCH_POS: PositionResult = {
  x: 0,
  y: 0,
  z: 0,
  rotation: 0,
};

const SCRATCH_MERGE_POS: PositionResult = {
  x: 0,
  y: 0,
  z: 0,
  rotation: 0,
};

/**
 * Update vehicle movement and positions
 * Zero-GC Optimized: 루프 내 객체 생성 완전 제거
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

    // 2. Data Read (Zero-GC: 직접 로컬 변수로 읽기)
    const currentEdgeIndex = data[ptr + MovementData.CURRENT_EDGE];
    let velocity = data[ptr + MovementData.VELOCITY];
    const acceleration = data[ptr + MovementData.ACCELERATION];
    const deceleration = data[ptr + MovementData.DECELERATION];
    const edgeRatio = data[ptr + MovementData.EDGE_RATIO];

    // hitZone 계산 (인라인)
    const rawHit = Math.trunc(data[ptr + SensorData.HIT_ZONE]);
    let hitZone = -1;
    if (rawHit === 2) {
      hitZone = 2;
    } else if (deceleration !== 0) {
      hitZone = rawHit;
    }

    let finalX = data[ptr + MovementData.X];
    let finalY = data[ptr + MovementData.Y];
    let finalZ = data[ptr + MovementData.Z];
    let finalRotation = data[ptr + MovementData.ROTATION];

    // Safety check
    const currentEdge = edgeArray[currentEdgeIndex];

    // 3. Calculate Speed (Zero-GC: 인라인 처리)
    let appliedAccel = acceleration;
    let appliedDecel = 0;

    // Override acceleration for curves if not braking
    if (currentEdge.vos_rail_type !== "LINEAR") {
      appliedAccel = getCurveAcceleration();
    }

    if (hitZone >= 0) {
      appliedAccel = 0;
      appliedDecel = deceleration;
    }

    // Hard stop for stop-zone contact (Sensor Stop)
    if (hitZone === 2) {
      data[ptr + MovementData.VELOCITY] = 0;
      data[ptr + MovementData.DECELERATION] = 0;

      // Update Reason: SENSORED
      const currentReason = data[ptr + LogicData.STOP_REASON];
      data[ptr + LogicData.STOP_REASON] = currentReason | StopReason.SENSORED;
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

    // 5. Handle Edge Transition (Zero-GC: target 객체에 결과 쓰기)
    handleEdgeTransition(
      i,
      currentEdgeIndex,
      rawNewRatio,
      edgeArray,
      store,
      SCRATCH_TRANSITION
    );
    let finalEdgeIndex = SCRATCH_TRANSITION.finalEdgeIndex;
    let finalRatio = SCRATCH_TRANSITION.finalRatio;
    const activeEdge = SCRATCH_TRANSITION.activeEdge;

    // --- Lock Release Logic ---
    checkAndReleaseMergeLock(finalEdgeIndex, currentEdgeIndex, currentEdge, i);
    // --------------------------

    // 6. Interpolate Position (Zero-GC: target 객체에 결과 쓰기)
    if (activeEdge) {
      interpolatePositionTo(activeEdge, finalRatio, SCRATCH_POS);
      finalX = SCRATCH_POS.x;
      finalY = SCRATCH_POS.y;
      finalZ = SCRATCH_POS.z;
      finalRotation = SCRATCH_POS.rotation;
    }

    // 7. LockMgr Wait Logic (Merge Point Control)
    const finalEdge = edgeArray[finalEdgeIndex];

    const shouldWait = processMergeLogicInline(
      getLockMgr(),
      finalEdge,
      i,
      finalRatio,
      activeEdge,
      data,
      ptr,
      SCRATCH_MERGE_POS
    );

    if (shouldWait) {
      // newRatio is stored in SCRATCH_MERGE_POS.x
      finalRatio = SCRATCH_MERGE_POS.x;
      if (activeEdge) {
        interpolatePositionTo(activeEdge, finalRatio, SCRATCH_POS);
        finalX = SCRATCH_POS.x;
        finalY = SCRATCH_POS.y;
        finalZ = SCRATCH_POS.z;
        finalRotation = SCRATCH_POS.rotation;
      }
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

/**
 * Zero-GC: Process Merge and Traffic Logic (inline version)
 * Returns true if should wait, and writes newRatio to target.x
 */
function processMergeLogicInline(
  lockMgr: ReturnType<typeof getLockMgr>,
  currentEdge: Edge,
  vehId: number,
  currentRatio: number,
  activeEdge: Edge | null | undefined,
  data: Float32Array,
  ptr: number,
  target: PositionResult
): boolean {
  // If NOT a merge node, maintain FREE state and clear LOCKED reason
  if (!lockMgr.isMergeNode(currentEdge.to_node)) {
    const currentReason = data[ptr + LogicData.STOP_REASON];
    if ((currentReason & StopReason.LOCKED) !== 0) {
      data[ptr + LogicData.STOP_REASON] = currentReason & ~StopReason.LOCKED;
    }
    data[ptr + LogicData.TRAFFIC_STATE] = TrafficState.FREE;
    return false;
  }

  // If IS a merge node, check grant

  // 1. Register Request (Idempotent)
  const currentTrafficState = data[ptr + LogicData.TRAFFIC_STATE];
  if (currentTrafficState === TrafficState.FREE) {
    lockMgr.requestLock(currentEdge.to_node, currentEdge.edge_name, vehId);
  }

  // 2. Check Grant
  const isGranted = lockMgr.checkGrant(currentEdge.to_node, vehId);
  let currentReason = data[ptr + LogicData.STOP_REASON];

  if (isGranted) {
    // Granted -> ACQUIRED, Clear LOCKED bit if set
    if ((currentReason & StopReason.LOCKED) !== 0) {
      data[ptr + LogicData.STOP_REASON] = currentReason & ~StopReason.LOCKED;
    }
    data[ptr + LogicData.TRAFFIC_STATE] = TrafficState.ACQUIRED;
    return false;
  }

  // Not Granted -> WAITING
  data[ptr + LogicData.TRAFFIC_STATE] = TrafficState.WAITING;

  const waitDist = lockMgr.getWaitDistance(currentEdge);
  const currentDist = currentRatio * currentEdge.distance;

  if (currentDist >= waitDist) {
    // Reached Wait Point -> Stop & Set LOCKED Reason
    data[ptr + LogicData.STOP_REASON] = currentReason | StopReason.LOCKED;

    // Force wait at waitDist - store newRatio in target.x
    target.x = waitDist / currentEdge.distance;
    return true;
  }

  if ((currentReason & StopReason.LOCKED) !== 0) {
    // Not yet at wait point -> Clear LOCKED Reason
    data[ptr + LogicData.STOP_REASON] = currentReason & ~StopReason.LOCKED;
  }

  return false;
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

