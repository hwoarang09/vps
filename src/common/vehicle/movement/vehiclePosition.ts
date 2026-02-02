// common/vehicle/movement/vehiclePosition.ts

import {
  MovementData,
  LogicData,
  StopReason,
  TrafficState,
} from "@/common/vehicle/initialize/constants";
import { interpolatePositionTo, type PositionResult } from "./positionInterpolator";
import { devLog } from "@/logger/DevLogger";
import type { LockMgr } from "@/common/vehicle/logic/LockMgr";
import type { Edge } from "@/types/edge";
import { EdgeType } from "@/types";
import type { VehicleTransitionResult } from "./vehicleTransition";
import type { MovementUpdateContext } from "./movementUpdate";
import { DeadlockZoneStrategy } from "@/config/simulationConfig";

// ============================================================================
// 로그 중복 방지를 위한 상태 추적
// ============================================================================
interface MergeLockLogState {
  lastMergeNode: string;
  lastRequestEdge: string;
  lastIsGranted: boolean;
  lastLogTime: number;
}
const mergeLockLogStates = new Map<number, MergeLockLogState>();
const LOG_THROTTLE_MS = 2000; // 같은 상태일 때 2초마다만 로그

/** TrafficState를 문자열로 변환하는 헬퍼 함수 */
function trafficStateToString(state: number): string {
  switch (state) {
    case TrafficState.FREE: return 'FREE';
    case TrafficState.ACQUIRED: return 'ACQUIRED';
    case TrafficState.WAITING: return 'WAITING';
    default: return `UNKNOWN(${state})`;
  }
}

// ============================================================================
// 위치 계산 결과 타입
// ============================================================================

export interface VehiclePositionResult {
  /** 최종 X 좌표 */
  finalX: number;
  /** 최종 Y 좌표 */
  finalY: number;
  /** 최종 Z 좌표 */
  finalZ: number;
  /** 최종 회전값 */
  finalRotation: number;
  /** 최종 Edge 비율 (merge 대기로 조정될 수 있음) */
  finalRatio: number;
  /** 최종 속도 (merge 대기 시 0) */
  finalVelocity: number;
}

// Zero-GC Scratchpads
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

// ============================================================================
// Lock 관련 헬퍼 함수
// ============================================================================

/** 합류 타입 */
export type MergeType = 'STRAIGHT' | 'CURVE';

/** 합류 타겟 정보 */
export interface MergeTarget {
  type: MergeType;
  mergeNode: string;
  requestEdge: string;      // lock 요청 시 사용할 edge 이름 (merge node의 incoming edge)
  distanceToMerge: number;  // 현재 위치에서 합류점까지의 누적 거리
  requestDistance: number;  // lock 요청 거리 (설정값)
  waitDistance: number;     // 대기 거리 (설정값)
  isDeadlockMerge: boolean; // 데드락 유발 합류점인지 (to_node 기준, requestDistance용)
  isFromDeadlockBranch: boolean; // 분기점에서 출발하는지 (from_node 기준, ARRIVAL_ORDER용)
}

/** Next Edge 오프셋 배열 */
const NEXT_EDGE_OFFSETS = [
  MovementData.NEXT_EDGE_0,
  MovementData.NEXT_EDGE_1,
  MovementData.NEXT_EDGE_2,
  MovementData.NEXT_EDGE_3,
  MovementData.NEXT_EDGE_4,
];

/**
 * Request distance 계산 (BRANCH_FIFO 전략 적용)
 */
function calculateRequestDistance(
  baseDistance: number,
  isDeadlockMerge: boolean,
  isBranchFifo: boolean,
  isDeadlockZoneInside: boolean | undefined
): number {
  if (!isDeadlockMerge || !isBranchFifo) {
    return baseDistance;
  }
  return isDeadlockZoneInside ? 0 : Infinity;
}

/**
 * 현재 edge의 to_node가 합류점인지 확인하고 MergeTarget 반환
 */
