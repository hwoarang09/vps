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
import type { MovementUpdateContext } from "./movementUpdate";

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

// Zero-GC Scratchpads
const SCRATCH_ACCEL = {
  accel: 0,
  decel: 0,
};

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

  // 충돌 감지 영역 계산
  const hitZone = calculateHitZone(data, ptr, deceleration);

  // 적용할 가속도/감속도 계산
  calculateAppliedAccelAndDecel(
    acceleration,
    deceleration,
    currentEdge,
    hitZone,
    config.curveAcceleration,
    SCRATCH_ACCEL
  );
  const appliedAccel = SCRATCH_ACCEL.accel;
  const appliedDecel = SCRATCH_ACCEL.decel;

  // 센서 정지 처리 (hitZone === 2이면 즉시 정지)
  if (checkAndProcessSensorStop(hitZone, data, ptr)) {
    out.shouldSkip = true;
    return out;
  }

  // 곡선 사전 감속 체크 (가속 전에 먼저 확인)
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

  // 감속 중이면 가속 막기
  const finalAccel = curveBrakeResult.shouldBrake ? 0 : appliedAccel;
  const finalDecel = curveBrakeResult.shouldBrake ? curveBrakeResult.deceleration : appliedDecel;

  // 새 속도 계산
  const newVelocity = calculateNextSpeed(
    velocity,
    finalAccel,
    finalDecel,
    currentEdge,
    clampedDelta,
    config
  );

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

function calculateAppliedAccelAndDecel(
  acceleration: number,
  deceleration: number,
  currentEdge: Edge,
  hitZone: number,
  curveAcceleration: number,
  target: typeof SCRATCH_ACCEL
) {
  let appliedAccel = acceleration;
  let appliedDecel = 0;

  // Override acceleration for curves
  if (currentEdge.vos_rail_type !== EdgeType.LINEAR) {
    appliedAccel = curveAcceleration;
  }

  if (hitZone >= 0) {
    appliedAccel = 0;
    appliedDecel = deceleration;
  }

  target.accel = appliedAccel;
  target.decel = appliedDecel;
}

function checkAndProcessSensorStop(
  hitZone: number,
  data: Float32Array,
  ptr: number
): boolean {
  if (hitZone === 2) {
    data[ptr + MovementData.VELOCITY] = 0;
    data[ptr + MovementData.DECELERATION] = 0;

    const currentReason = data[ptr + LogicData.STOP_REASON];
    data[ptr + LogicData.STOP_REASON] = currentReason | StopReason.SENSORED;
    return true;
  } else {
    const currentReason = data[ptr + LogicData.STOP_REASON];
    if ((currentReason & StopReason.SENSORED) !== 0) {
      data[ptr + LogicData.STOP_REASON] = currentReason & ~StopReason.SENSORED;
    }
    return false;
  }
}

function clampTargetRatio(ratio: number): number {
  if (ratio < 0) return 0;
  if (ratio > 1) return 1;
  return ratio;
}
