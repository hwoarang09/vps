// common/vehicle/movement/edgeTransition.ts
// 단순화: 락 체크 로직 제거

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

// Interface for lock manager (stub - 새 락 시스템 구현 시 교체)
export interface IEdgeTransitionLockMgr {
  isMergeNode(nodeName: string): boolean;
  checkGrant(nodeName: string, vehId: number): boolean;
  requestLock(nodeName: string, edgeName: string, vehId: number): void;
}

export interface EdgeTransitionResult {
  finalEdgeIndex: number;
  finalRatio: number;
  activeEdge: Edge | null;
}

/** UnusualMove 이벤트 데이터 */
export interface UnusualMoveEvent {
  vehicleIndex: number;
  prevEdgeName: string;
  prevEdgeToNode: string;
  nextEdgeName: string;
  nextEdgeFromNode: string;
  posX: number;
  posY: number;
}

/** UnusualMove 콜백 타입 */
export type OnUnusualMoveCallback = (event: UnusualMoveEvent) => void;

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
  pathBufferFromAutoMgr?: Int32Array | null;
  lockMgr?: IEdgeTransitionLockMgr;
  onUnusualMove?: OnUnusualMoveCallback;
}

/**
 * 다음 Edge로 전환 가능한지 체크
 * 단순화: 락 체크 제거, nextEdge 존재 여부만 확인
 */
function checkCanTransitionToNextEdge(
  nextEdgeIndex: number,
  nextState: number,
  edgeArray: Edge[]
): { canTransition: boolean; nextEdge: Edge | null } {
  // NOTE: nextEdgeIndex is 1-based. 0 is invalid sentinel.
  if (nextState !== NextEdgeState.READY || nextEdgeIndex === 0) {
    return { canTransition: false, nextEdge: null };
  }

  const nextEdge = edgeArray[nextEdgeIndex - 1];
  if (!nextEdge) {
    return { canTransition: false, nextEdge: null };
  }

  return { canTransition: true, nextEdge };
}

/**
 * UnusualMove 감지 및 콜백 호출
 */
function checkAndReportUnusualMove(
  currentEdge: Edge,
  nextEdge: Edge,
  vehicleIndex: number,
  data: Float32Array,
  ptr: number,
  onUnusualMove?: OnUnusualMoveCallback
): void {
  if (currentEdge.to_node === nextEdge.from_node) return;

  const prevX = data[ptr + MovementData.X];
  const prevY = data[ptr + MovementData.Y];
  devLog.veh(vehicleIndex).error(
    `[UnusualMove] 연결되지 않은 edge로 이동! ` +
    `prevEdge=${currentEdge.edge_name}(to:${currentEdge.to_node}) → nextEdge=${nextEdge.edge_name}(from:${nextEdge.from_node}), ` +
    `pos: (${prevX.toFixed(2)},${prevY.toFixed(2)})`
  );

  onUnusualMove?.({
    vehicleIndex,
    prevEdgeName: currentEdge.edge_name,
    prevEdgeToNode: currentEdge.to_node,
    nextEdgeName: nextEdge.edge_name,
    nextEdgeFromNode: nextEdge.from_node,
    posX: prevX,
    posY: prevY,
  });
}

/**
 * 진입 시점 상태 로그 출력
 */
function logTransitionEntry(
  vehicleIndex: number,
  currentEdge: Edge | undefined,
  currentRatio: number,
  data: Float32Array,
  ptr: number,
  pathBufferFromAutoMgr?: Int32Array | null
): void {
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
}

/**
 * Zero-GC: Handles edge transition, writes result to target object.
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
    pathBufferFromAutoMgr,
    onUnusualMove
  } = params;
  let currentEdgeIdx = initialEdgeIndex;
  let currentRatio = initialRatio;
  // NOTE: currentEdgeIdx is 1-based. 0 is invalid sentinel.
  let currentEdge = currentEdgeIdx >= 1 ? edgeArray[currentEdgeIdx - 1] : undefined;

  const data = vehicleDataArray.getData();
  const ptr = vehicleIndex * VEHICLE_DATA_SIZE;

  logTransitionEntry(vehicleIndex, currentEdge, currentRatio, data, ptr, pathBufferFromAutoMgr);

  let loopCount = 0;
  while (currentEdge && currentRatio >= 1) {
    loopCount++;
    const overflowDist = (currentRatio - 1) * currentEdge.distance;

    const nextState = data[ptr + MovementData.NEXT_EDGE_STATE];
    const nextEdgeIndex = data[ptr + MovementData.NEXT_EDGE_0];

    // 루프 진입 로그
    devLog.veh(vehicleIndex).debug(
      `[next_edge_memory] LOOP#${loopCount} currentEdge=${currentEdge.edge_name} ratio=${currentRatio.toFixed(3)} ` +
      `nextEdgeIdx=${nextEdgeIndex} nextState=${nextState}`
    );

    // Edge transition 가능 여부 체크 (단순화: 락 체크 제거)
    const { canTransition, nextEdge } = checkCanTransitionToNextEdge(
      nextEdgeIndex, nextState, edgeArray
    );
    if (!canTransition || !nextEdge) {
      currentRatio = 1;
      break;
    }

    // [UnusualMove] Edge 전환 시 연결 여부 검증
    checkAndReportUnusualMove(currentEdge, nextEdge, vehicleIndex, data, ptr, onUnusualMove);

    store.moveVehicleToEdge(vehicleIndex, nextEdgeIndex, overflowDist / nextEdge.distance);

    updateSensorPresetForEdge(vehicleDataArray, vehicleIndex, nextEdge);

    data[ptr + LogicData.TRAFFIC_STATE] = TrafficState.FREE;
    data[ptr + LogicData.STOP_REASON] &= ~StopReason.LOCKED;

    // Next Edge 배열 shift (단순화: 락 체크 제거)
    shiftAndRefillNextEdges(data, ptr, vehicleIndex, pathBufferFromAutoMgr, edgeArray);

    // Set TARGET_RATIO for the new edge
    const newTargetRatio = nextTargetRatio ?? (preserveTargetRatio ? undefined : 1);
    if (newTargetRatio !== undefined) {
      data[ptr + MovementData.TARGET_RATIO] = newTargetRatio;
    }

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
    presetIdx = PresetIndex.STRAIGHT;
  } else {
    presetIdx = PresetIndex.STRAIGHT;
  }

  data[ptr + SensorData.PRESET_IDX] = presetIdx;
}

/** PathBuffer shift 결과 */
interface PathBufferShiftResult {
  beforeLen: number;
  afterLen: number;
  beforeEdges: number[];
  afterEdges: number[];
}