function checkCurrentEdgeMerge(
  lockMgr: LockMgr,
  currentEdge: Edge,
  accumulatedDist: number,
  isBranchFifo: boolean
): MergeTarget | null {
  if (!lockMgr.isMergeNode(currentEdge.to_node)) {
    return null;
  }

  // 합류점 기준 (calculateRequestDistance용)
  const isDeadlockMerge = lockMgr.isDeadlockZoneNode(currentEdge.to_node);
  // 분기점 기준 (ARRIVAL_ORDER용)
  const isFromDeadlockBranch = lockMgr.isDeadlockBranchNode(currentEdge.from_node);
  const requestDistance = calculateRequestDistance(
    lockMgr.getRequestDistanceFromMergingStr(),
    isDeadlockMerge,
    isBranchFifo,
    currentEdge.isDeadlockZoneInside
  );

  return {
    type: 'STRAIGHT',
    mergeNode: currentEdge.to_node,
    requestEdge: currentEdge.edge_name,
    distanceToMerge: accumulatedDist,
    requestDistance,
    waitDistance: lockMgr.getWaitDistanceFromMergingStr(),
    isDeadlockMerge,
    isFromDeadlockBranch,
  };
}

/**
 * nextEdge들을 순회하며 합류점 MergeTarget들 수집
 */
function collectNextEdgeMerges(
  lockMgr: LockMgr,
  edgeArray: Edge[],
  data: Float32Array,
  ptr: number,
  initialAccumulatedDist: number,
  isBranchFifo: boolean
): MergeTarget[] {
  const targets: MergeTarget[] = [];
  let accumulatedDist = initialAccumulatedDist;

  for (const offset of NEXT_EDGE_OFFSETS) {
    const nextEdgeIdx = data[ptr + offset];
    if (nextEdgeIdx < 0) break;

    const nextEdge = edgeArray[nextEdgeIdx];
    if (!nextEdge) break;

    if (!lockMgr.isMergeNode(nextEdge.to_node)) {
      accumulatedDist += nextEdge.distance;
      continue;
    }

    // 합류점 기준 (calculateRequestDistance용)
    const isDeadlockMerge = lockMgr.isDeadlockZoneNode(nextEdge.to_node);
    // 분기점 기준 (ARRIVAL_ORDER용)
    const isFromDeadlockBranch = lockMgr.isDeadlockBranchNode(nextEdge.from_node);
    const isCurve = nextEdge.vos_rail_type !== EdgeType.LINEAR;

    const baseRequestDist = isCurve
      ? lockMgr.getRequestDistanceFromMergingCurve()
      : lockMgr.getRequestDistanceFromMergingStr();

    const requestDistance = calculateRequestDistance(
      baseRequestDist,
      isDeadlockMerge,
      isBranchFifo,
      nextEdge.isDeadlockZoneInside
    );

    targets.push({
      type: isCurve ? 'CURVE' : 'STRAIGHT',
      mergeNode: nextEdge.to_node,
      requestEdge: nextEdge.edge_name,
      distanceToMerge: isCurve ? accumulatedDist : accumulatedDist + nextEdge.distance,
      requestDistance,
      waitDistance: isCurve
        ? lockMgr.getWaitDistanceFromMergingCurve()
        : lockMgr.getWaitDistanceFromMergingStr(),
      isDeadlockMerge,
      isFromDeadlockBranch,
    });

    accumulatedDist += nextEdge.distance;
  }

  return targets;
}

/**
 * 경로를 따라가면서 모든 합류점 찾기
 */
export function findAllMergeTargets(
  lockMgr: LockMgr,
  edgeArray: Edge[],
  currentEdge: Edge,
  currentRatio: number,
  data: Float32Array,
  ptr: number
): MergeTarget[] {
  const isBranchFifo = lockMgr.getDeadlockZoneStrategy() === DeadlockZoneStrategy.BRANCH_FIFO;
  const accumulatedDist = currentEdge.distance * (1 - currentRatio);

  const targets: MergeTarget[] = [];

  // 1. currentEdge.tn 확인 (직선 합류)
  const currentMerge = checkCurrentEdgeMerge(lockMgr, currentEdge, accumulatedDist, isBranchFifo);
  if (currentMerge) {
    targets.push(currentMerge);
  }

  // 2. nextEdge들 순회
  const nextMerges = collectNextEdgeMerges(lockMgr, edgeArray, data, ptr, accumulatedDist, isBranchFifo);
  targets.push(...nextMerges);

  return targets;
}

/**
 * Lock 요청 시점 판단
 * - 합류점까지의 누적 거리가 requestDistance 이하일 때 요청
 * - requestDistance가 Infinity면 요청하지 않음 (BRANCH_FIFO에서 사용)
 */
