// common/vehicle/movement/vehicleState.ts

import {
  MovementData,
  SensorData,
} from "@/common/vehicle/initialize/constants";
import { updateSensorPoints } from "@/common/vehicle/helpers/sensorPoints";
import type { VehiclePositionResult } from "./vehiclePosition";
import type { MovementUpdateContext } from "./movementUpdate";
import { devLog } from "@/logger/DevLogger";

// 차량별 마지막 위치 로그 정보
const vehicleLastPositionLog = new Map<number, { simTime: number; edgeIndex: number }>();
const POSITION_LOG_INTERVAL_MS = 500; // 0.5초

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
  const { sensorPointArray, config, simulationTime, edgeArray } = ctx;
  const { finalVelocity, finalRatio, finalX, finalY, finalZ, finalRotation } = position;

  // 이전 edge 인덱스 (상태 기록 전에 확인)
  const prevEdgeIndex = data[ptr + MovementData.CURRENT_EDGE];

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

  // 위치 로그: edge 변경 또는 0.5초 경과 시
  logPositionIfNeeded({
    vehId: vehicleIndex,
    edgeIndex: finalEdgeIndex,
    prevEdgeIndex,
    ratio: finalRatio,
    x: finalX,
    y: finalY,
    velocity: finalVelocity,
    simTime: simulationTime ?? 0,
    edgeArray,
  });
}

/** logPositionIfNeeded Context */
interface LogPositionContext {
  vehId: number;
  edgeIndex: number;
  prevEdgeIndex: number;
  ratio: number;
  x: number;
  y: number;
  velocity: number;
  simTime: number;
  edgeArray: { edge_name: string }[];
}

function logPositionIfNeeded(ctx: LogPositionContext): void {
  const { vehId, edgeIndex, prevEdgeIndex, ratio, x, y, velocity, simTime, edgeArray } = ctx;
  const lastLog = vehicleLastPositionLog.get(vehId);
  const edgeChanged = edgeIndex !== prevEdgeIndex;
  const intervalPassed = !lastLog || (simTime - lastLog.simTime >= POSITION_LOG_INTERVAL_MS);

  if (edgeChanged || intervalPassed) {
    // NOTE: edgeIndex is 1-based. 0 is invalid sentinel.
    const edgeName = edgeIndex >= 1 ? (edgeArray[edgeIndex - 1]?.edge_name ?? `idx:${edgeIndex}`) : `idx:${edgeIndex}`;
    const reason = edgeChanged ? "edge_change" : "interval";
    devLog.veh(vehId).debug(
      `[POS] ${reason} edge=${edgeName} ratio=${ratio.toFixed(3)} pos=(${x.toFixed(2)},${y.toFixed(2)}) vel=${velocity.toFixed(2)}`
    );
    vehicleLastPositionLog.set(vehId, { simTime, edgeIndex });
  }
}
