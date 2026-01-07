// common/vehicle/movement/movementUpdate.ts

import type { Edge } from "@/types/edge";
import { EdgeType } from "@/types";
import {
  VEHICLE_DATA_SIZE,
  MovementData,
  SensorData,
  MovingStatus,
  NextEdgeState,
  LogicData,
  StopReason,
  TrafficState,
} from "@/common/vehicle/initialize/constants";
import { calculateNextSpeed, type SpeedConfig } from "@/common/vehicle/physics/speedCalculator";
import { handleEdgeTransition, type EdgeTransitionResult, type IEdgeTransitionStore } from "./edgeTransition";
import { interpolatePositionTo, type PositionResult } from "./positionInterpolator";
import { updateSensorPoints, type SensorPointsConfig } from "@/common/vehicle/helpers/sensorPoints";
import type { LockMgr } from "@/common/vehicle/logic/LockMgr";
import type { TransferMgr, VehicleLoop } from "@/common/vehicle/logic/TransferMgr";
import { TransferMode } from "@/shmSimulator/types";
import type { ISensorPointArray } from "@/common/vehicle/collision/sensorCollision";

export interface IVehicleDataArray {
  getData(): Float32Array;
}

export interface MovementConfig extends SpeedConfig, SensorPointsConfig {
  vehicleZOffset: number;
  curveMaxSpeed: number;
  curveAcceleration: number;
}

export interface MovementUpdateContext {
  vehicleDataArray: IVehicleDataArray;
  sensorPointArray: ISensorPointArray;
  edgeArray: Edge[];
  actualNumVehicles: number;
  vehicleLoopMap: Map<number, VehicleLoop>;
  edgeNameToIndex: Map<string, number>;
  store: IEdgeTransitionStore & { transferMode: TransferMode };
  lockMgr: LockMgr;
  transferMgr: TransferMgr;
  clampedDelta: number;
  config: MovementConfig;
}

// Zero-GC Scratchpads
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

const SCRATCH_ACCEL = {
  accel: 0,
  decel: 0,
};

const SCRATCH_TARGET_CHECK = {
  finalRatio: 0,
  finalVelocity: 0,
  reached: false,
};

