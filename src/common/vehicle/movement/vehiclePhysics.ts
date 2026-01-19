// common/vehicle/movement/vehiclePhysics.ts

import type { Edge } from "@/types/edge";
import { EdgeType } from "@/types";
import {
  VEHICLE_DATA_SIZE,
  MovementData,
  SensorData,
  LogicData,
  StopReason,
} from "@/common/vehicle/initialize/constants";
import { calculateNextSpeed } from "@/common/vehicle/physics/speedCalculator";
import { checkCurvePreBraking } from "./curveBraking";
import { checkMergePreBraking } from "./mergeBraking";
import { devLog } from "@/logger/DevLogger";
import type { MovementUpdateContext, MovementConfig } from "./movementUpdate";

// ============================================================================
// Vehicle Physics 계산 결과 타입
// ============================================================================

export interface VehiclePhysicsResult {
  /** 계산된 새 속도 (m/s) */
  newVelocity: number;
  /** 새로운 Edge 비율 (0~1 범위 초과 가능) */
  rawNewRatio: number;
  /** 목표 비율 (clamped 0~1) */
  targetRatio: number;
  /** 현재 Edge 인덱스 */
  currentEdgeIndex: number;
  /** 현재 Edge 참조 */
  currentEdge: Edge;
  /** 센서 정지로 스킵해야 하는지 여부 */
  shouldSkip: boolean;
}

// Zero-GC Scratchpad for physics result
export const SCRATCH_PHYSICS: VehiclePhysicsResult = {
  newVelocity: 0,
  rawNewRatio: 0,
  targetRatio: 0,
  currentEdgeIndex: 0,
  currentEdge: null as unknown as Edge,
  shouldSkip: false,
};

// ============================================================================
// Phase 1: calculateVehiclePhysics
// 가속도, 충돌 감지, 속도 계산을 담당
// ============================================================================

/**
 * 차량의 물리 계산을 수행합니다.
 * - 충돌 감지 (hitZone)
 * - 가속/감속 결정
 * - 곡선 사전 감속 체크
 * - 새 속도 및 Edge 비율 계산
 *
 * @param ctx Movement 업데이트 컨텍스트
 * @param vehicleIndex 차량 인덱스
 * @param data Float32Array 데이터
 * @param ptr 차량 데이터 포인터 (vehicleIndex * VEHICLE_DATA_SIZE)
 * @param out 결과를 저장할 scratchpad
 * @returns out 참조 (shouldSkip이 true면 이후 단계 스킵 필요)
 */
export function calculateVehiclePhysics(
  ctx: MovementUpdateContext,
  vehicleIndex: number,
  data: Float32Array,
  ptr: number,
  out: VehiclePhysicsResult
): VehiclePhysicsResult {
  const { edgeArray, transferMgr, clampedDelta, config } = ctx;

  const currentEdgeIndex = data[ptr + MovementData.CURRENT_EDGE];
  const velocity = data[ptr + MovementData.VELOCITY];
  const acceleration = data[ptr + MovementData.ACCELERATION];
  const deceleration = data[ptr + MovementData.DECELERATION];
  const edgeRatio = data[ptr + MovementData.EDGE_RATIO];

  const currentEdge = edgeArray[currentEdgeIndex];

  // 1. 충돌 감지 영역 계산
  const hitZone = calculateHitZone(data, ptr, deceleration);

  // 2. 긴급 정지 처리 (hitZone === 2이면 즉시 정지, early return)
  if (processEmergencyStop(hitZone, data, ptr, vehicleIndex)) {
    out.shouldSkip = true;
    return out;
  }

  // 3. 곡선 사전 감속 체크
  const curveBrakeResult = checkCurvePreBraking({
    vehId: vehicleIndex,
    currentEdge,
    currentRatio: edgeRatio,
    currentVelocity: velocity,
    edgeArray,
    transferMgr,
    config,
    delta: clampedDelta,
    curveBrakeCheckTimers: ctx.curveBrakeCheckTimers,
  });

  // 4. 합류점 사전 감속 체크 (첫 번째 blocking merge 기준)
  const mergeBrakeResult = checkMergePreBraking({
    vehId: vehicleIndex,
    currentEdge,
    currentRatio: edgeRatio,
    currentVelocity: velocity,
    edgeArray,
    lockMgr: ctx.lockMgr,
    config,
    data,
    ptr,
  });

  // 5. 최종 가감속 결정 (세 가지 감속 요소 통합)
  const decision = decideFinalAcceleration({
    baseAcceleration: acceleration,
    baseDeceleration: deceleration,
    currentEdge,
    hitZone,
    curveBrakeResult,
    mergeBrakeResult,
    config,
  });

  const finalAccel = decision.accel;
  const finalDecel = decision.decel;

  // 새 속도 계산
  const newVelocity = calculateNextSpeed(
    velocity,
    finalAccel,
    finalDecel,
    currentEdge,
    clampedDelta,
    config
  );

  // DEBUG: 곡선 진입 시 속도 0 문제 디버깅
  const debugInfo = decision.debugInfo;
  if (currentEdge.vos_rail_type !== EdgeType.LINEAR && newVelocity === 0 && velocity > 0) {
    devLog.veh(vehicleIndex).error(`[CURVE_STOP] 곡선에서 속도 0! edge=${currentEdge.edge_name}, ` +
      `prevVel=${velocity.toFixed(2)}, newVel=${newVelocity.toFixed(2)}, ` +
      `accel=${finalAccel}, decel=${finalDecel}, ` +
      `sensorDecel=${debugInfo.sensorDecel}, curveDecel=${debugInfo.curveDecel}, mergeDecel=${debugInfo.mergeDecel}, ` +
      `maxDecel=${debugInfo.maxDecel}, hitZone=${hitZone}`);
  }

  // 목표 비율 및 새 Edge 비율 계산
  const targetRatio = clampTargetRatio(data[ptr + MovementData.TARGET_RATIO]);
  const rawNewRatio = edgeRatio + (newVelocity * clampedDelta) / currentEdge.distance;

  // 결과 저장
  out.newVelocity = newVelocity;
  out.rawNewRatio = rawNewRatio;
  out.targetRatio = targetRatio;
  out.currentEdgeIndex = currentEdgeIndex;
  out.currentEdge = currentEdge;
  out.shouldSkip = false;

  return out;
}

