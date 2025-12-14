import { VehicleLoop } from "@/utils/vehicle/loopMaker";
import { VehicleArrayStore } from "@store/vehicle/arrayMode/vehicleStore";
import { Edge } from "@/types/edge";
import { vehicleDataArray, SensorData, VEHICLE_DATA_SIZE, MovementData, NextEdgeState } from "@/store/vehicle/arrayMode/vehicleDataArray";
import { PresetIndex } from "@/store/vehicle/arrayMode/sensorPresets";

interface TransitionResult {
  finalEdgeIndex: number;
  finalRatio: number;
  activeEdge: Edge | null; // 현재 위치한 엣지 객체 반환
}

export function handleEdgeTransition(
  vehicleIndex: number,
  initialEdgeIndex: number,
  initialRatio: number,
  edgeArray: Edge[],
  store: VehicleArrayStore
): TransitionResult {
  
  let currentEdgeIdx = initialEdgeIndex;
  let currentRatio = initialRatio;
  let currentEdge = edgeArray[currentEdgeIdx];

  // Access Data
  const data = vehicleDataArray.getData();
  const ptr = vehicleIndex * VEHICLE_DATA_SIZE;

  // 엣지 끝을 넘어섰는지 확인 (while loop) - 단, NEXT_EDGE는 1개만 준비되므로 1회만 수행됨 (사실상)
  while (currentEdge && currentRatio >= 1) {
    const overflowDist = (currentRatio - 1) * currentEdge.distance;
    
    // [TransferMgr Integration]
    // Check if NEXT_EDGE is ready
    const nextState = data[ptr + MovementData.NEXT_EDGE_STATE];
    const nextEdgeIndex = data[ptr + MovementData.NEXT_EDGE];

    if (nextState !== NextEdgeState.READY || nextEdgeIndex === -1) {
      // Not ready to transition -> Stop at end
      currentRatio = 1;
      break;
    }

    // Valid Transition
    const nextEdge = edgeArray[nextEdgeIndex];
    if (!nextEdge) {
        currentRatio = 1;
        break;
    }

    // Store 업데이트 (차량 위치 이동)
    store.moveVehicleToEdge(vehicleIndex, nextEdgeIndex, overflowDist / nextEdge.distance);

    // Update sensor preset based on new edge type
    updateSensorPresetForEdge(vehicleIndex, nextEdge);

    // Consume Next Edge
    data[ptr + MovementData.NEXT_EDGE_STATE] = NextEdgeState.EMPTY;
    data[ptr + MovementData.NEXT_EDGE] = -1;

    currentEdgeIdx = nextEdgeIndex;
    currentEdge = nextEdge;
    currentRatio = overflowDist / nextEdge.distance;
  }

  return {
    finalEdgeIndex: currentEdgeIdx,
    finalRatio: currentRatio,
    activeEdge: currentEdge || null
  };
}

/**
 * Update sensor preset based on edge type
 */
function updateSensorPresetForEdge(vehicleIndex: number, edge: Edge): void {
  const data = vehicleDataArray.getData();
  const ptr = vehicleIndex * VEHICLE_DATA_SIZE;

  let presetIdx: number = PresetIndex.STRAIGHT;

  if (edge.vos_rail_type !== "LINEAR") {
    // Curve edge - determine left or right based on edge name or properties
    // For now, default to left curve (you can add more logic here)
    presetIdx = PresetIndex.CURVE_LEFT as number;
  }

  data[ptr + SensorData.PRESET_IDX] = presetIdx;
}

// Helper functions removed as logic moved to TransferMgr
