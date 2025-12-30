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
import type { TransferMgr, VehicleLoop, TransferMode } from "@/common/vehicle/logic/TransferMgr";
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
    let velocity = data[ptr + MovementData.VELOCITY];
    const acceleration = data[ptr + MovementData.ACCELERATION];
    const deceleration = data[ptr + MovementData.DECELERATION];
    const edgeRatio = data[ptr + MovementData.EDGE_RATIO];

    const hitZone = calculateHitZone(data, ptr, deceleration);

    let finalX = data[ptr + MovementData.X];
    let finalY = data[ptr + MovementData.Y];
    let finalZ = data[ptr + MovementData.Z];
    let finalRotation = data[ptr + MovementData.ROTATION];

    const currentEdge = edgeArray[currentEdgeIndex];
    if (!currentEdge) continue;

    calculateAppliedAccelAndDecel(
      acceleration,
      deceleration,
      currentEdge,
      hitZone,
      velocity,
      config.curveMaxSpeed,
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

    const rawNewRatio = edgeRatio + (newVelocity * clampedDelta) / currentEdge.distance;

    checkAndTriggerTransfer(transferMgr, data, ptr, i, rawNewRatio);

    handleEdgeTransition(
      vehicleDataArray,
      store,
      i,
      currentEdgeIndex,
      rawNewRatio,
      edgeArray,
      SCRATCH_TRANSITION
    );
    let finalEdgeIndex = SCRATCH_TRANSITION.finalEdgeIndex;
    let finalRatio = SCRATCH_TRANSITION.finalRatio;
    const activeEdge = SCRATCH_TRANSITION.activeEdge;

    checkAndReleaseMergeLock(lockMgr, finalEdgeIndex, currentEdgeIndex, currentEdge, i);

    if (activeEdge) {
      interpolatePositionTo(activeEdge, finalRatio, SCRATCH_POS, config.vehicleZOffset);
      finalX = SCRATCH_POS.x;
      finalY = SCRATCH_POS.y;
      finalZ = SCRATCH_POS.z;
      finalRotation = SCRATCH_POS.rotation;
    }

    const finalEdge = edgeArray[finalEdgeIndex];

    const shouldWait = processMergeLogicInline(
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
  let currentReason = data[ptr + LogicData.STOP_REASON];

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
  currentVelocity: number,
  curveMaxSpeed: number,
  curveAcceleration: number,
  target: typeof SCRATCH_ACCEL
) {
  let appliedAccel = acceleration;
  let appliedDecel = 0;

  if (currentEdge.vos_rail_type !== EdgeType.LINEAR) {
    if (currentVelocity >= curveMaxSpeed) {
      appliedAccel = 0;
    } else {
      appliedAccel = curveAcceleration;
    }
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