export function shouldRequestLockNow(
  distanceToMerge: number,
  requestDistance: number
): boolean {
  if (!Number.isFinite(requestDistance)) {
    return false; // Infinity면 요청하지 않음 (아직 분기점 진입 전)
  }
  if (requestDistance < 0) {
    return true;
  }
  return distanceToMerge <= requestDistance;
}

/** Blocking merge 결과 (lock 못 받은 첫 번째 merge) */
export interface BlockingMergeResult {
  mergeTarget: MergeTarget;
  distanceToWait: number;  // 대기 지점까지의 거리
}

/**
 * 경로상의 모든 merge 중 lock을 못 받은 첫 번째 merge를 찾습니다.
 * - 가까운 merge부터 순서대로 체크
 * - lock 획득 성공한 merge는 건너뜀
 * - lock 미획득 merge를 찾으면 해당 merge 반환
 *
 * @returns 첫 번째 blocking merge 정보, 없으면 null
 */
export function findFirstBlockingMerge(
  lockMgr: LockMgr,
  edgeArray: Edge[],
  currentEdge: Edge,
  currentRatio: number,
  vehId: number,
  data: Float32Array,
  ptr: number
): BlockingMergeResult | null {
  // 곡선에서는 이미 lock 처리가 끝난 상태로 간주
  if (currentEdge.vos_rail_type !== EdgeType.LINEAR) {
    return null;
  }

  const mergeTargets = findAllMergeTargets(
    lockMgr,
    edgeArray,
    currentEdge,
    currentRatio,
    data,
    ptr
  );

  for (const target of mergeTargets) {
    // 아직 request 지점에 도달 안 했으면 skip (아직 lock 요청 전)
    if (!shouldRequestLockNow(target.distanceToMerge, target.requestDistance)) {
      continue;
    }

    // Lock 획득 여부 확인 (request는 vehiclePosition의 processMergeLogicInline에서 처리됨)
    const isGranted = lockMgr.checkGrant(target.mergeNode, vehId);

    if (!isGranted) {
      // 이 merge가 첫 번째 blocking merge
      const distanceToWait = target.distanceToMerge - target.waitDistance;
      return {
        mergeTarget: target,
        distanceToWait: Math.max(0, distanceToWait)
      };
    }
    // lock 획득 성공 → 다음 merge 체크
  }

  // 모든 merge에서 lock 획득 성공 (또는 아직 request 지점에 도달 안 함)
  return null;
}

export const SCRATCH_VEHICLE_POSITION: VehiclePositionResult = {
  finalX: 0,
  finalY: 0,
  finalZ: 0,
  finalRotation: 0,
  finalRatio: 0,
  finalVelocity: 0,
};

// ============================================================================
// Phase 3: updateVehiclePosition
// 실제 좌표 계산 및 merge 대기 처리
// ============================================================================

/**
 * Phase 3: 차량의 실제 좌표를 계산합니다.
 *
 * ## 왜 interpolatePositionTo를 2번 호출하는가?
 *
 * ### 1차 호출 (394-400줄)
 * - Edge transition 후의 기본 위치 계산
 * - finalRatio에 해당하는 실제 좌표(x, y, z, rotation) 계산
 *
 * ### 2차 호출 (418-424줄) - Merge 대기 시에만
 * - 차량이 대기 지점을 넘어간 경우에만 발생
 * - finalRatio가 대기 지점으로 변경되므로 좌표를 다시 계산해야 함
 *
 * #### 예시:
 * ```
 * 1. 속도 계산 후: finalRatio=0.85
 * 2. 1차 interpolatePositionTo(0.85) → 위치 A
 * 3. Merge 대기 체크: 대기 지점이 0.80
 * 4. shouldWait=true, finalRatio를 0.80으로 되돌림
 * 5. 2차 interpolatePositionTo(0.80) → 위치 B (대기 지점)
 * 6. 결과: 차량은 위치 B에 멈춤
 * ```
 *
 * @param ctx Movement 업데이트 컨텍스트
 * @param vehicleIndex 차량 인덱스
 * @param data Float32Array 데이터
 * @param ptr 차량 데이터 포인터
 * @param transition 이전 단계의 전환 결과
 * @param out 결과를 저장할 scratchpad
 * @returns out 참조
 */
