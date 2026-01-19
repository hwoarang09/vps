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
 * - "lock을 못 받은 첫 번째 merge"를 찾아서 감속 필요 여부 계산
 * - lock 요청/획득은 vehiclePosition.ts에서 처리
 *
 * ## 핵심 로직 (변경됨)
 * 1. findFirstBlockingMerge로 "lock을 못 받은 첫 번째 merge" 찾기
 * 2. blocking merge가 없으면 감속 불필요 (모든 merge에 lock 있음)
 * 3. blocking merge가 있으면 해당 wait 지점까지 거리 기반 감속
 *
 * ## 왜 TRAFFIC_STATE를 안 쓰나?
 * - TRAFFIC_STATE는 단일 값이라서 여러 merge를 구분 못함
 * - N_20은 lock 획득, N_27은 WAITING일 때, 기존 로직은 전부 감속
 * - 새 로직: N_20 통과 후 N_27 앞에서만 감속
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

  // "lock을 못 받은 첫 번째 merge" 찾기
  const blockingMerge = findFirstBlockingMerge(
    lockMgr,
    edgeArray,
    currentEdge,
    currentRatio,
    vehId,
    data,
    ptr
  );

  if (!blockingMerge) {
    // 모든 merge에 lock 획득 성공 (또는 아직 request 지점에 도달 안 함)
    return noResult;
  }

  const { mergeTarget, distanceToWait } = blockingMerge;

  // 이미 wait 지점을 지났으면 감속하지 않음 (edge 끝에서 정지됨)
  if (distanceToWait <= 0) {
    return noResult;
  }

  // 감속 필요 거리 계산
  const deceleration = config.linearPreBrakeDeceleration ?? -2.0;
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
