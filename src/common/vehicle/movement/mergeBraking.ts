// common/vehicle/movement/mergeBraking.ts

import type { Edge } from "@/types/edge";
import { EdgeType } from "@/types";
import { calculateBrakeDistance } from "@/common/vehicle/physics/speedCalculator";
import { devLog } from "@/logger/DevLogger";
import type { MovementConfig } from "./movementUpdate";
import type { LockMgr } from "@/common/vehicle/logic/LockMgr";
import { findFirstBlockingMerge } from "./vehiclePosition";

export interface MergeBrakeCheckResult {
  shouldBrake: boolean;
  deceleration: number;
  distanceToMerge: number;
}

/**
 * 합류점 사전 감속 체크 (LINEAR edge만 적용)
 *
 * ## 역할
 * - 가장 가까운 합류점까지의 거리를 기반으로 감속 필요 여부 계산
 * - lock 요청/획득은 vehiclePosition.ts에서 처리
 *
 * ## 핵심 로직
 * 1. findFirstBlockingMerge로 "lock을 못 받은 첫 번째 merge" 찾기
 * 2. blocking merge가 없으면 (락 획득 성공) → 감속 안 함
 * 3. blocking merge가 있으면 해당 wait 지점까지 거리 기반 감속
 */
export function checkMergePreBraking({
  vehId,
  currentEdge,
  currentRatio,
  currentVelocity,
  edgeArray,
  lockMgr,
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

  // 1. "lock을 못 받은 첫 번째 merge" 찾기
  const blockingMerge = findFirstBlockingMerge(
    lockMgr,
    edgeArray,
    currentEdge,
    currentRatio,
    vehId,
    data,
    ptr
  );

  // Blocking merge가 없으면 (락 획득 성공) → 감속 안 함
  if (!blockingMerge) {
    return noResult;
  }

  // Blocking merge가 있으면 해당 wait 지점까지 거리 기반 감속
  const { mergeTarget, distanceToWait } = blockingMerge;

  // 이미 wait 지점을 지났으면 감속하지 않음 (edge 끝에서 정지됨)
  if (distanceToWait <= 0) {
    return noResult;
  }

  // 감속 필요 거리 계산
  const deceleration = config.linearPreBrakeDeceleration ?? -2;
  const brakeDistance = calculateBrakeDistance(currentVelocity, 0, deceleration);

  devLog.veh(vehId).debug(
    `[MERGE_BRAKE] blocking=${mergeTarget.mergeNode}(${mergeTarget.type}) distToWait=${distanceToWait.toFixed(2)} brakeDist=${brakeDistance.toFixed(2)}`
  );

  if (distanceToWait <= brakeDistance) {
    return {
      shouldBrake: true,
      deceleration,
      distanceToMerge: distanceToWait,
    };
  }

  return noResult;
}
