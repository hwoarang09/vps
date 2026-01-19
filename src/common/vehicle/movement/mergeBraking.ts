// common/vehicle/movement/mergeBraking.ts

import type { Edge } from "@/types/edge";
import { EdgeType } from "@/types";
import { calculateBrakeDistance } from "@/common/vehicle/physics/speedCalculator";
import { devLog } from "@/logger/DevLogger";
import type { MovementConfig } from "./movementUpdate";
import type { LockMgr } from "@/common/vehicle/logic/LockMgr";
import {
  findFirstBlockingMerge,
  findAllMergeTargets,
  shouldRequestLockNow,
  type MergeTarget,
} from "./vehiclePosition";

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
 * - lock 획득 여부와 관계없이 합류점이 가까우면 감속 유지
 * - lock 요청/획득은 vehiclePosition.ts에서 처리
 *
 * ## 핵심 로직 (수정됨 - Lock 획득 후 급가속 문제 해결)
 * 1. findFirstBlockingMerge로 "lock을 못 받은 첫 번째 merge" 찾기
 * 2. blocking merge가 없으면:
 *    - lock을 획득한 가장 가까운 merge까지의 거리 체크
 *    - 합류점이 충분히 가까우면 계속 감속 유지 (급가속 방지)
 * 3. blocking merge가 있으면 해당 wait 지점까지 거리 기반 감속
 *
 * ## 왜 이렇게 수정했나?
 * - 기존: Lock 획득 → blocking merge 없음 → 감속 해제 → 급가속 ❌
 * - 수정: Lock 획득 → 합류점까지 거리 체크 → 가까우면 감속 유지 ✅
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

  if (blockingMerge) {
    // Blocking merge가 있으면 해당 wait 지점까지 거리 기반 감속
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

  // 2. Blocking merge가 없으면 (모든 lock 획득 성공)
  //    → lock을 획득한 가장 가까운 merge까지의 거리 체크
  //    → 합류점이 충분히 가까우면 계속 감속 유지 (급가속 방지)
  const closestMerge = findClosestAcquiredMerge(
    lockMgr,
    edgeArray,
    currentEdge,
    currentRatio,
    vehId,
    data,
    ptr
  );

  if (!closestMerge) {
    // 가까운 merge가 없음 (또는 아직 request 지점에 도달 안 함)
    return noResult;
  }

  const { mergeTarget, distanceToMerge } = closestMerge;

  // 감속 필요 거리 계산
  const deceleration = config.linearPreBrakeDeceleration ?? -2.0;
  const brakeDistance = calculateBrakeDistance(currentVelocity, 0, deceleration);

  // 합류점까지의 거리가 제동 거리 이내면 감속 유지
  if (distanceToMerge <= brakeDistance) {
    devLog.veh(vehId).debug(
      `[MERGE_BRAKE] acquired=${mergeTarget.mergeNode}(${mergeTarget.type}) distToMerge=${distanceToMerge.toFixed(2)} brakeDist=${brakeDistance.toFixed(2)} (lock acquired, continue braking)`
    );

    return {
      shouldBrake: true,
      deceleration,
      distanceToMerge,
    };
  }

  return noResult;
}

/**
 * Lock을 획득한 가장 가까운 merge를 찾습니다.
 * - Lock을 획득한 merge 중 가장 가까운 것 반환
 * - 합류점 통과 후 급가속 방지를 위해 사용
 *
 * @returns 가장 가까운 acquired merge 정보, 없으면 null
 */
function findClosestAcquiredMerge(
  lockMgr: LockMgr,
  edgeArray: Edge[],
  currentEdge: Edge,
  currentRatio: number,
  vehId: number,
  data: Float32Array,
  ptr: number
): { mergeTarget: MergeTarget; distanceToMerge: number } | null {
  const mergeTargets = findAllMergeTargets(
    lockMgr,
    edgeArray,
    currentEdge,
    currentRatio,
    data,
    ptr
  );

  for (const target of mergeTargets) {
    // 아직 request 지점에 도달 안 했으면 skip
    if (!shouldRequestLockNow(target.distanceToMerge, target.requestDistance)) {
      continue;
    }

    // Lock 획득 여부 확인
    const isGranted = lockMgr.checkGrant(target.mergeNode, vehId);

    if (isGranted) {
      // Lock을 획득한 첫 번째 merge 반환 (가장 가까운 merge)
      return {
        mergeTarget: target,
        distanceToMerge: target.distanceToMerge,
      };
    }
  }

  return null;
}
