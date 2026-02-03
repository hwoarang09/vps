// common/vehicle/movement/vehiclePosition.ts
// 단순화: merge 로직 제거, 순수 좌표 계산만

import { MovementData } from "@/common/vehicle/initialize/constants";
import { interpolatePositionTo, type PositionResult } from "./positionInterpolator";
import type { VehicleTransitionResult } from "./vehicleTransition";
import type { MovementUpdateContext } from "./movementUpdate";

// ============================================================================
// 위치 계산 결과 타입
// ============================================================================

export interface VehiclePositionResult {
  finalX: number;
  finalY: number;
  finalZ: number;
  finalRotation: number;
  finalRatio: number;
  finalVelocity: number;
}

// Zero-GC Scratchpad
const SCRATCH_POS: PositionResult = {
  x: 0,
  y: 0,
  z: 0,
  rotation: 0,
};

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
// 단순화: 좌표 계산만 수행
// ============================================================================

export function updateVehiclePosition(
  ctx: MovementUpdateContext,
  _vehicleIndex: number,
  data: Float32Array,
  ptr: number,
  transition: VehicleTransitionResult,
  out: VehiclePositionResult
): VehiclePositionResult {
  const { config } = ctx;
  const { activeEdge } = transition;
  const { finalRatio, finalVelocity } = transition;

  // 기본 좌표값 (이전 값 유지)
  let finalX = data[ptr + MovementData.X];
  let finalY = data[ptr + MovementData.Y];
  let finalZ = data[ptr + MovementData.Z];
  let finalRotation = data[ptr + MovementData.ROTATION];

  // 위치 보간
  if (activeEdge) {
    interpolatePositionTo(activeEdge, finalRatio, SCRATCH_POS, config.vehicleZOffset);
    finalX = SCRATCH_POS.x;
    finalY = SCRATCH_POS.y;
    finalZ = SCRATCH_POS.z;
    finalRotation = SCRATCH_POS.rotation;
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
// Legacy exports (stub) - 컴파일 에러 방지용, 추후 삭제
// ============================================================================

export type MergeType = 'STRAIGHT' | 'CURVE';

export interface MergeTarget {
  type: MergeType;
  mergeNode: string;
  requestEdge: string;
  distanceToMerge: number;
  requestDistance: number;
  waitDistance: number;
  isDeadlockMerge: boolean;
  isFromDeadlockBranch: boolean;
}

export interface BlockingMergeResult {
  mergeTarget: MergeTarget;
  distanceToWait: number;
}

// stub functions
export function findAllMergeTargets(): MergeTarget[] { return []; }
export function shouldRequestLockNow(): boolean { return false; }
export function findFirstBlockingMerge(): BlockingMergeResult | null { return null; }
