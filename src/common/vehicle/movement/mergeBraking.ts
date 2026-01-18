// common/vehicle/movement/mergeBraking.ts

import type { Edge } from "@/types/edge";
import { EdgeType } from "@/types";
import { calculateBrakeDistance } from "@/common/vehicle/physics/speedCalculator";
import type { MovementConfig } from "./movementUpdate";
import type { LockMgr } from "@/common/vehicle/logic/LockMgr";
import type { TransferMgr } from "@/common/vehicle/logic/TransferMgr";
import { TrafficState, LogicData, StopReason } from "@/common/vehicle/initialize/constants";

export interface MergeBrakeCheckResult {
  shouldBrake: boolean;
  deceleration: number;
  distanceToMerge: number;
  /** lock을 획득했는지 여부 */
  preLockAcquired: boolean;
}

// ============================================================================
// Lock 요청 관련 헬퍼 함수들
// ============================================================================

/**
 * Lock 요청 시점 도달 여부 판단
 *
 * @param distanceToMergeEnd merge point(to_node)까지의 거리
 * @param requestDistance lock 요청 거리 (-1이면 즉시 요청)
 * @returns true = 요청 시점 도달, false = 아직 멀음
 */
function shouldRequestLockNow(
  distanceToMergeEnd: number,
  requestDistance: number
): boolean {
  // requestDistance가 -1이면 즉시 요청
  if (requestDistance < 0) return true;
  return distanceToMergeEnd <= requestDistance;
}

/**
 * Lock 요청 및 획득 여부 체크
 *
 * @returns isGranted: true = lock 획득 성공, false = 대기 필요
 */
function requestAndCheckLock({
  lockMgr,
  mergeNode,
  mergeEdgeName,
  vehId,
  trafficState,
  data,
  ptr,
}: {
  lockMgr: LockMgr;
  mergeNode: string;
  mergeEdgeName: string;
  vehId: number;
  trafficState: number;
  data: Float32Array;
  ptr: number;
}): { isGranted: boolean } {
  // Lock 요청 (FREE 상태일 때만, 중복 요청 방지)
  if (trafficState === TrafficState.FREE) {
    lockMgr.requestLock(mergeNode, mergeEdgeName, vehId);
  }

  // Lock 획득 여부 확인
  const isGranted = lockMgr.checkGrant(mergeNode, vehId);
  const currentReason = data[ptr + LogicData.STOP_REASON];

  if (isGranted) {
    // Lock 획득 성공 → ACQUIRED 상태로 전환
    if ((currentReason & StopReason.LOCKED) !== 0) {
      data[ptr + LogicData.STOP_REASON] = currentReason & ~StopReason.LOCKED;
    }
    data[ptr + LogicData.TRAFFIC_STATE] = TrafficState.ACQUIRED;
  } else {
    // Lock 대기 중
    data[ptr + LogicData.TRAFFIC_STATE] = TrafficState.WAITING;
  }

  return { isGranted };
}

/**
 * 합류점 사전 감속 체크 (LINEAR edge만 적용)
 *
 * ## 핵심 로직
 * 1. 다가오는 merge point 감지 (findDistanceToNextMerge)
 * 2. merge edge가 곡선인 경우: 현재 직선에서 미리 lock 요청
 *    - lock 획득 → 감속 없이 통과
 *    - lock 대기 → 현재 직선 끝에서 정지하도록 감속
 * 3. merge edge가 직선인 경우: waitDistance 지점에서 정지하도록 감속
 *
 * ACQUIRED(lock 획득 완료) 상태에서는 감속하지 않음
 * 곡선 Edge에서는 적용하지 않음 (곡선은 이미 속도 제한, 감속 시 급정지 위험)
 */