export function updateMovement(ctx: MovementUpdateContext) {
  const {
    vehicleDataArray,
    sensorPointArray,
    edgeArray,
    actualNumVehicles,
    vehicleLoopMap,
    edgeNameToIndex,
    store,
    lockMgr,
    transferMgr,
    clampedDelta,
    config,
  } = ctx;

  const data = vehicleDataArray.getData();

  transferMgr.processTransferQueue(
    vehicleDataArray,
    edgeArray,
    vehicleLoopMap,
    edgeNameToIndex,
    store.transferMode
  );

  for (let i = 0; i < actualNumVehicles; i++) {
    const ptr = i * VEHICLE_DATA_SIZE;

    if (shouldSkipUpdate(data, ptr)) {
      continue;
    }

    const currentEdgeIndex = data[ptr + MovementData.CURRENT_EDGE];
    const velocity = data[ptr + MovementData.VELOCITY];
    const acceleration = data[ptr + MovementData.ACCELERATION];
    const deceleration = data[ptr + MovementData.DECELERATION];
    const edgeRatio = data[ptr + MovementData.EDGE_RATIO];

    let finalX = data[ptr + MovementData.X];
    let finalY = data[ptr + MovementData.Y];
    let finalZ = data[ptr + MovementData.Z];
    let finalRotation = data[ptr + MovementData.ROTATION];

    const currentEdge = edgeArray[currentEdgeIndex];
    const hitZone = calculateHitZone(data, ptr, deceleration);
    calculateAppliedAccelAndDecel(
      acceleration,
      deceleration,
      currentEdge,
      hitZone,
      config.curveAcceleration,
      SCRATCH_ACCEL
    );
    const appliedAccel = SCRATCH_ACCEL.accel;
    const appliedDecel = SCRATCH_ACCEL.decel;

    if (checkAndProcessSensorStop(hitZone, data, ptr)) {
      continue;
    }

    let newVelocity = calculateNextSpeed(
      velocity,
      appliedAccel,
      appliedDecel,
      currentEdge,
      clampedDelta,
      config
    );

    const targetRatio = clampTargetRatio(data[ptr + MovementData.TARGET_RATIO]);

    let rawNewRatio = edgeRatio + (newVelocity * clampedDelta) / currentEdge.distance;

    checkAndTriggerTransfer(transferMgr, data, ptr, i, rawNewRatio);

    processEdgeTransitionLogic(
      ctx,
      i,
      currentEdgeIndex,
      currentEdge,
      rawNewRatio,
      targetRatio,
      SCRATCH_TRANSITION
    );
    
    const finalEdgeIndex = SCRATCH_TRANSITION.finalEdgeIndex;
    let finalRatio = SCRATCH_TRANSITION.finalRatio;
    const activeEdge = SCRATCH_TRANSITION.activeEdge;

    // Logic to handle velocity and stopping:
    // If we transitioned to a new edge, we maintain velocity (momentum).
    // If we stayed on the same edge, we must check if we hit the target limit.
    if (finalEdgeIndex !== currentEdgeIndex) {
      // Transitioned: Keep newVelocity as is.
      // The finalRatio is already calculated correctly with overflow in handleEdgeTransition.
    } else {
      // Same edge: Check if we reached the target on this edge
      checkTargetReached(rawNewRatio, targetRatio, newVelocity, SCRATCH_TARGET_CHECK);
      finalRatio = SCRATCH_TARGET_CHECK.finalRatio;
      newVelocity = SCRATCH_TARGET_CHECK.finalVelocity;
      const reachedTarget = SCRATCH_TARGET_CHECK.reached;

      if (reachedTarget) {
        data[ptr + MovementData.MOVING_STATUS] = MovingStatus.STOPPED;
      }
    }

    checkAndReleaseMergeLock(lockMgr, finalEdgeIndex, currentEdgeIndex, currentEdge, i);

    if (activeEdge) {
      interpolatePositionTo(activeEdge, finalRatio, SCRATCH_POS, config.vehicleZOffset);
      finalX = SCRATCH_POS.x;
      finalY = SCRATCH_POS.y;
      finalZ = SCRATCH_POS.z;
      finalRotation = SCRATCH_POS.rotation;
    }

    const finalEdge = edgeArray[finalEdgeIndex];

    const shouldWait = checkAndProcessMergeWait(
      lockMgr,
      finalEdge,
      i,
      finalRatio,
      data,
      ptr,
      SCRATCH_MERGE_POS
    );

    if (shouldWait) {
      finalRatio = SCRATCH_MERGE_POS.x;
      // Position update is now handled via SCRATCH_MERGE_POS result if needed, 
      // but wait, we need to update finalX, etc.
      // Let's look at checkAndProcessMergeWait implementation below.
      // Actually, if shouldWait is true, SCRATCH_MERGE_POS.x has the new ratio (waitDist/dist).
      // We need to re-interpolate if we are waiting.
      
      if (activeEdge) {
        interpolatePositionTo(activeEdge, finalRatio, SCRATCH_POS, config.vehicleZOffset);
        finalX = SCRATCH_POS.x;
        finalY = SCRATCH_POS.y;
        finalZ = SCRATCH_POS.z;
        finalRotation = SCRATCH_POS.rotation;
      }
      newVelocity = 0;
    }

    data[ptr + MovementData.VELOCITY] = newVelocity;
    data[ptr + MovementData.EDGE_RATIO] = finalRatio;
    data[ptr + MovementData.CURRENT_EDGE] = finalEdgeIndex;

    data[ptr + MovementData.X] = finalX;
    data[ptr + MovementData.Y] = finalY;
    data[ptr + MovementData.Z] = finalZ;
    data[ptr + MovementData.ROTATION] = finalRotation;

    const presetIdx = Math.trunc(data[ptr + SensorData.PRESET_IDX]);
    updateSensorPoints(sensorPointArray, i, finalX, finalY, finalRotation, presetIdx, config);
  }
}