export function updateVehiclePosition(
  ctx: MovementUpdateContext,
  vehicleIndex: number,
  data: Float32Array,
  ptr: number,
  transition: VehicleTransitionResult,
  out: VehiclePositionResult
): VehiclePositionResult {
  const { edgeArray, lockMgr, config } = ctx;
  const { finalEdgeIndex, activeEdge } = transition;
  let { finalRatio, finalVelocity } = transition;

  // 기본 좌표값 (이전 값 유지)
  let finalX = data[ptr + MovementData.X];
  let finalY = data[ptr + MovementData.Y];
  let finalZ = data[ptr + MovementData.Z];
  let finalRotation = data[ptr + MovementData.ROTATION];

  // 1차 위치 보간: Edge transition 후 기본 위치 계산
  if (activeEdge) {
    interpolatePositionTo(activeEdge, finalRatio, SCRATCH_POS, config.vehicleZOffset);
    finalX = SCRATCH_POS.x;
    finalY = SCRATCH_POS.y;
    finalZ = SCRATCH_POS.z;
    finalRotation = SCRATCH_POS.rotation;
  }

  // Merge 대기 처리
  const finalEdge = edgeArray[finalEdgeIndex];
  const shouldWait = checkAndProcessMergeWait({
    lockMgr,
    edgeArray,
    currentEdge: finalEdge,
    vehId: vehicleIndex,
    currentRatio: finalRatio,
    data,
    ptr,
    target: SCRATCH_MERGE_POS,
  });

  if (shouldWait) {
    // 차량이 대기 지점을 넘어간 경우: 대기 지점으로 되돌림
    finalRatio = SCRATCH_MERGE_POS.x;  // 새로운 ratio (대기 지점)

    // 2차 위치 보간: 변경된 ratio에 맞는 좌표 재계산
    if (activeEdge) {
      interpolatePositionTo(activeEdge, finalRatio, SCRATCH_POS, config.vehicleZOffset);
      finalX = SCRATCH_POS.x;
      finalY = SCRATCH_POS.y;
      finalZ = SCRATCH_POS.z;
      finalRotation = SCRATCH_POS.rotation;
    }
    finalVelocity = 0;  // 대기 중이므로 속도 0
  }

  // 결과 저장
  out.finalX = finalX;
  out.finalY = finalY;
  out.finalZ = finalZ;
  out.finalRotation = finalRotation;
  out.finalRatio = finalRatio;
  out.finalVelocity = finalVelocity;

  return out;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * 곡선→곡선→합류 케이스 처리
 * 조건에 맞으면 lock 요청/획득 후 trafficState 설정
 */
function handleCurveToCurveMerge(
  lockMgr: LockMgr,
  edgeArray: Edge[],
  currentEdge: Edge,
  currentRatio: number,
  vehId: number,
  data: Float32Array,
  ptr: number
): void {
  const nextEdgeIdx = data[ptr + MovementData.NEXT_EDGE_0];
  if (nextEdgeIdx < 0) return;

  const nextEdge = edgeArray[nextEdgeIdx];
  if (!nextEdge) return;
  if (nextEdge.vos_rail_type === EdgeType.LINEAR) return;
  if (!lockMgr.isMergeNode(nextEdge.to_node)) return;

  const remainingDist = currentEdge.distance * (1 - currentRatio);
  const requestDist = lockMgr.getRequestDistanceFromMergingCurve();
  if (remainingDist > requestDist) return;

  // Lock 요청 및 상태 설정
  lockMgr.requestLock(nextEdge.to_node, nextEdge.edge_name, vehId);
  const isGranted = lockMgr.checkGrant(nextEdge.to_node, vehId);

  devLog.veh(vehId).debug(
    `[CURVE_CURVE_MERGE] currentEdge=${currentEdge.edge_name}, nextEdge=${nextEdge.edge_name}, ` +
    `mergeNode=${nextEdge.to_node}, remainingDist=${remainingDist.toFixed(2)}, isGranted=${isGranted}`
  );

  data[ptr + LogicData.TRAFFIC_STATE] = isGranted ? TrafficState.ACQUIRED : TrafficState.WAITING;
}

/** Lock 획득 실패 시 대기 처리 결과 */
interface WaitResult {
  shouldWait: boolean;
  waitRatio?: number;
}

/**
 * Lock 획득 실패 시 대기 처리
 * - 대기 지점에 도달하거나 지나쳤으면 현재 위치에서 멈춤
 * - 뒤로 되돌리지 않음 (순간이동 방지)
 */
function calculateWaitPosition(
  mergeTarget: MergeTarget,
  currentEdge: Edge,
  currentRatio: number,
  vehId: number
): WaitResult {
  const distanceToWait = mergeTarget.distanceToMerge - mergeTarget.waitDistance;

  // 대기 지점 이전이면 계속 진행
  if (distanceToWait > 0) {
    return { shouldWait: false };
  }

  // 대기 지점에 도달했거나 지나침 → 현재 위치에서 멈춤 (뒤로 되돌리지 않음)
  devLog.veh(vehId).debug(
    `[MERGE_WAIT] 대기: mergeNode=${mergeTarget.mergeNode}, ` +
    `currentRatio=${currentRatio.toFixed(3)}, distanceToWait=${distanceToWait.toFixed(3)}`
  );

  return { shouldWait: true, waitRatio: currentRatio };
}

/**
 * 곡선 합류 로그 (throttle 적용)
 */
function logCurveMergeLockIfNeeded(
  vehId: number,
  mergeTarget: MergeTarget,
  currentEdgeName: string,
  isGranted: boolean
): void {
  const now = Date.now();
  const prevLogState = mergeLockLogStates.get(vehId);

  const stateChanged = !prevLogState ||
    prevLogState.lastMergeNode !== mergeTarget.mergeNode ||
    prevLogState.lastRequestEdge !== mergeTarget.requestEdge ||
    prevLogState.lastIsGranted !== isGranted;

  const timeElapsed = !prevLogState || (now - prevLogState.lastLogTime) >= LOG_THROTTLE_MS;

  if (stateChanged || timeElapsed) {
    devLog.veh(vehId).debug(
      `[MERGE_LOCK] 곡선 합류 락: currentEdge=${currentEdgeName}, requestEdge=${mergeTarget.requestEdge}, ` +
      `mergeNode=${mergeTarget.mergeNode}, isGranted=${isGranted}, dist=${mergeTarget.distanceToMerge.toFixed(2)}`
    );
    mergeLockLogStates.set(vehId, {
      lastMergeNode: mergeTarget.mergeNode,
      lastRequestEdge: mergeTarget.requestEdge,
      lastIsGranted: isGranted,
      lastLogTime: now,
    });
  }
}

/** Merge 처리 Context */
interface MergeProcessContext {
  lockMgr: LockMgr;
  edgeArray: Edge[];
  currentEdge: Edge;
  vehId: number;
  currentRatio: number;
  data: Float32Array;
  ptr: number;
  target: PositionResult;
}

function checkAndProcessMergeWait(ctx: MergeProcessContext): boolean {
  return processMergeLogicInline(ctx);
}

/**
 * 곡선 edge에서 lock 처리 (이미 획득한 상태 유지)
 * @returns true = 곡선 처리 완료, false = 직선이므로 계속 진행
 */
function handleCurveEdgeLock(ctx: MergeProcessContext): boolean {
  const { lockMgr, edgeArray, currentEdge, vehId, currentRatio, data, ptr } = ctx;

  if (currentEdge.vos_rail_type === EdgeType.LINEAR) {
    return false;
  }

  // 곡선: ACQUIRED 아니면 곡선→곡선→합류 케이스 처리
  if (data[ptr + LogicData.TRAFFIC_STATE] !== TrafficState.ACQUIRED) {
    handleCurveToCurveMerge(lockMgr, edgeArray, currentEdge, currentRatio, vehId, data, ptr);
  }

  return true;
}

/**
 * 합류점 없을 때 자유 통행 상태로 설정
 */
function setFreeTrafficState(data: Float32Array, ptr: number): void {
  const currentReason = data[ptr + LogicData.STOP_REASON];
  if ((currentReason & StopReason.LOCKED) !== 0) {
    data[ptr + LogicData.STOP_REASON] = currentReason & ~StopReason.LOCKED;
  }
  data[ptr + LogicData.TRAFFIC_STATE] = TrafficState.FREE;
}

interface MergeTargetProcessResult {
  shouldWait: boolean;
  waitRatio?: number;
}

/**
 * 각 merge target을 순차적으로 처리
 */
function processMergeTargets(
  ctx: MergeProcessContext,
  mergeTargets: MergeTarget[],
  currentReason: number
): MergeTargetProcessResult {
  const { lockMgr, currentEdge, vehId, currentRatio, data, ptr } = ctx;

  for (const mergeTarget of mergeTargets) {
    if (!shouldRequestLockNow(mergeTarget.distanceToMerge, mergeTarget.requestDistance)) {
      continue;
    }

    lockMgr.requestLock(mergeTarget.mergeNode, mergeTarget.requestEdge, vehId);
    const isGranted = lockMgr.checkGrant(mergeTarget.mergeNode, vehId);

    if (mergeTarget.type === 'CURVE') {
      logCurveMergeLockIfNeeded(vehId, mergeTarget, currentEdge.edge_name, isGranted);
    }

    if (!isGranted) {
      data[ptr + LogicData.TRAFFIC_STATE] = TrafficState.WAITING;
      const waitResult = calculateWaitPosition(mergeTarget, currentEdge, currentRatio, vehId);

      if (waitResult.shouldWait) {
        // 분기점에서 출발한 경우 도착 알림 (ARRIVAL_ORDER용)
        if (mergeTarget.isFromDeadlockBranch) {
          lockMgr.notifyArrival(mergeTarget.mergeNode, vehId);
        }
        data[ptr + LogicData.STOP_REASON] = currentReason | StopReason.LOCKED;
        return { shouldWait: true, waitRatio: waitResult.waitRatio ?? 0 };
      }

      if ((currentReason & StopReason.LOCKED) !== 0) {
        data[ptr + LogicData.STOP_REASON] = currentReason & ~StopReason.LOCKED;
      }
      return { shouldWait: false };
    }
  }

  return { shouldWait: false };
}

/**
 * Merge 대기 로직 처리
 */
function processMergeLogicInline(ctx: MergeProcessContext): boolean {
  const { lockMgr, edgeArray, currentEdge, currentRatio, data, ptr, target, vehId } = ctx;

  // 1. 곡선 위에서는 lock 계산 안 함
  const isCurveHandled = handleCurveEdgeLock(ctx);
  if (isCurveHandled) {
    return false;
  }

  // 2. 경로 전체를 탐색해서 합류점 찾기
  const mergeTargets = findAllMergeTargets(lockMgr, edgeArray, currentEdge, currentRatio, data, ptr);

  // 3. 합류점이 없으면 자유 통행
  if (mergeTargets.length === 0) {
    setFreeTrafficState(data, ptr);
    return false;
  }

  const currentTrafficState = data[ptr + LogicData.TRAFFIC_STATE];
  const currentReason = data[ptr + LogicData.STOP_REASON];

  // 4. 각 merge target을 순차적으로 처리
  const result = processMergeTargets(ctx, mergeTargets, currentReason);
  if (result.shouldWait) {
    target.x = result.waitRatio ?? 0;
    return true;
  }

  // 모든 도달한 target의 lock 획득 성공
  if ((currentReason & StopReason.LOCKED) !== 0) {
    data[ptr + LogicData.STOP_REASON] = currentReason & ~StopReason.LOCKED;
  }

  const anyRequested = mergeTargets.some(t => shouldRequestLockNow(t.distanceToMerge, t.requestDistance));
  const newState = anyRequested ? TrafficState.ACQUIRED : TrafficState.FREE;

  // 디버그: 곡선 합류 시 trafficState 변경
  const hasCurveMerge = mergeTargets.some(t => t.type === 'CURVE');
  if (hasCurveMerge && newState !== currentTrafficState) {
    const prevStr = trafficStateToString(currentTrafficState);
    const newStr = trafficStateToString(newState);
    const targetNodes = mergeTargets.map(t => `${t.mergeNode}(${t.type},${t.requestEdge})`).join(', ');
    devLog.veh(vehId).debug(`[TRAFFIC_STATE] ${prevStr} → ${newStr}, targets=[${targetNodes}]`);
  }

  data[ptr + LogicData.TRAFFIC_STATE] = newState;

  return false;
}
