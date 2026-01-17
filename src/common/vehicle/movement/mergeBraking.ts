// common/vehicle/movement/mergeBraking.ts

import type { Edge } from "@/types/edge";
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
 * 합류점 사전 감속 체크
 * TrafficState가 WAITING일 때만 waitDistance에서 부드럽게 정지하도록 감속
 * calculateNextSpeed 전에 호출하여 감속 필요 여부 판단
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

  // TrafficState 확인
  const trafficState = data[ptr + LogicData.TRAFFIC_STATE];

  // WAITING 상태가 아니면 감속하지 않음
  if (trafficState !== TrafficState.WAITING) {
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

  // 경로에 merge point 없음
  if (!mergeInfo) {
    return noResult;
  }

  // merge edge의 waitDistance 계산
  const waitDistance = lockMgr.getWaitDistance(mergeInfo.mergeEdge);

  // merge edge 끝까지의 거리 - waitDistance = wait 지점까지의 실제 거리
  const distanceToWait = mergeInfo.distance - waitDistance;

  console.log(`[MergeBraking] veh=${vehId}, mergeEdge=${mergeInfo.mergeEdge.edge_name}, ` +
    `distToMergeEnd=${mergeInfo.distance.toFixed(2)}m, waitDist=${waitDistance.toFixed(2)}m, ` +
    `distToWait=${distanceToWait.toFixed(2)}m, vel=${currentVelocity.toFixed(2)}m/s`);

  // wait 지점을 이미 지나쳤으면 감속하지 않음 (급정지 구간)
  if (distanceToWait <= 0) {
    console.log(`[MergeBraking] Already in emergency stop zone`);
    return noResult;
  }

  // 감속 필요 거리 계산 (목표: 완전 정지)
  const brakeDistance = calculateBrakeDistance(
    currentVelocity,
    0, // 목표 속도: 완전 정지
    config.linearDeceleration // -3.0
  );

  console.log(`[MergeBraking] brakeDistance=${brakeDistance.toFixed(2)}m, need brake: ${distanceToWait <= brakeDistance}`);

  // 감속 시작 지점 도달 여부 확인
  if (distanceToWait <= brakeDistance) {
    console.log(`[MergeBraking] ⚠️ START BRAKING! decel=${config.linearDeceleration}`);
    return {
      shouldBrake: true,
      deceleration: config.linearDeceleration,
      distanceToMerge: distanceToWait,
    };
  }

  return noResult;
}
