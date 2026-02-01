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

// Interface for lock manager (only needed methods for edge transition)
export interface IEdgeTransitionLockMgr {
  isMergeNode(nodeName: string): boolean;
  checkGrant(nodeName: string, vehId: number): boolean;
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
  /** Path buffer for refilling next edges after shift (optional) */
  pathBufferFromAutoMgr?: Int32Array | null;
  /** Lock manager for checking per-node lock status (optional for backward compat) */
  lockMgr?: IEdgeTransitionLockMgr;
  /** UnusualMove 발생 시 콜백 (optional) */
  onUnusualMove?: OnUnusualMoveCallback;
}

/** Lock 상태 체크 결과 */
interface LockCheckResult {
  blocked: boolean;
}

/**
 * Lock 기반 전환 차단 여부 체크
 * @returns blocked=true면 전환 불가
 */
function checkLockBlocking(
  lockMgr: IEdgeTransitionLockMgr | undefined,
  currentEdge: Edge,
  nextEdgeIndex: number,
  edgeArray: Edge[],
  vehicleIndex: number,
  trafficState: number
): LockCheckResult {
  if (!lockMgr) {
    // 하위 호환: lockMgr 없으면 기존 WAITING 전역 체크
    return { blocked: trafficState === TrafficState.WAITING };
  }

  // 1. 현재 edge의 to_node가 merge node이고 lock이 없으면 block
  const isMergeNode = lockMgr.isMergeNode(currentEdge.to_node);
  const hasGrant = lockMgr.checkGrant(currentEdge.to_node, vehicleIndex);
  if (isMergeNode && !hasGrant) {
    devLog.veh(vehicleIndex).debug(
      `[EDGE_TRANSITION] blocked: to_node=${currentEdge.to_node} lock not granted`
    );
    return { blocked: true };
  }

  // 2. 다음 edge가 곡선이고 그 to_node가 merge node면 대기
  if (nextEdgeIndex >= 0 && nextEdgeIndex < edgeArray.length) {
    const nextEdge = edgeArray[nextEdgeIndex];
    const isCurve = nextEdge?.vos_rail_type !== EdgeType.LINEAR;
    const isNextMerge = lockMgr.isMergeNode(nextEdge.to_node);
    const hasNextGrant = lockMgr.checkGrant(nextEdge.to_node, vehicleIndex);
    if (isCurve && isNextMerge && !hasNextGrant) {
      const currentType = currentEdge.vos_rail_type === EdgeType.LINEAR ? 'linear' : 'curve';
      devLog.veh(vehicleIndex).debug(
        `[EDGE_TRANSITION] ${currentType}→curve→merge 대기: nextEdge=${nextEdge.edge_name}`
      );
      return { blocked: true };
    }
  }

  return { blocked: false };
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
    pathBufferFromAutoMgr,
    lockMgr,
    onUnusualMove
  } = params;
  let currentEdgeIdx = initialEdgeIndex;
  let currentRatio = initialRatio;
  let currentEdge = edgeArray[currentEdgeIdx];

  const data = vehicleDataArray.getData();
  const ptr = vehicleIndex * VEHICLE_DATA_SIZE;

  logTransitionEntry(vehicleIndex, currentEdge, currentRatio, data, ptr, pathBufferFromAutoMgr);

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

    // Edge transition 가능 여부 체크
    const lockCheck = checkLockBlocking(lockMgr, currentEdge, nextEdgeIndex, edgeArray, vehicleIndex, trafficState);
    if (lockCheck.blocked) {
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

      // 콜백 호출
      if (onUnusualMove) {
        onUnusualMove({
          vehicleIndex,
          prevEdgeName: currentEdge.edge_name,
          prevEdgeToNode: currentEdge.to_node,
          nextEdgeName: nextEdge.edge_name,
          nextEdgeFromNode: nextEdge.from_node,
          posX: prevX,
          posY: prevY,
        });
      }
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

  // shift 전 상태 기록
  for (let i = 0; i < Math.min(beforeLen, 10); i++) {
    beforeEdges.push(pathBuffer[pathPtr + PATH_EDGES_START + i]);
  }

  // 실제 shift
  for (let i = 0; i < beforeLen - 1; i++) {
    pathBuffer[pathPtr + PATH_EDGES_START + i] = pathBuffer[pathPtr + PATH_EDGES_START + i + 1];
  }
  pathBuffer[pathPtr + PATH_LEN] = beforeLen - 1;
  const afterLen = beforeLen - 1;

  // shift 후 상태 기록
  for (let i = 0; i < Math.min(afterLen, 10); i++) {
    afterEdges.push(pathBuffer[pathPtr + PATH_EDGES_START + i]);
  }

  return { beforeLen, afterLen, beforeEdges, afterEdges };
}

/** 새 NEXT_EDGE_4 값 결정 */
function getNewLastEdge(
  pathBuffer: Int32Array | null | undefined,
  vehicleIndex: number,
  afterPathLen: number,
  edgeArray: Edge[]
): number {
  if (!pathBuffer || afterPathLen <= 0) return -1;

  const pathPtr = vehicleIndex * MAX_PATH_LENGTH;
  const pathOffset = NEXT_EDGE_COUNT - 1; // = 4

  if (pathOffset >= afterPathLen) return -1;

  const candidateEdgeIdx = pathBuffer[pathPtr + PATH_EDGES_START + pathOffset];
  if (candidateEdgeIdx >= 0 && candidateEdgeIdx < edgeArray.length) {
    return candidateEdgeIdx;
  }

  return -1;
}

/**
 * pathBuffer와 nextEdges를 동시에 shift하고, NEXT_EDGE_4를 pathBuffer에서 채움
 */
function shiftAndRefillNextEdges(
  data: Float32Array,
  ptr: number,
  vehicleIndex: number,
  pathBufferFromAutoMgr: Int32Array | null | undefined,
  edgeArray: Edge[]
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

  // 2. nextEdges shift
  data[ptr + MovementData.NEXT_EDGE_0] = data[ptr + MovementData.NEXT_EDGE_1];
  data[ptr + MovementData.NEXT_EDGE_1] = data[ptr + MovementData.NEXT_EDGE_2];
  data[ptr + MovementData.NEXT_EDGE_2] = data[ptr + MovementData.NEXT_EDGE_3];
  data[ptr + MovementData.NEXT_EDGE_3] = data[ptr + MovementData.NEXT_EDGE_4];

  // 3. NEXT_EDGE_4 채우기
  const newLastEdge = getNewLastEdge(pathBufferFromAutoMgr, vehicleIndex, shiftResult.afterLen, edgeArray);
  data[ptr + MovementData.NEXT_EDGE_4] = newLastEdge;

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
  if (data[ptr + MovementData.NEXT_EDGE_0] === -1) {
    data[ptr + MovementData.NEXT_EDGE_STATE] = NextEdgeState.EMPTY;
  }
}
