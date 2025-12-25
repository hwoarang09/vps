import { VehicleArrayStore } from "@store/vehicle/arrayMode/vehicleStore";
import { Edge } from "@/types/edge";
import { vehicleDataArray, SensorData, VEHICLE_DATA_SIZE, MovementData, NextEdgeState, LogicData, TrafficState, StopReason } from "@/store/vehicle/arrayMode/vehicleDataArray";
import { PresetIndex } from "@/store/vehicle/arrayMode/sensorPresets";

// Zero-GC: Reusable result type (exported for use in movementUpdate)
export interface EdgeTransitionResult {
  finalEdgeIndex: number;
  finalRatio: number;
  activeEdge: Edge | null;
}

/**
 * Zero-GC: Handles edge transition, writes result to target object.
 */
export function handleEdgeTransition(
  vehicleIndex: number,
  initialEdgeIndex: number,
  initialRatio: number,
  edgeArray: Edge[],
  store: VehicleArrayStore,
  target: EdgeTransitionResult
): void {
  let currentEdgeIdx = initialEdgeIndex;
  let currentRatio = initialRatio;
  let currentEdge = edgeArray[currentEdgeIdx];

  // Access Data
  const data = vehicleDataArray.getData();
  const ptr = vehicleIndex * VEHICLE_DATA_SIZE;

  // 엣지 끝을 넘어섰는지 확인
  while (currentEdge && currentRatio >= 1) {
    const overflowDist = (currentRatio - 1) * currentEdge.distance;

    // Check if NEXT_EDGE is ready
    const nextState = data[ptr + MovementData.NEXT_EDGE_STATE];
    const nextEdgeIndex = data[ptr + MovementData.NEXT_EDGE];

    if (nextState !== NextEdgeState.READY || nextEdgeIndex === -1) {
      currentRatio = 1;
      break;
    }

    // Valid Transition
    const nextEdge = edgeArray[nextEdgeIndex];
    if (!nextEdge) {
      currentRatio = 1;
      break;
    }

    // Store 업데이트
    store.moveVehicleToEdge(vehicleIndex, nextEdgeIndex, overflowDist / nextEdge.distance);

    // Update sensor preset
    updateSensorPresetForEdge(vehicleIndex, nextEdge);

    // Reset Traffic State for new edge
    data[ptr + LogicData.TRAFFIC_STATE] = TrafficState.FREE;
    const currentReason = data[ptr + LogicData.STOP_REASON];
    if ((currentReason & StopReason.LOCKED) !== 0) {
      data[ptr + LogicData.STOP_REASON] = currentReason & ~StopReason.LOCKED;
    }

    // Consume Next Edge
    data[ptr + MovementData.NEXT_EDGE_STATE] = NextEdgeState.EMPTY;
    data[ptr + MovementData.NEXT_EDGE] = -1;

    currentEdgeIdx = nextEdgeIndex;
    currentEdge = nextEdge;
    currentRatio = overflowDist / nextEdge.distance;
  }

  // Write to target (Zero-GC)
  target.finalEdgeIndex = currentEdgeIdx;
  target.finalRatio = currentRatio;
  target.activeEdge = currentEdge || null;
}

// Helper function to update sensor preset
function updateSensorPresetForEdge(vehicleIndex: number, edge: Edge): void {
  const data = vehicleDataArray.getData();
  const ptr = vehicleIndex * VEHICLE_DATA_SIZE;

  let presetIdx: number;

  if (edge.vos_rail_type === "C180") {
    // 180도 턴
    presetIdx = 3; 
  } else if (edge.vos_rail_type?.startsWith("C")) { // C90 or other curves
    if (edge.curve_direction === "left") {
      presetIdx = PresetIndex.CURVE_LEFT; // 1
    } else if (edge.curve_direction === "right") {
      presetIdx = PresetIndex.CURVE_RIGHT; // 2
    } else {
      // Default to straight or keep previous if unsure? 
      // User request implies straight is 0. Let's default to Straight if direction is missing.
      presetIdx = PresetIndex.STRAIGHT; 
    }
  } else {
    // Straight or others
    presetIdx = PresetIndex.STRAIGHT; // 0
  }

  data[ptr + SensorData.PRESET_IDX] = presetIdx;
}

// Helper functions removed as logic moved to TransferMgr
