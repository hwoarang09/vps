// common/vehicle/movement/curveBraking.ts

import type { Edge } from "@/types/edge";
import { EdgeType } from "@/types";
import type { TransferMgr } from "@/common/vehicle/logic/TransferMgr";
import { calculateBrakeDistance } from "@/common/vehicle/physics/speedCalculator";
import type { MovementConfig } from "./movementUpdate";

export interface CurveBrakeCheckResult {
  shouldBrake: boolean;
  deceleration: number;
  distanceToCurve: number;
}

/**
 * 곡선 Edge에서 감속 상태 초기화
 * 현재 Edge가 곡선이면 감속 상태와 타이머를 초기화
 */
function handleCurveEdgeReset(
  currentEdge: Edge,
  vehId: number,
  transferMgr: TransferMgr,
  curveBrakeCheckTimers?: Map<number, number>
): boolean {
  const brakeState = transferMgr.getCurveBrakeState(vehId);

  if (currentEdge.vos_rail_type !== EdgeType.LINEAR) {
    if (brakeState.isBraking) {
      transferMgr.clearCurveBrakeState(vehId);
    }
    // 타이머도 초기화
    if (curveBrakeCheckTimers) {
      curveBrakeCheckTimers.delete(vehId);
    }
    return true; // 곡선 Edge에 있음
  }

  return false; // 직선 Edge에 있음
}

/**
 * 이미 감속 중일 때 감속 계속 처리
 * 감속 중이면 항상 감속 계속 (체크 스킵 없이)
 */
function handleActiveBraking(
  isBraking: boolean,
  currentVelocity: number,
  curveMaxSpeed: number,
  preBrakeDecel: number
): CurveBrakeCheckResult | null {
  if (!isBraking) {
    return null; // 감속 중이 아님
  }

  if (currentVelocity > curveMaxSpeed) {
    return {
      shouldBrake: true,
      deceleration: preBrakeDecel,
      distanceToCurve: 0  // 이미 감속 중이므로 거리는 중요하지 않음
    };
  }

  // 이미 목표 속도에 도달했으면 감속 불필요
  return {
    shouldBrake: false,
    deceleration: 0,
    distanceToCurve: Infinity
  };
}

/**
 * 곡선 사전 감속 체크
 * calculateNextSpeed 전에 호출하여 감속 필요 여부 판단
 * config.curvePreBrakeCheckInterval 주기로만 새로운 체크 수행
 */
export function checkCurvePreBraking({
  vehId,
  currentEdge,
  currentRatio,
  currentVelocity,
  edgeArray,
  transferMgr,
  config,
  delta,
  curveBrakeCheckTimers,
}: {
  vehId: number;
  currentEdge: Edge;
  currentRatio: number;
  currentVelocity: number;
  edgeArray: Edge[];
  transferMgr: TransferMgr;
  config: MovementConfig;
  delta: number;
  curveBrakeCheckTimers?: Map<number, number>;
}): CurveBrakeCheckResult {
  const preBrakeDecel = config.linearPreBrakeDeceleration ?? -2;
  const brakeState = transferMgr.getCurveBrakeState(vehId);

  const noResult: CurveBrakeCheckResult = {
    shouldBrake: false,
    deceleration: 0,
    distanceToCurve: Infinity
  };

  // 현재 Edge가 곡선이면 감속 상태 초기화
  const isCurveEdge = handleCurveEdgeReset(
    currentEdge,
    vehId,
    transferMgr,
    curveBrakeCheckTimers
  );
  if (isCurveEdge) {
    return noResult;
  }

  // 이미 감속 중이면 항상 감속 계속 (체크 스킵 없이)
  const activeBrakingResult = handleActiveBraking(
    brakeState.isBraking,
    currentVelocity,
    config.curveMaxSpeed,
    preBrakeDecel
  );
  if (activeBrakingResult !== null) {
    // 감속이 완료되었으면 상태 초기화
    if (!activeBrakingResult.shouldBrake && brakeState.isBraking) {
      transferMgr.clearCurveBrakeState(vehId);
    }
    return activeBrakingResult;
  }

  // 감속 중이 아닐 때만 주기적 체크 수행
  const checkInterval = config.curvePreBrakeCheckInterval ?? 100; // 기본값 100ms

  // -1이 아니면 주기적 체크 수행
  if (checkInterval !== -1 && curveBrakeCheckTimers) {
    const elapsed = (curveBrakeCheckTimers.get(vehId) ?? 0) + delta * 1000; // delta는 초 단위, ms로 변환

    // 아직 interval이 지나지 않았으면 체크 스킵
    if (elapsed < checkInterval) {
      curveBrakeCheckTimers.set(vehId, elapsed);
      return noResult;
    }

    // interval 지났으면 타이머 리셋하고 체크 수행
    curveBrakeCheckTimers.set(vehId, 0);
  }

  // 경로에서 다음 곡선 찾기
  const curveInfo = transferMgr.findDistanceToNextCurve(
    vehId,
    currentEdge,
    currentRatio,
    edgeArray
  );

  // 경로에 곡선 없음
  if (!curveInfo) {
    return noResult;
  }

  // 감속 필요 거리 계산 (체크포인트)
  const brakeDistance = calculateBrakeDistance(
    currentVelocity,
    config.curveMaxSpeed,
    preBrakeDecel
  );

  const distanceToCurve = curveInfo.distance;
  const checkpointDistance = distanceToCurve - brakeDistance;

  // 체크포인트 지났는지 확인
  if (checkpointDistance <= 0) {
    transferMgr.startCurveBraking(vehId, curveInfo.curveEdge);

    if (currentVelocity > config.curveMaxSpeed) {
      return {
        shouldBrake: true,
        deceleration: preBrakeDecel,
        distanceToCurve
      };
    }
  }

  return noResult;
}
