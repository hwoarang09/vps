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
  // NOTE: nextEdgeIndex is 1-based. 0 is invalid sentinel.
  if (nextEdgeIndex >= 1 && nextEdgeIndex <= edgeArray.length) {
    const nextEdge = edgeArray[nextEdgeIndex - 1]; // Convert to 0-based for array access
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

/** 다음 Edge 전환 가능 여부 체크 결과 */
interface NextEdgeCheckResult {
  canTransition: boolean;
  nextEdge: Edge | null;
}

/**
 * 다음 Edge로 전환 가능한지 체크 (lock, state, edge 존재 여부)
 */
function checkCanTransitionToNextEdge(
  lockMgr: IEdgeTransitionLockMgr | undefined,
  currentEdge: Edge,
  nextEdgeIndex: number,
  nextState: number,
  trafficState: number,
  edgeArray: Edge[],
  vehicleIndex: number
): NextEdgeCheckResult {
  const lockCheck = checkLockBlocking(lockMgr, currentEdge, nextEdgeIndex, edgeArray, vehicleIndex, trafficState);
  // NOTE: nextEdgeIndex is 1-based. 0 is invalid sentinel.
  if (lockCheck.blocked || nextState !== NextEdgeState.READY || nextEdgeIndex === 0) {
    return { canTransition: false, nextEdge: null };
  }

  const nextEdge = edgeArray[nextEdgeIndex - 1]; // Convert to 0-based for array access
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
    const trafficState = data[ptr + LogicData.TRAFFIC_STATE];

    // 루프 진입 로그
    devLog.veh(vehicleIndex).debug(
      `[next_edge_memory] LOOP#${loopCount} currentEdge=${currentEdge.edge_name} ratio=${currentRatio.toFixed(3)} ` +
      `nextEdgeIdx=${nextEdgeIndex} nextState=${nextState}`
    );

    // Edge transition 가능 여부 체크
    const { canTransition, nextEdge } = checkCanTransitionToNextEdge(
      lockMgr, currentEdge, nextEdgeIndex, nextState, trafficState, edgeArray, vehicleIndex
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
    data[ptr + LogicData.STOP_REASON] &= ~StopReason.LOCKED;  // Clear LOCKED bit if set

    // Next Edge 배열을 한 칸씩 앞으로 당기고 마지막 슬롯 채우기 (merge 체크 포함)
    shiftAndRefillNextEdges(data, ptr, vehicleIndex, pathBufferFromAutoMgr, edgeArray, lockMgr);

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

/**
 * pathBuffer와 nextEdges를 동시에 shift하고, pathBuffer에서 다시 채움
 * Merge 체크: lock 없으면 merge 직전까지만 채움
 */
function shiftAndRefillNextEdges(
  data: Float32Array,
  ptr: number,
  vehicleIndex: number,
  pathBufferFromAutoMgr: Int32Array | null | undefined,
  edgeArray: Edge[],
  lockMgr?: IEdgeTransitionLockMgr
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

  // 2. pathBuffer에서 NEXT_EDGE_0~4 다시 채우기 (merge 체크 포함)
  const nextEdgeOffsets = [
    MovementData.NEXT_EDGE_0,
    MovementData.NEXT_EDGE_1,
    MovementData.NEXT_EDGE_2,
    MovementData.NEXT_EDGE_3,
    MovementData.NEXT_EDGE_4,
  ];

  let stopReason: string | null = null;

  if (pathBufferFromAutoMgr && shiftResult.afterLen > 0) {
    const pathPtr = vehicleIndex * MAX_PATH_LENGTH;

    for (let i = 0; i < NEXT_EDGE_COUNT; i++) {
      if (i >= shiftResult.afterLen) {
        data[ptr + nextEdgeOffsets[i]] = 0;
        continue;
      }

      const edgeIdx = pathBufferFromAutoMgr[pathPtr + PATH_EDGES_START + i];
      if (edgeIdx < 1) {
        data[ptr + nextEdgeOffsets[i]] = 0;
        continue;
      }

      // Merge 체크
      const edge = edgeArray[edgeIdx - 1];
      if (edge && lockMgr?.isMergeNode(edge.to_node)) {
        const hasLock = lockMgr.checkGrant(edge.to_node, vehicleIndex);
        if (!hasLock) {
          // merge edge까지 채우고 멈춤
          data[ptr + nextEdgeOffsets[i]] = edgeIdx;
          stopReason = `merge@${edge.to_node}(no lock)`;
          for (let j = i + 1; j < NEXT_EDGE_COUNT; j++) {
            data[ptr + nextEdgeOffsets[j]] = 0;
          }
          break;
        }
      }

      data[ptr + nextEdgeOffsets[i]] = edgeIdx;
    }
  } else {
    // pathBuffer가 비었으면 0으로 채움
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
  const logMsg = stopReason
    ? `[SHIFT] pathBuf: [${shiftResult.beforeEdges.join(',')}](len=${shiftResult.beforeLen}) → [${shiftResult.afterEdges.join(',')}](len=${shiftResult.afterLen}) | ` +
      `nextEdges: [${beforeNextEdges.join(',')}] → [${afterNextEdges.join(',')}] STOP:${stopReason}`
    : `[SHIFT] pathBuf: [${shiftResult.beforeEdges.join(',')}](len=${shiftResult.beforeLen}) → [${shiftResult.afterEdges.join(',')}](len=${shiftResult.afterLen}) | ` +
      `nextEdges: [${beforeNextEdges.join(',')}] → [${afterNextEdges.join(',')}]`;
  devLog.veh(vehicleIndex).debug(logMsg);

  // NEXT_EDGE_0이 비어있으면 STATE도 EMPTY로 (0 is invalid sentinel)
  if (data[ptr + MovementData.NEXT_EDGE_0] === 0) {
    data[ptr + MovementData.NEXT_EDGE_STATE] = NextEdgeState.EMPTY;
  }
}
