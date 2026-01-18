// common/vehicle/movement/edgeTransition.ts
// Shared edge transition logic for vehicleArrayMode and shmSimulator

import type { Edge } from "@/types/edge";
import { EdgeType } from "@/types";
import {
  VEHICLE_DATA_SIZE,
  MovementData,
  NextEdgeState,
  LogicData,
  TrafficState,
  StopReason,
  SensorData,
  PresetIndex,
} from "@/common/vehicle/initialize/constants";

// Interface for vehicle data array
export interface IVehicleDataArray {
  getData(): Float32Array;
}

// Interface for store (only needs moveVehicleToEdge)
export interface IEdgeTransitionStore {
  moveVehicleToEdge(vehicleIndex: number, nextEdgeIndex: number, ratio: number): void;
}

export interface EdgeTransitionResult {
  finalEdgeIndex: number;
  finalRatio: number;
  activeEdge: Edge | null;
}

/**
 * Zero-GC: Handles edge transition, writes result to target object.
 * @param preserveTargetRatio - If true, don't set TARGET_RATIO=1 (for MQTT mode). 
 *        NOTE: This flag is somewhat legacy now that we support nextTargetRatio, but kept for compatibility.
 * @param nextTargetRatio - The target ratio to set for the new edge (optional).
 */
export interface EdgeTransitionParams {
  vehicleDataArray: IVehicleDataArray;
  store: IEdgeTransitionStore;
  vehicleIndex: number;
  initialEdgeIndex: number;
  initialRatio: number;
  edgeArray: Edge[];
  target: EdgeTransitionResult;
  preserveTargetRatio?: boolean;
  nextTargetRatio?: number;
}

/**
 * Zero-GC: Handles edge transition, writes result to target object.
 * @param params - The input parameters for edge transition logic
 */
export function handleEdgeTransition(params: EdgeTransitionParams): void {
  const {
    vehicleDataArray,
    store,
    vehicleIndex,
    initialEdgeIndex,
    initialRatio,
    edgeArray,
    target,
    preserveTargetRatio = false,
    nextTargetRatio
  } = params;
  let currentEdgeIdx = initialEdgeIndex;
  let currentRatio = initialRatio;
  let currentEdge = edgeArray[currentEdgeIdx];

  const data = vehicleDataArray.getData();
  const ptr = vehicleIndex * VEHICLE_DATA_SIZE;

  while (currentEdge && currentRatio >= 1) {
    const overflowDist = (currentRatio - 1) * currentEdge.distance;

    const nextState = data[ptr + MovementData.NEXT_EDGE_STATE];
    const nextEdgeIndex = data[ptr + MovementData.NEXT_EDGE];
    const trafficState = data[ptr + LogicData.TRAFFIC_STATE];

    // WAITING 상태면 edge transition 불가 (lock 대기 중)
    if (trafficState === TrafficState.WAITING) {
      currentRatio = 1;
      break;
    }

    if (nextState !== NextEdgeState.READY || nextEdgeIndex === -1) {
      currentRatio = 1;
      break;
    }

    const nextEdge = edgeArray[nextEdgeIndex];
    if (!nextEdge) {
      currentRatio = 1;
      break;
    }

    store.moveVehicleToEdge(vehicleIndex, nextEdgeIndex, overflowDist / nextEdge.distance);

    // DEBUG: Edge 전환 로그
    const prevVel = data[ptr + MovementData.VELOCITY];
    console.log(`[DEBUG] Edge 전환: veh=${vehicleIndex}, ${currentEdge.edge_name}(${currentEdge.vos_rail_type}) -> ${nextEdge.edge_name}(${nextEdge.vos_rail_type}), vel=${prevVel.toFixed(2)}m/s`);

    updateSensorPresetForEdge(vehicleDataArray, vehicleIndex, nextEdge);

    data[ptr + LogicData.TRAFFIC_STATE] = TrafficState.FREE;
    const currentReason = data[ptr + LogicData.STOP_REASON];
    if ((currentReason & StopReason.LOCKED) !== 0) {
      data[ptr + LogicData.STOP_REASON] = currentReason & ~StopReason.LOCKED;
    }

    data[ptr + MovementData.NEXT_EDGE_STATE] = NextEdgeState.EMPTY;
    data[ptr + MovementData.NEXT_EDGE] = -1;
    
    // Set TARGET_RATIO for the new edge
    if (nextTargetRatio !== undefined) {
      // If explicit next target ratio is provided (from TransferMgr reservation)
      data[ptr + MovementData.TARGET_RATIO] = nextTargetRatio;
    } else if (!preserveTargetRatio) {
      // Default behavior: Set to 1.0 (full traversal)
      data[ptr + MovementData.TARGET_RATIO] = 1; 
    }
    // If preserveTargetRatio is true AND nextTargetRatio is undefined, 
    // we leave TARGET_RATIO as is (legacy behavior, though logically it might be 1.0 from previous frame)

    currentEdgeIdx = nextEdgeIndex;
    currentEdge = nextEdge;
    currentRatio = overflowDist / nextEdge.distance;
  }

  target.finalEdgeIndex = currentEdgeIdx;
  target.finalRatio = currentRatio;
  target.activeEdge = currentEdge || null;
}

function updateSensorPresetForEdge(
  vehicleDataArray: IVehicleDataArray,
  vehicleIndex: number,
  edge: Edge
): void {
  const data = vehicleDataArray.getData();
  const ptr = vehicleIndex * VEHICLE_DATA_SIZE;

  let presetIdx: number;
  const railType = edge.vos_rail_type;

  const isCurve = railType?.includes("CURVE") || railType?.startsWith("C");

  if (railType === EdgeType.CURVE_180) {
    presetIdx = PresetIndex.U_TURN;
  } else if (railType === EdgeType.LEFT_CURVE || (isCurve && edge.curve_direction === "left")) {
    presetIdx = PresetIndex.CURVE_LEFT;
  } else if (railType === EdgeType.RIGHT_CURVE || (isCurve && edge.curve_direction === "right")) {
    presetIdx = PresetIndex.CURVE_RIGHT;
  } else if (isCurve) {
    // Other curve types without explicit direction - default to STRAIGHT
    presetIdx = PresetIndex.STRAIGHT;
  } else {
    presetIdx = PresetIndex.STRAIGHT;
  }

  data[ptr + SensorData.PRESET_IDX] = presetIdx;
}