function shouldSkipUpdate(data: Float32Array, ptr: number): boolean {
  const status = data[ptr + MovementData.MOVING_STATUS];

  if (status === MovingStatus.PAUSED) {
    return true;
  }

  if (status === MovingStatus.STOPPED) {
    data[ptr + MovementData.VELOCITY] = 0;
    return true;
  }

  if (status !== MovingStatus.MOVING) {
    data[ptr + MovementData.VELOCITY] = 0;
    return true;
  }

  return false;
}

function checkAndTriggerTransfer(
  transferMgr: TransferMgr,
  data: Float32Array,
  ptr: number,
  vehIdx: number,
  ratio: number
) {
  const nextEdgeState = data[ptr + MovementData.NEXT_EDGE_STATE];
  if (ratio >= 0 && nextEdgeState === NextEdgeState.EMPTY) {
    data[ptr + MovementData.NEXT_EDGE_STATE] = NextEdgeState.PENDING;
    transferMgr.enqueueVehicleTransfer(vehIdx);
  }
}

function processEdgeTransitionLogic(
  ctx: MovementUpdateContext,
  vehicleIndex: number,
  currentEdgeIndex: number,
  currentEdge: Edge,
  rawNewRatio: number,
  targetRatio: number,
  out: EdgeTransitionResult
) {
  const data = ctx.vehicleDataArray.getData();
  const ptr = vehicleIndex * VEHICLE_DATA_SIZE;
  const nextEdgeState = data[ptr + MovementData.NEXT_EDGE_STATE];

  // Transition conditions:
  // 1. Reached end (rawNewRatio >= 1) AND targetRatio === 1 (normal case)
  // 2. Reached end (rawNewRatio >= 1) AND NEXT_EDGE is ready (MQTT command with nextEdge)
  //    - This handles case where targetRatio < currentRatio but nextEdge is set
  const shouldTransition = rawNewRatio >= 1 && (targetRatio === 1 || nextEdgeState === NextEdgeState.READY);

  if (shouldTransition) {
    // In MQTT_CONTROL mode, preserve TARGET_RATIO (don't overwrite with 1)
    const preserveTargetRatio = ctx.store.transferMode === TransferMode.MQTT_CONTROL;
    
    // Check if there's a reserved target ratio for the next edge (fixes premature target application bug)
    const nextTargetRatio = ctx.transferMgr.consumeNextEdgeReservation(vehicleIndex);
    
    handleEdgeTransition({
      vehicleDataArray: ctx.vehicleDataArray,
      store: ctx.store,
      vehicleIndex: vehicleIndex,
      initialEdgeIndex: currentEdgeIndex,
      initialRatio: rawNewRatio,
      edgeArray: ctx.edgeArray,
      target: out,
      preserveTargetRatio: preserveTargetRatio,
      nextTargetRatio: nextTargetRatio
    });
  } else {
    // Just update position on current edge
    out.finalEdgeIndex = currentEdgeIndex;
    out.finalRatio = rawNewRatio;
    out.activeEdge = currentEdge;
  }
}

function processMergeLogicInline(
  lockMgr: LockMgr,
  currentEdge: Edge,
  vehId: number,
  currentRatio: number,
  data: Float32Array,
  ptr: number,
  target: PositionResult
): boolean {
  if (!lockMgr.isMergeNode(currentEdge.to_node)) {
    const currentReason = data[ptr + LogicData.STOP_REASON];
    if ((currentReason & StopReason.LOCKED) !== 0) {
      data[ptr + LogicData.STOP_REASON] = currentReason & ~StopReason.LOCKED;
    }
    data[ptr + LogicData.TRAFFIC_STATE] = TrafficState.FREE;
    return false;
  }

  const currentTrafficState = data[ptr + LogicData.TRAFFIC_STATE];
  if (currentTrafficState === TrafficState.FREE) {
    lockMgr.requestLock(currentEdge.to_node, currentEdge.edge_name, vehId);
  }

  const isGranted = lockMgr.checkGrant(currentEdge.to_node, vehId);
  const currentReason = data[ptr + LogicData.STOP_REASON];

  if (isGranted) {
    if ((currentReason & StopReason.LOCKED) !== 0) {
      data[ptr + LogicData.STOP_REASON] = currentReason & ~StopReason.LOCKED;
    }
    data[ptr + LogicData.TRAFFIC_STATE] = TrafficState.ACQUIRED;
    return false;
  }

  data[ptr + LogicData.TRAFFIC_STATE] = TrafficState.WAITING;

  const waitDist = lockMgr.getWaitDistance(currentEdge);
  const currentDist = currentRatio * currentEdge.distance;

  if (currentDist >= waitDist) {
    data[ptr + LogicData.STOP_REASON] = currentReason | StopReason.LOCKED;
    target.x = waitDist / currentEdge.distance;
    return true;
  }

  if ((currentReason & StopReason.LOCKED) !== 0) {
    data[ptr + LogicData.STOP_REASON] = currentReason & ~StopReason.LOCKED;
  }

  return false;
}

