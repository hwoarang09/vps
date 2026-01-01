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
 */
export function handleEdgeTransition(
  vehicleDataArray: IVehicleDataArray,
  store: IEdgeTransitionStore,
  vehicleIndex: number,
  initialEdgeIndex: number,
  initialRatio: number,
  edgeArray: Edge[],
  target: EdgeTransitionResult
): void {
  let currentEdgeIdx = initialEdgeIndex;
  let currentRatio = initialRatio;
  let currentEdge = edgeArray[currentEdgeIdx];

  const data = vehicleDataArray.getData();
  const ptr = vehicleIndex * VEHICLE_DATA_SIZE;

  while (currentEdge && currentRatio >= 1) {
    const overflowDist = (currentRatio - 1) * currentEdge.distance;

    const nextState = data[ptr + MovementData.NEXT_EDGE_STATE];
    const nextEdgeIndex = data[ptr + MovementData.NEXT_EDGE];

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

    updateSensorPresetForEdge(vehicleDataArray, vehicleIndex, nextEdge);

    data[ptr + LogicData.TRAFFIC_STATE] = TrafficState.FREE;
    const currentReason = data[ptr + LogicData.STOP_REASON];
    if ((currentReason & StopReason.LOCKED) !== 0) {
      data[ptr + LogicData.STOP_REASON] = currentReason & ~StopReason.LOCKED;
    }

    data[ptr + MovementData.NEXT_EDGE_STATE] = NextEdgeState.EMPTY;
    data[ptr + MovementData.NEXT_EDGE] = -1;

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
  } else if (railType === "LEFT_CURVE" || (isCurve && edge.curve_direction === "left")) {
    presetIdx = PresetIndex.CURVE_LEFT;
  } else if (railType === "RIGHT_CURVE" || (isCurve && edge.curve_direction === "right")) {
    presetIdx = PresetIndex.CURVE_RIGHT;
  } else if (isCurve) {
    // Other curve types without explicit direction - default to STRAIGHT
    presetIdx = PresetIndex.STRAIGHT;
  } else {
    presetIdx = PresetIndex.STRAIGHT;
  }

  data[ptr + SensorData.PRESET_IDX] = presetIdx;
}