// ============================================================================
// Helper Functions
// ============================================================================

function calculateHitZone(
  data: Float32Array,
  ptr: number,
  deceleration: number
): number {
  const rawHit = Math.trunc(data[ptr + SensorData.HIT_ZONE]);
  let hitZone = -1;
  if (rawHit === 2) {
    hitZone = 2;
  } else if (deceleration !== 0) {
    hitZone = rawHit;
  }
  return hitZone;
}

/**
 * 긴급 정지 처리 (hitZone === 2)
 * @returns true이면 즉시 정지 (이후 물리 계산 스킵 필요)
 */
function processEmergencyStop(
  hitZone: number,
  data: Float32Array,
  ptr: number,
  vehicleIndex: number
): boolean {
  if (hitZone !== 2) {
    // SENSORED 플래그 제거
    const currentReason = data[ptr + LogicData.STOP_REASON];
    if ((currentReason & StopReason.SENSORED) !== 0) {
      data[ptr + LogicData.STOP_REASON] = currentReason & ~StopReason.SENSORED;
    }
    return false;
  }

  // hitZone === 2: 긴급 정지
  const prevVel = data[ptr + MovementData.VELOCITY];

  // DEBUG: 센서 충돌로 정지
  if (prevVel > 0) {
    const edgeIdx = data[ptr + MovementData.CURRENT_EDGE];
    devLog.veh(vehicleIndex).warn(`[SENSOR_STOP] 센서 충돌로 정지: hitZone=2, edgeIdx=${edgeIdx}, prevVel=${prevVel.toFixed(2)}`);
  }

  // 속도 0으로 설정
  data[ptr + MovementData.VELOCITY] = 0;
  data[ptr + MovementData.DECELERATION] = 0;

  // SENSORED 플래그 설정
  const currentReason = data[ptr + LogicData.STOP_REASON];
  data[ptr + LogicData.STOP_REASON] = currentReason | StopReason.SENSORED;

  return true;
}

/**
 * 세 가지 감속 요소의 결과를 받아서 최종 가감속 결정
 *
 * @returns { accel, decel, debugInfo }
 *   - debugInfo: 디버그용 각 감속 요소 값
 */
function decideFinalAcceleration({
  baseAcceleration,
  baseDeceleration,
  currentEdge,
  hitZone,
  curveBrakeResult,
  mergeBrakeResult,
  config,
}: {
  baseAcceleration: number;
  baseDeceleration: number;
  currentEdge: Edge;
  hitZone: number;
  curveBrakeResult: { shouldBrake: boolean; deceleration: number };
  mergeBrakeResult: { shouldBrake: boolean; deceleration: number };
  config: MovementConfig;
}): {
  accel: number;
  decel: number;
  debugInfo: { sensorDecel: number; curveDecel: number; mergeDecel: number; maxDecel: number };
} {
  // 1. 기본 가속도 결정 (곡선 여부에 따라)
  const appliedAccel = currentEdge.vos_rail_type === EdgeType.LINEAR
    ? baseAcceleration
    : config.curveAcceleration;

  // 2. 세 가지 감속 요소 계산
  const sensorDecel = hitZone >= 0 ? Math.abs(baseDeceleration) : 0;
  const curveDecel = curveBrakeResult.shouldBrake ? Math.abs(curveBrakeResult.deceleration) : 0;
  const mergeDecel = mergeBrakeResult.shouldBrake ? Math.abs(mergeBrakeResult.deceleration) : 0;

  // 3. 가장 큰 감속도 선택
  const maxDecel = Math.max(sensorDecel, curveDecel, mergeDecel);

  // 4. 최종 가감속 결정
  const finalAccel = maxDecel > 0 ? 0 : appliedAccel;
  const finalDecel = maxDecel > 0 ? -maxDecel : 0;

  return {
    accel: finalAccel,
    decel: finalDecel,
    debugInfo: { sensorDecel, curveDecel, mergeDecel, maxDecel }
  };
}

function clampTargetRatio(ratio: number): number {
  if (ratio < 0) return 0;
  if (ratio > 1) return 1;
  return ratio;
}
