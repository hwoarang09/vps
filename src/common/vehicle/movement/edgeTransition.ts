// common/vehicle/movement/edgeTransition.ts
// Shared edge transition logic for vehicleArrayMode and shmSimulator

import type { Edge } from "@/types/edge";
import { EdgeType } from "@/types";
import { devLog } from "@/logger";
import {
  VEHICLE_DATA_SIZE,
  MovementData,
  NextEdgeState,
  LogicData,
  TrafficState,
  StopReason,
  SensorData,
  PresetIndex,
  NEXT_EDGE_COUNT,
} from "@/common/vehicle/initialize/constants";
import { MAX_PATH_LENGTH, PATH_LEN, PATH_EDGES_START } from "@/common/vehicle/logic/TransferMgr";

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
  /** Path buffer for refilling next edges after shift (optional) */
  pathBufferFromAutoMgr?: Int32Array | null;
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
    nextTargetRatio,
    pathBufferFromAutoMgr
  } = params;
  let currentEdgeIdx = initialEdgeIndex;
  let currentRatio = initialRatio;
  let currentEdge = edgeArray[currentEdgeIdx];

  const data = vehicleDataArray.getData();
  const ptr = vehicleIndex * VEHICLE_DATA_SIZE;

  // 진입 시점 상태 로그
  const initialNextEdges = [
    data[ptr + MovementData.NEXT_EDGE_0],
    data[ptr + MovementData.NEXT_EDGE_1],
    data[ptr + MovementData.NEXT_EDGE_2],
    data[ptr + MovementData.NEXT_EDGE_3],
    data[ptr + MovementData.NEXT_EDGE_4],
  ];
  let pathLen = -1;
  if (pathBufferFromAutoMgr) {
    const pathPtr = vehicleIndex * MAX_PATH_LENGTH;
    pathLen = pathBufferFromAutoMgr[pathPtr + PATH_LEN];
  }
  devLog.veh(vehicleIndex).debug(
    `[next_edge_memory] ENTER handleEdgeTransition edge=${currentEdge?.edge_name} ratio=${currentRatio.toFixed(3)} ` +
    `nextEdges=[${initialNextEdges.join(',')}] pathBuf: len=${pathLen}`
  );

  let loopCount = 0;
  while (currentEdge && currentRatio >= 1) {
    loopCount++;
    const overflowDist = (currentRatio - 1) * currentEdge.distance;

    const nextState = data[ptr + MovementData.NEXT_EDGE_STATE];
    const nextEdgeIndex = data[ptr + MovementData.NEXT_EDGE_0];
    const trafficState = data[ptr + LogicData.TRAFFIC_STATE];

    // 루프 진입 로그
    devLog.veh(vehicleIndex).debug(
      `[next_edge_memory] LOOP#${loopCount} currentEdge=${currentEdge.edge_name} ratio=${currentRatio.toFixed(3)} ` +
      `nextEdgeIdx=${nextEdgeIndex} nextState=${nextState}`
    );

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

    // [UnusualMove] Edge 전환 시 연결 여부 검증
    if (currentEdge.to_node !== nextEdge.from_node) {
      const prevX = data[ptr + MovementData.X];
      const prevY = data[ptr + MovementData.Y];
      devLog.veh(vehicleIndex).error(
        `[UnusualMove] 연결되지 않은 edge로 이동! ` +
        `prevEdge=${currentEdge.edge_name}(to:${currentEdge.to_node}) → nextEdge=${nextEdge.edge_name}(from:${nextEdge.from_node}), ` +
        `pos: (${prevX.toFixed(2)},${prevY.toFixed(2)})`
      );
    }

    store.moveVehicleToEdge(vehicleIndex, nextEdgeIndex, overflowDist / nextEdge.distance);

    updateSensorPresetForEdge(vehicleDataArray, vehicleIndex, nextEdge);

    data[ptr + LogicData.TRAFFIC_STATE] = TrafficState.FREE;
    const currentReason = data[ptr + LogicData.STOP_REASON];
    if ((currentReason & StopReason.LOCKED) !== 0) {
      data[ptr + LogicData.STOP_REASON] = currentReason & ~StopReason.LOCKED;
    }

    // Next Edge 배열을 한 칸씩 앞으로 당기고 마지막 슬롯 채우기
    shiftAndRefillNextEdges(data, ptr, vehicleIndex, pathBufferFromAutoMgr, edgeArray);

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

/**
 * pathBuffer와 nextEdges를 동시에 shift하고, NEXT_EDGE_4를 pathBuffer에서 채움
 * Edge transition 성공 시에만 호출 (NEXT_EDGE_0 사용 후)
 */
function shiftAndRefillNextEdges(
  data: Float32Array,
  ptr: number,
  vehicleIndex: number,
  pathBufferFromAutoMgr: Int32Array | null | undefined,
  edgeArray: Edge[]
): void {
  // 이전 상태 기록
  const beforeNextEdges = [
    data[ptr + MovementData.NEXT_EDGE_0],
    data[ptr + MovementData.NEXT_EDGE_1],
    data[ptr + MovementData.NEXT_EDGE_2],
    data[ptr + MovementData.NEXT_EDGE_3],
    data[ptr + MovementData.NEXT_EDGE_4],
  ];

  let beforePathLen = -1;
  let afterPathLen = -1;
  let beforePathEdges: number[] = [];
  let afterPathEdges: number[] = [];

  // 1. pathBuffer shift (맨 앞 edge 제거)
  if (pathBufferFromAutoMgr) {
    const pathPtr = vehicleIndex * MAX_PATH_LENGTH;
    beforePathLen = pathBufferFromAutoMgr[pathPtr + PATH_LEN];

    if (beforePathLen > 0) {
      // shift 전 상태 기록
      for (let i = 0; i < Math.min(beforePathLen, 10); i++) {
        beforePathEdges.push(pathBufferFromAutoMgr[pathPtr + PATH_EDGES_START + i]);
      }

      // 실제 shift: 모든 edge를 한 칸 앞으로
      for (let i = 0; i < beforePathLen - 1; i++) {
        pathBufferFromAutoMgr[pathPtr + PATH_EDGES_START + i] =
          pathBufferFromAutoMgr[pathPtr + PATH_EDGES_START + i + 1];
      }
      // 길이 감소
      pathBufferFromAutoMgr[pathPtr + PATH_LEN] = beforePathLen - 1;
      afterPathLen = beforePathLen - 1;

      // shift 후 상태 기록
      for (let i = 0; i < Math.min(afterPathLen, 10); i++) {
        afterPathEdges.push(pathBufferFromAutoMgr[pathPtr + PATH_EDGES_START + i]);
      }
    } else {
      afterPathLen = 0;
    }
  }

  // 2. nextEdges shift: 0 <- 1, 1 <- 2, 2 <- 3, 3 <- 4
  data[ptr + MovementData.NEXT_EDGE_0] = data[ptr + MovementData.NEXT_EDGE_1];
  data[ptr + MovementData.NEXT_EDGE_1] = data[ptr + MovementData.NEXT_EDGE_2];
  data[ptr + MovementData.NEXT_EDGE_2] = data[ptr + MovementData.NEXT_EDGE_3];
  data[ptr + MovementData.NEXT_EDGE_3] = data[ptr + MovementData.NEXT_EDGE_4];

  // 3. NEXT_EDGE_4를 pathBuffer[4]에서 채우기 (shift 후 기준)
  let newLastEdge = -1;
  if (pathBufferFromAutoMgr && afterPathLen > 0) {
    const pathPtr = vehicleIndex * MAX_PATH_LENGTH;
    const pathOffset = NEXT_EDGE_COUNT - 1; // = 4
    if (pathOffset < afterPathLen) {
      const candidateEdgeIdx = pathBufferFromAutoMgr[pathPtr + PATH_EDGES_START + pathOffset];
      if (candidateEdgeIdx >= 0 && candidateEdgeIdx < edgeArray.length) {
        newLastEdge = candidateEdgeIdx;
      }
    }
  }
  data[ptr + MovementData.NEXT_EDGE_4] = newLastEdge;

  // 로그: shift 결과
  const afterNextEdges = [
    data[ptr + MovementData.NEXT_EDGE_0],
    data[ptr + MovementData.NEXT_EDGE_1],
    data[ptr + MovementData.NEXT_EDGE_2],
    data[ptr + MovementData.NEXT_EDGE_3],
    data[ptr + MovementData.NEXT_EDGE_4],
  ];
  devLog.veh(vehicleIndex).debug(
    `[SHIFT] pathBuf: [${beforePathEdges.join(',')}](len=${beforePathLen}) → [${afterPathEdges.join(',')}](len=${afterPathLen}) | ` +
    `nextEdges: [${beforeNextEdges.join(',')}] → [${afterNextEdges.join(',')}]`
  );

  // NEXT_EDGE_0이 비어있으면 STATE도 EMPTY로
  if (data[ptr + MovementData.NEXT_EDGE_0] === -1) {
    data[ptr + MovementData.NEXT_EDGE_STATE] = NextEdgeState.EMPTY;
  }
}
