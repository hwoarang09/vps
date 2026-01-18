// common/vehicle/movement/mergeBraking.ts

import type { Edge } from "@/types/edge";
import { EdgeType } from "@/types";
import { calculateBrakeDistance } from "@/common/vehicle/physics/speedCalculator";
import type { MovementConfig } from "./movementUpdate";
import type { LockMgr } from "@/common/vehicle/logic/LockMgr";
import type { TransferMgr } from "@/common/vehicle/logic/TransferMgr";
import { TrafficState, LogicData } from "@/common/vehicle/initialize/constants";

export interface MergeBrakeCheckResult {
  shouldBrake: boolean;
  deceleration: number;
  distanceToMerge: number;
}

/**
 * 합류점 사전 감속 체크 (LINEAR edge만 적용)
 *
 * ## 역할
 * - 앞에 있는 merge point를 감지하고 감속 필요 여부만 계산
 * - lock 요청/획득은 vehiclePosition.ts에서 처리
 *
 * ## 핵심 로직
 * 1. 다가오는 merge point 감지 (findDistanceToNextMerge)
 * 2. ACQUIRED 상태면 감속 불필요
 * 3. WAITING 상태면 감속 계산
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
  };

  // 곡선 Edge에서는 merge 사전 감속 적용 안 함
  if (currentEdge.vos_rail_type !== EdgeType.LINEAR) {
    return noResult;
  }

  // ACQUIRED 상태(lock 이미 획득)면 감속 불필요
  const trafficState = data[ptr + LogicData.TRAFFIC_STATE];
  if (trafficState === TrafficState.ACQUIRED) {
    return noResult;
  }

  // 앞으로 다가올 merge point 찾기
  const mergeInfo = transferMgr.findDistanceToNextMerge(
    vehId,
    currentEdge,
    currentRatio,
    edgeArray,
    (nodeName) => lockMgr.isMergeNode(nodeName)
  );

  if (!mergeInfo) {
    return noResult;
  }

  const mergeEdge = mergeInfo.mergeEdge;
  const isMergeEdgeCurve = mergeEdge.vos_rail_type !== EdgeType.LINEAR;

  // 곡선 merge edge: 현재 직선 끝에서 정지하도록 감속
  if (isMergeEdgeCurve) {
    return calculateCurveMergeBraking({
      currentEdge,
      currentRatio,
      currentVelocity,
      config,
      trafficState,
    });
  }

  // 직선 merge edge: waitDistance 지점에서 정지하도록 감속
  return calculateLinearMergeBraking({
    currentVelocity,
    mergeEdge,
    distanceToMergeEnd: mergeInfo.distance,
    lockMgr,
    config,
    trafficState,
  });
}

/**
 * 곡선 merge edge에 대한 감속 계산
 * WAITING 상태일 때만 현재 직선 끝에서 정지하도록 감속
 */
function calculateCurveMergeBraking({
  currentEdge,
  currentRatio,
  currentVelocity,
  config,
  trafficState,
}: {
  currentEdge: Edge;
  currentRatio: number;
  currentVelocity: number;
  config: MovementConfig;
  trafficState: number;
}): MergeBrakeCheckResult {
  const noResult: MergeBrakeCheckResult = {
    shouldBrake: false,
    deceleration: 0,
    distanceToMerge: Infinity,
  };

  // WAITING 상태가 아니면 감속 불필요
  if (trafficState !== TrafficState.WAITING) {
    return noResult;
  }

  // 현재 직선의 남은 거리
  const distanceToCurrentEdgeEnd = currentEdge.distance * (1 - currentRatio);

  // 감속 필요 거리 계산
  const deceleration = config.linearPreBrakeDeceleration ?? -2.0;
  const brakeDistance = calculateBrakeDistance(currentVelocity, 0, deceleration);

  if (distanceToCurrentEdgeEnd <= brakeDistance) {
    return {
      shouldBrake: true,
      deceleration,
      distanceToMerge: distanceToCurrentEdgeEnd,
    };
  }

  return noResult;
}

/**
 * 직선 merge edge에 대한 감속 계산
 * WAITING 상태일 때만 waitDistance 지점에서 정지하도록 감속
 */
function calculateLinearMergeBraking({
  currentVelocity,
  mergeEdge,
  distanceToMergeEnd,
  lockMgr,
  config,
  trafficState,
}: {
  currentVelocity: number;
  mergeEdge: Edge;
  distanceToMergeEnd: number;
  lockMgr: LockMgr;
  config: MovementConfig;
  trafficState: number;
}): MergeBrakeCheckResult {
  const noResult: MergeBrakeCheckResult = {
    shouldBrake: false,
    deceleration: 0,
    distanceToMerge: Infinity,
  };

  // WAITING 상태가 아니면 감속 불필요
  if (trafficState !== TrafficState.WAITING) {
    return noResult;
  }

  // wait 지점까지의 거리
  const waitDistance = lockMgr.getWaitDistance(mergeEdge);
  const distanceToWait = distanceToMergeEnd - waitDistance;

  // 이미 wait 지점을 지났으면 감속하지 않음
  if (distanceToWait <= 0) {
    return noResult;
  }

  // 감속 필요 거리 계산
  const deceleration = config.linearPreBrakeDeceleration ?? -2.0;
  const brakeDistance = calculateBrakeDistance(currentVelocity, 0, deceleration);

  if (distanceToWait <= brakeDistance) {
    return {
      shouldBrake: true,
      deceleration,
      distanceToMerge: distanceToWait,
    };
  }

  return noResult;
}