export function checkMergePreBraking({
  vehId,
  currentEdge,
  currentRatio,
  currentVelocity,
  edgeArray,
  lockMgr,
  transferMgr,
  config,
  data,
  ptr,
}: {
  vehId: number;
  currentEdge: Edge;
  currentRatio: number;
  currentVelocity: number;
  edgeArray: Edge[];
  lockMgr: LockMgr;
  transferMgr: TransferMgr;
  config: MovementConfig;
  data: Float32Array;
  ptr: number;
}): MergeBrakeCheckResult {
  const noResult: MergeBrakeCheckResult = {
    shouldBrake: false,
    deceleration: 0,
    distanceToMerge: Infinity,
    preLockAcquired: false,
  };

  // 곡선 Edge에서는 merge 사전 감속 적용 안 함
  // 곡선은 이미 속도 제한이 있고, 곡선에서 감속하면 급정지 위험
  if (currentEdge.vos_rail_type !== EdgeType.LINEAR) {
    return noResult;
  }

  // TrafficState 확인
  const trafficState = data[ptr + LogicData.TRAFFIC_STATE];

  // ACQUIRED 상태(lock 이미 획득)면 감속하지 않음
  if (trafficState === TrafficState.ACQUIRED) {
    return { ...noResult, preLockAcquired: true };
  }

  // 앞으로 다가올 merge point 찾기
  const mergeInfo = transferMgr.findDistanceToNextMerge(
    vehId,
    currentEdge,
    currentRatio,
    edgeArray,
    (nodeName) => lockMgr.isMergeNode(nodeName)
  );

  // 경로에 merge point 없음
  if (!mergeInfo) {
    return noResult;
  }

  const mergeEdge = mergeInfo.mergeEdge;
  const isMergeEdgeCurve = mergeEdge.vos_rail_type !== EdgeType.LINEAR;

  // ============================================================================
  // 곡선 merge edge인 경우: 현재 직선에서 미리 lock 요청
  // ============================================================================
  if (isMergeEdgeCurve) {
    return handleCurveMergePreLock({
      vehId,
      currentEdge,
      currentRatio,
      currentVelocity,
      mergeEdge,
      distanceToMergeEnd: mergeInfo.distance,
      lockMgr,
      config,
      data,
      ptr,
      trafficState,
    });
  }

  // ============================================================================
  // 직선 merge edge인 경우: waitDistance 지점에서 정지하도록 감속
  // ============================================================================
  return handleLinearMergeBraking({
    vehId,
    currentEdge,
    currentVelocity,
    mergeEdge,
    distanceToMergeEnd: mergeInfo.distance,
    lockMgr,
    config,
    data,
    ptr,
    trafficState,
  });
}

/**
 * 곡선 merge edge에 대한 사전 lock 요청 및 감속 처리
 *
 * 곡선에서는 급정지가 위험하므로, 곡선 진입 전 직선에서:
 * 1. 미리 lock 요청
 * 2. lock 못 얻으면 직선 끝에서 정지
 */
function handleCurveMergePreLock({
  vehId,
  currentEdge,
  currentRatio,
  currentVelocity,
  mergeEdge,
  distanceToMergeEnd,
  lockMgr,
  config,
  data,
  ptr,
  trafficState,
}: {
  vehId: number;
  currentEdge: Edge;
  currentRatio: number;
  currentVelocity: number;
  mergeEdge: Edge;
  distanceToMergeEnd: number;
  lockMgr: LockMgr;
  config: MovementConfig;
  data: Float32Array;
  ptr: number;
  trafficState: number;
}): MergeBrakeCheckResult {
  const noResult: MergeBrakeCheckResult = {
    shouldBrake: false,
    deceleration: 0,
    distanceToMerge: Infinity,
    preLockAcquired: false,
  };

  const mergeNode = mergeEdge.to_node;

  // 현재 직선의 남은 거리 (곡선 진입 전까지)
  const distanceToCurrentEdgeEnd = currentEdge.distance * (1 - currentRatio);

  console.log(`[MergeBraking:Curve] veh=${vehId}, curEdge=${currentEdge.edge_name}, ` +
    `mergeEdge=${mergeEdge.edge_name}(CURVE), distToEdgeEnd=${distanceToCurrentEdgeEnd.toFixed(2)}m, ` +
    `distToMergeEnd=${distanceToMergeEnd.toFixed(2)}m, vel=${currentVelocity.toFixed(2)}m/s`);

  // Lock 요청 시점 체크 (헬퍼 함수 사용)
  const requestDistance = lockMgr.getRequestDistance();
  if (!shouldRequestLockNow(distanceToMergeEnd, requestDistance)) {
    console.log(`[MergeBraking:Curve] Not yet request distance (${distanceToMergeEnd.toFixed(2)}m > ${requestDistance}m)`);
    return noResult;
  }

  // Lock 요청 및 획득 여부 확인 (헬퍼 함수 사용)
  if (trafficState === TrafficState.FREE) {
    console.log(`[MergeBraking:Curve] PRE-REQUEST lock for ${mergeNode} via ${mergeEdge.edge_name}`);
  }

  const { isGranted } = requestAndCheckLock({
    lockMgr,
    mergeNode,
    mergeEdgeName: mergeEdge.edge_name,
    vehId,
    trafficState,
    data,
    ptr,
  });

  if (isGranted) {
    // Lock 획득 성공 → 감속 없이 통과
    console.log(`[MergeBraking:Curve] ✓ Lock ACQUIRED for ${mergeNode}`);
    return { ...noResult, preLockAcquired: true };
  }

  // Lock 획득 실패 → 현재 직선 끝에서 정지
  console.log(`[MergeBraking:Curve] ✗ Lock WAITING for ${mergeNode}, need to stop at current edge end`);

  // 감속 필요 거리 계산 (목표: 현재 직선 끝에서 정지)
  const brakeDistance = calculateBrakeDistance(
    currentVelocity,
    0, // 목표 속도: 완전 정지
    config.linearDeceleration
  );

  console.log(`[MergeBraking:Curve] brakeDistance=${brakeDistance.toFixed(2)}m, ` +
    `distToEdgeEnd=${distanceToCurrentEdgeEnd.toFixed(2)}m, ` +
    `need brake: ${distanceToCurrentEdgeEnd <= brakeDistance}`);

  // 감속 시작 지점 도달 여부 확인
  if (distanceToCurrentEdgeEnd <= brakeDistance) {
    console.log(`[MergeBraking:Curve] ⚠️ START BRAKING to stop at edge end!`);
    const currentReason = data[ptr + LogicData.STOP_REASON];
    data[ptr + LogicData.STOP_REASON] = currentReason | StopReason.LOCKED;
    return {
      shouldBrake: true,
      deceleration: config.linearDeceleration,
      distanceToMerge: distanceToCurrentEdgeEnd,
      preLockAcquired: false,
    };
  }

  return noResult;
}