/** PathBuffer shift 수행 */
function shiftPathBuffer(
  pathBuffer: Int32Array,
  vehicleIndex: number
): PathBufferShiftResult {
  const pathPtr = vehicleIndex * MAX_PATH_LENGTH;
  const beforeLen = pathBuffer[pathPtr + PATH_LEN];
  const beforeEdges: number[] = [];
  const afterEdges: number[] = [];

  if (beforeLen <= 0) {
    return { beforeLen, afterLen: 0, beforeEdges, afterEdges };
  }

  for (let i = 0; i < Math.min(beforeLen, 10); i++) {
    beforeEdges.push(pathBuffer[pathPtr + PATH_EDGES_START + i]);
  }

  for (let i = 0; i < beforeLen - 1; i++) {
    pathBuffer[pathPtr + PATH_EDGES_START + i] = pathBuffer[pathPtr + PATH_EDGES_START + i + 1];
  }
  pathBuffer[pathPtr + PATH_LEN] = beforeLen - 1;
  const afterLen = beforeLen - 1;

  for (let i = 0; i < Math.min(afterLen, 10); i++) {
    afterEdges.push(pathBuffer[pathPtr + PATH_EDGES_START + i]);
  }

  return { beforeLen, afterLen, beforeEdges, afterEdges };
}

/**
 * pathBuffer와 nextEdges를 동시에 shift
 * 단순화: 락 체크 제거
 */
function shiftAndRefillNextEdges(
  data: Float32Array,
  ptr: number,
  vehicleIndex: number,
  pathBufferFromAutoMgr: Int32Array | null | undefined,
  _edgeArray: Edge[]
): void {
  const beforeNextEdges = [
    data[ptr + MovementData.NEXT_EDGE_0],
    data[ptr + MovementData.NEXT_EDGE_1],
    data[ptr + MovementData.NEXT_EDGE_2],
    data[ptr + MovementData.NEXT_EDGE_3],
    data[ptr + MovementData.NEXT_EDGE_4],
  ];

  // 1. pathBuffer shift
  let shiftResult: PathBufferShiftResult = { beforeLen: -1, afterLen: -1, beforeEdges: [], afterEdges: [] };
  if (pathBufferFromAutoMgr) {
    shiftResult = shiftPathBuffer(pathBufferFromAutoMgr, vehicleIndex);
  }

  // 2. pathBuffer에서 NEXT_EDGE_0~4 다시 채우기 (락 체크 없이 단순 채움)
  const nextEdgeOffsets = [
    MovementData.NEXT_EDGE_0,
    MovementData.NEXT_EDGE_1,
    MovementData.NEXT_EDGE_2,
    MovementData.NEXT_EDGE_3,
    MovementData.NEXT_EDGE_4,
  ];

  if (pathBufferFromAutoMgr && shiftResult.afterLen > 0) {
    const pathPtr = vehicleIndex * MAX_PATH_LENGTH;

    for (let i = 0; i < NEXT_EDGE_COUNT; i++) {
      if (i >= shiftResult.afterLen) {
        data[ptr + nextEdgeOffsets[i]] = 0;
        continue;
      }

      const edgeIdx = pathBufferFromAutoMgr[pathPtr + PATH_EDGES_START + i];
      data[ptr + nextEdgeOffsets[i]] = edgeIdx < 1 ? 0 : edgeIdx;
    }
  } else {
    for (let i = 0; i < NEXT_EDGE_COUNT; i++) {
      data[ptr + nextEdgeOffsets[i]] = 0;
    }
  }

  // 로그
  const afterNextEdges = [
    data[ptr + MovementData.NEXT_EDGE_0],
    data[ptr + MovementData.NEXT_EDGE_1],
    data[ptr + MovementData.NEXT_EDGE_2],
    data[ptr + MovementData.NEXT_EDGE_3],
    data[ptr + MovementData.NEXT_EDGE_4],
  ];
  devLog.veh(vehicleIndex).debug(
    `[SHIFT] pathBuf: [${shiftResult.beforeEdges.join(',')}](len=${shiftResult.beforeLen}) → [${shiftResult.afterEdges.join(',')}](len=${shiftResult.afterLen}) | ` +
    `nextEdges: [${beforeNextEdges.join(',')}] → [${afterNextEdges.join(',')}]`
  );

  // NEXT_EDGE_0이 비어있으면 STATE도 EMPTY로
  if (data[ptr + MovementData.NEXT_EDGE_0] === 0) {
    data[ptr + MovementData.NEXT_EDGE_STATE] = NextEdgeState.EMPTY;
  }
}