function checkAndProcessMergeWait(
  lockMgr: LockMgr,
  finalEdge: Edge,
  vehIdx: number,
  ratio: number,
  data: Float32Array,
  ptr: number,
  outPos: PositionResult
): boolean {
  const shouldWait = processMergeLogicInline(
    lockMgr,
    finalEdge,
    vehIdx,
    ratio,
    data,
    ptr,
    outPos
  );

  return shouldWait;
}

function checkAndReleaseMergeLock(
  lockMgr: LockMgr,
  finalEdgeIndex: number,
  currentEdgeIndex: number,
  currentEdge: Edge,
  vehId: number
) {
  if (finalEdgeIndex !== currentEdgeIndex) {
    const prevToNode = currentEdge.to_node;
    if (lockMgr.isMergeNode(prevToNode)) {
      lockMgr.releaseLock(prevToNode, vehId);
    }
  }
}

function calculateHitZone(
  data: Float32Array,
  ptr: number,
  deceleration: number
): number {
  const rawHit = Math.trunc(data[ptr + SensorData.HIT_ZONE]);
  let hitZone = -1;
  if (rawHit === 2) {
    hitZone = 2;
  } else if (deceleration !== 0) {
    hitZone = rawHit;
  }
  return hitZone;
}

function calculateAppliedAccelAndDecel(
  acceleration: number,
  deceleration: number,
  currentEdge: Edge,
  hitZone: number,
  curveAcceleration: number,
  target: typeof SCRATCH_ACCEL
) {
  let appliedAccel = acceleration;
  let appliedDecel = 0;

  // Override acceleration for curves
  if (currentEdge.vos_rail_type !== EdgeType.LINEAR) {
    appliedAccel = curveAcceleration;
  }

  if (hitZone >= 0) {
    appliedAccel = 0;
    appliedDecel = deceleration;
  }

  target.accel = appliedAccel;
  target.decel = appliedDecel;
}

function checkAndProcessSensorStop(
  hitZone: number,
  data: Float32Array,
  ptr: number
): boolean {
  if (hitZone === 2) {
    data[ptr + MovementData.VELOCITY] = 0;
    data[ptr + MovementData.DECELERATION] = 0;

    const currentReason = data[ptr + LogicData.STOP_REASON];
    data[ptr + LogicData.STOP_REASON] = currentReason | StopReason.SENSORED;
    return true;
  } else {
    const currentReason = data[ptr + LogicData.STOP_REASON];
    if ((currentReason & StopReason.SENSORED) !== 0) {
      data[ptr + LogicData.STOP_REASON] = currentReason & ~StopReason.SENSORED;
    }
    return false;
  }
}

function clampTargetRatio(ratio: number): number {
  if (ratio < 0) return 0;
  if (ratio > 1) return 1;
  return ratio;
}

function checkTargetReached(
  rawNewRatio: number,
  targetRatio: number,
  currentVelocity: number,
  out: typeof SCRATCH_TARGET_CHECK
) {
  if (rawNewRatio >= targetRatio) {
    out.finalRatio = targetRatio;
    out.finalVelocity = 0;
    out.reached = true;
  } else {
    out.finalRatio = rawNewRatio;
    out.finalVelocity = currentVelocity;
    out.reached = false;
  }
}


