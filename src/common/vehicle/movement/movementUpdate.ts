// common/vehicle/movement/movementUpdate.ts

import type { Edge } from "@/types/edge";
import {
  VEHICLE_DATA_SIZE,
  MovementData,
  MovingStatus,
} from "@/common/vehicle/initialize/constants";
import type { SpeedConfig } from "@/common/vehicle/physics/speedCalculator";
import type { IEdgeTransitionStore, OnUnusualMoveCallback } from "./edgeTransition";
import type { SensorPointsConfig } from "@/common/vehicle/helpers/sensorPoints";
import type { LockMgr } from "@/common/vehicle/logic/LockMgr";
import type { TransferMgr, VehicleLoop } from "@/common/vehicle/logic/TransferMgr";
import { TransferMode } from "@/shmSimulator/types";
import type { ISensorPointArray } from "@/common/vehicle/collision/sensorCollision";
import { calculateVehiclePhysics, SCRATCH_PHYSICS } from "./vehiclePhysics";
import { processVehicleTransition, SCRATCH_VEHICLE_TRANSITION } from "./vehicleTransition";
import { updateVehiclePosition, SCRATCH_VEHICLE_POSITION } from "./vehiclePosition";
import { commitVehicleState } from "./vehicleState";

export interface IVehicleDataArray {
  getData(): Float32Array;
}

export interface MovementConfig extends SpeedConfig, SensorPointsConfig {
  vehicleZOffset: number;
  curveMaxSpeed: number;
  curveAcceleration: number;
  /** 곡선 사전 감속에 사용할 감속도 (음수, m/s²) - 직선 구간에서 적용 */
  linearPreBrakeDeceleration?: number;
  /** 곡선 사전 감속 체크 주기 (ms) */
  curvePreBrakeCheckInterval?: number;
}

/**
 * Edge 통과 이벤트 콜백
 * @param vehId Vehicle index
 * @param fromEdgeIndex 떠나는 edge index
 * @param toEdgeIndex 진입하는 edge index
 * @param timestamp 현재 시뮬레이션 시간 (ms)
 */
export type OnEdgeTransitCallback = (
  vehId: number,
  fromEdgeIndex: number,
  toEdgeIndex: number,
  timestamp: number
) => void;

export interface MovementUpdateContext {
  vehicleDataArray: IVehicleDataArray;
  sensorPointArray: ISensorPointArray;
  edgeArray: Edge[];
  actualNumVehicles: number;
  vehicleLoopMap: Map<number, VehicleLoop>;
  edgeNameToIndex: Map<string, number>;
  store: IEdgeTransitionStore & { transferMode: TransferMode };
  lockMgr: LockMgr;
  transferMgr: TransferMgr;
  clampedDelta: number;
  config: MovementConfig;
  /** 시뮬레이션 누적 시간 (ms) - 로깅용 */
  simulationTime?: number;
  /** Edge 통과 이벤트 콜백 (로깅용) */
  onEdgeTransit?: OnEdgeTransitCallback;
  /** UnusualMove 이벤트 콜백 (연결되지 않은 edge로 이동 감지 시) */
  onUnusualMove?: OnUnusualMoveCallback;
  /** 곡선 사전 감속 체크를 위한 차량별 누적 시간 (ms) */
  curveBrakeCheckTimers?: Map<number, number>;
}

// ============================================================================
// Main Entry Point: updateMovement
// 4단계 파이프라인으로 차량 움직임을 업데이트
// ============================================================================

export function updateMovement(ctx: MovementUpdateContext) {
  const {
    vehicleDataArray,
    edgeArray,
    actualNumVehicles,
    vehicleLoopMap,
    edgeNameToIndex,
    store,
    transferMgr,
    lockMgr,
  } = ctx;

  const data = vehicleDataArray.getData();

  // Transfer 큐 처리 (루프 시작 전에 한 번만 실행)
  transferMgr.processTransferQueue(
    vehicleDataArray,
    edgeArray,
    vehicleLoopMap,
    edgeNameToIndex,
    store.transferMode,
    lockMgr
  );

  // 각 차량에 대해 4단계 파이프라인 실행
  for (let i = 0; i < actualNumVehicles; i++) {
    const ptr = i * VEHICLE_DATA_SIZE;

    // 업데이트 스킵 조건 체크 (PAUSED, STOPPED 등)
    if (shouldSkipUpdate(data, ptr)) {
      continue;
    }

    // Phase 1: 물리 계산 (가속도, 충돌 감지, 속도)
    calculateVehiclePhysics(ctx, i, data, ptr, SCRATCH_PHYSICS);
    if (SCRATCH_PHYSICS.shouldSkip) {
      continue;
    }

    // Phase 2: Edge 전환 처리
    processVehicleTransition(ctx, i, data, ptr, SCRATCH_PHYSICS, SCRATCH_VEHICLE_TRANSITION);

    // Phase 3: 위치 계산 및 merge 대기 처리
    updateVehiclePosition(ctx, i, data, ptr, SCRATCH_VEHICLE_TRANSITION, SCRATCH_VEHICLE_POSITION);

    // Phase 4: 최종 상태 기록
    commitVehicleState(
      ctx,
      i,
      data,
      ptr,
      SCRATCH_VEHICLE_TRANSITION.finalEdgeIndex,
      SCRATCH_VEHICLE_POSITION
    );
  }
}

function shouldSkipUpdate(data: Float32Array, ptr: number): boolean {
  const status = data[ptr + MovementData.MOVING_STATUS];

  if (status === MovingStatus.PAUSED) {
    return true;
  }

  if (status === MovingStatus.STOPPED) {
    data[ptr + MovementData.VELOCITY] = 0;
    return true;
  }

  if (status !== MovingStatus.MOVING) {
    data[ptr + MovementData.VELOCITY] = 0;
    return true;
  }

  return false;
}
