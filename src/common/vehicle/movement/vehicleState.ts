// common/vehicle/movement/vehicleState.ts

import {
  MovementData,
  SensorData,
} from "@/common/vehicle/initialize/constants";
import { updateSensorPoints } from "@/common/vehicle/helpers/sensorPoints";
import type { VehiclePositionResult } from "./vehiclePosition";
import type { MovementUpdateContext } from "./movementUpdate";

// ============================================================================
// Phase 4: commitVehicleState
// 최종 데이터 기록
// ============================================================================

/**
 * 차량의 최종 상태를 Float32Array에 기록합니다.
 * - 속도, Edge 비율, Edge 인덱스
 * - 좌표 (X, Y, Z) 및 회전값
 * - 센서 포인트 업데이트
 *
 * @param ctx Movement 업데이트 컨텍스트
 * @param vehicleIndex 차량 인덱스
 * @param data Float32Array 데이터
 * @param ptr 차량 데이터 포인터
 * @param finalEdgeIndex 최종 Edge 인덱스
 * @param position 이전 단계의 위치 계산 결과
 */
export function commitVehicleState(
  ctx: MovementUpdateContext,
  vehicleIndex: number,
  data: Float32Array,
  ptr: number,
  finalEdgeIndex: number,
  position: VehiclePositionResult
): void {
  const { sensorPointArray, config } = ctx;
  const { finalVelocity, finalRatio, finalX, finalY, finalZ, finalRotation } = position;

  // Movement 데이터 기록
  data[ptr + MovementData.VELOCITY] = finalVelocity;
  data[ptr + MovementData.EDGE_RATIO] = finalRatio;
  data[ptr + MovementData.CURRENT_EDGE] = finalEdgeIndex;

  // 좌표 데이터 기록
  data[ptr + MovementData.X] = finalX;
  data[ptr + MovementData.Y] = finalY;
  data[ptr + MovementData.Z] = finalZ;
  data[ptr + MovementData.ROTATION] = finalRotation;

  // 센서 포인트 업데이트
  const presetIdx = Math.trunc(data[ptr + SensorData.PRESET_IDX]);
  updateSensorPoints(sensorPointArray, vehicleIndex, finalX, finalY, finalRotation, presetIdx, config);
}