/**
 * 직선 merge edge에 대한 감속 처리
 *
 * 직선에서는:
 * 1. 미리 lock 요청
 * 2. lock 획득 성공 → 감속 없이 통과
 * 3. lock 대기 → waitDistance 지점에서 정지하도록 감속
 */
function handleLinearMergeBraking({
  vehId,
  currentEdge,
  currentVelocity,
  mergeEdge,
  distanceToMergeEnd,
  lockMgr,
  config,
  data,
  ptr,
  trafficState,
}: {
  vehId: number;
  currentEdge: Edge;
  currentVelocity: number;
  mergeEdge: Edge;
  distanceToMergeEnd: number;
  lockMgr: LockMgr;
  config: MovementConfig;
  data: Float32Array;
  ptr: number;
  trafficState: number;
}): MergeBrakeCheckResult {
  const noResult: MergeBrakeCheckResult = {
    shouldBrake: false,
    deceleration: 0,
    distanceToMerge: Infinity,
    preLockAcquired: false,
  };

  const mergeNode = mergeEdge.to_node;

  // merge edge의 waitDistance 계산
  const waitDistance = lockMgr.getWaitDistance(mergeEdge);

  // merge edge 끝까지의 거리 - waitDistance = wait 지점까지의 실제 거리
  const distanceToWait = distanceToMergeEnd - waitDistance;

  console.log(`[MergeBraking:Linear] veh=${vehId}, mergeEdge=${mergeEdge.edge_name}, ` +
    `distToMergeEnd=${distanceToMergeEnd.toFixed(2)}m, waitDist=${waitDistance.toFixed(2)}m, ` +
    `distToWait=${distanceToWait.toFixed(2)}m, vel=${currentVelocity.toFixed(2)}m/s`);

  // Lock 요청 시점 체크 (헬퍼 함수 사용)
  const requestDistance = lockMgr.getRequestDistance();
  if (!shouldRequestLockNow(distanceToMergeEnd, requestDistance)) {
    console.log(`[MergeBraking:Linear] Not yet request distance (${distanceToMergeEnd.toFixed(2)}m > ${requestDistance}m)`);
    return noResult;
  }

  // Lock 요청 및 획득 여부 확인 (헬퍼 함수 사용)
  if (trafficState === TrafficState.FREE) {
    console.log(`[MergeBraking:Linear] PRE-REQUEST lock for ${mergeNode} via ${mergeEdge.edge_name}`);
  }

  const { isGranted } = requestAndCheckLock({
    lockMgr,
    mergeNode,
    mergeEdgeName: mergeEdge.edge_name,
    vehId,
    trafficState,
    data,
    ptr,
  });

  if (isGranted) {
    // Lock 획득 성공 → 감속 없이 통과
    console.log(`[MergeBraking:Linear] ✓ Lock ACQUIRED for ${mergeNode}`);
    return { ...noResult, preLockAcquired: true };
  }

  // Lock 획득 실패 → waitDistance 지점에서 정지
  console.log(`[MergeBraking:Linear] ✗ Lock WAITING for ${mergeNode}`);

  // wait 지점을 이미 지나쳤으면 감속하지 않음 (급정지 구간)
  if (distanceToWait <= 0) {
    console.log(`[MergeBraking:Linear] Already in emergency stop zone`);
    return noResult;
  }

  // 감속 필요 거리 계산 (목표: 완전 정지)
  const brakeDistance = calculateBrakeDistance(
    currentVelocity,
    0, // 목표 속도: 완전 정지
    config.linearDeceleration
  );

  console.log(`[MergeBraking:Linear] brakeDistance=${brakeDistance.toFixed(2)}m, need brake: ${distanceToWait <= brakeDistance}`);

  // 감속 시작 지점 도달 여부 확인
  if (distanceToWait <= brakeDistance) {
    console.log(`[MergeBraking:Linear] ⚠️ START BRAKING! decel=${config.linearDeceleration}`);
    const currentReason = data[ptr + LogicData.STOP_REASON];
    data[ptr + LogicData.STOP_REASON] = currentReason | StopReason.LOCKED;
    return {
      shouldBrake: true,
      deceleration: config.linearDeceleration,
      distanceToMerge: distanceToWait,
      preLockAcquired: false,
    };
  }

  return noResult;
}
