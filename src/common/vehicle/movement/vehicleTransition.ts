// common/vehicle/movement/vehicleTransition.ts

import type { Edge } from "@/types/edge";
import {
  VEHICLE_DATA_SIZE,
  MovementData,
  NextEdgeState,
  MovingStatus,
} from "@/common/vehicle/initialize/constants";
import { handleEdgeTransition, type EdgeTransitionResult } from "./edgeTransition";
import { TransferMode } from "@/shmSimulator/types";
import type { VehiclePhysicsResult } from "./vehiclePhysics";
import type { MovementUpdateContext } from "./movementUpdate";
import type { LockMgr } from "@/common/vehicle/logic/LockMgr";
import type { TransferMgr } from "@/common/vehicle/logic/TransferMgr";

// ============================================================================
// Edge 전환 처리 결과 타입
// ============================================================================

export interface VehicleTransitionResult {
  /** 최종 Edge 인덱스 */
  finalEdgeIndex: number;
  /** 최종 Edge 비율 */
  finalRatio: number;
  /** 활성 Edge (위치 계산용) */
  activeEdge: Edge | null;
  /** 최종 속도 (동일 Edge에서 target 도달 시 0) */
  finalVelocity: number;
}

// Zero-GC Scratchpads
const SCRATCH_TRANSITION: EdgeTransitionResult = {
  finalEdgeIndex: 0,
  finalRatio: 0,
  activeEdge: null,
};

const SCRATCH_TARGET_CHECK = {
  finalRatio: 0,
  finalVelocity: 0,
  reached: false,
};

export const SCRATCH_VEHICLE_TRANSITION: VehicleTransitionResult = {
  finalEdgeIndex: 0,
  finalRatio: 0,
  activeEdge: null,
  finalVelocity: 0,
};

// ============================================================================
// Phase 2: processVehicleTransition
// Edge 전환 처리를 담당
// ============================================================================

/**
 * 차량의 Edge 전환을 처리합니다.
 * - Transfer 큐 트리거
 * - Edge 전환 로직 실행
 * - 동일 Edge에서의 target 도달 체크
 * - Merge Lock 해제
 *
 * @param ctx Movement 업데이트 컨텍스트
 * @param vehicleIndex 차량 인덱스
 * @param data Float32Array 데이터
 * @param ptr 차량 데이터 포인터
 * @param physics 이전 단계의 물리 계산 결과
 * @param out 결과를 저장할 scratchpad
 * @returns out 참조
 */
export function processVehicleTransition(
  ctx: MovementUpdateContext,
  vehicleIndex: number,
  data: Float32Array,
  ptr: number,
  physics: VehiclePhysicsResult,
  out: VehicleTransitionResult
): VehicleTransitionResult {
  const { transferMgr, lockMgr } = ctx;
  const { rawNewRatio, targetRatio, currentEdgeIndex, currentEdge, newVelocity } = physics;

  // Transfer 큐 트리거 (ratio >= 0 && EMPTY 상태일 때)
  checkAndTriggerTransfer(transferMgr, data, ptr, vehicleIndex, rawNewRatio);

  // Edge 전환 로직 처리
  processEdgeTransitionLogic(
    ctx,
    vehicleIndex,
    currentEdgeIndex,
    currentEdge,
    rawNewRatio,
    targetRatio,
    SCRATCH_TRANSITION
  );

  const finalEdgeIndex = SCRATCH_TRANSITION.finalEdgeIndex;
  let finalRatio = SCRATCH_TRANSITION.finalRatio;
  const activeEdge = SCRATCH_TRANSITION.activeEdge;
  let finalVelocity = newVelocity;

  // 동일 Edge에서의 target 도달 체크
  // Edge 전환이 일어나면 momentum 유지, 동일 Edge면 target limit 체크
  if (processSameEdgeLogic(
    finalEdgeIndex === currentEdgeIndex,
    rawNewRatio,
    targetRatio,
    newVelocity,
    data,
    ptr,
    SCRATCH_TARGET_CHECK
  )) {
    finalRatio = SCRATCH_TARGET_CHECK.finalRatio;
    finalVelocity = SCRATCH_TARGET_CHECK.finalVelocity;
  }

  // Merge Lock 해제 (Edge 전환 시)
  checkAndReleaseMergeLock(lockMgr, finalEdgeIndex, currentEdgeIndex, currentEdge, vehicleIndex);

  // 결과 저장
  out.finalEdgeIndex = finalEdgeIndex;
  out.finalRatio = finalRatio;
  out.activeEdge = activeEdge;
  out.finalVelocity = finalVelocity;

  return out;
}

// ============================================================================
// Helper Functions
// ============================================================================

function checkAndTriggerTransfer(
  transferMgr: TransferMgr,
  data: Float32Array,
  ptr: number,
  vehIdx: number,
  ratio: number
) {
  const nextEdgeState = data[ptr + MovementData.NEXT_EDGE_STATE];
  if (ratio >= 0 && nextEdgeState === NextEdgeState.EMPTY) {
    data[ptr + MovementData.NEXT_EDGE_STATE] = NextEdgeState.PENDING;
    transferMgr.enqueueVehicleTransfer(vehIdx);
  }
}

function processEdgeTransitionLogic(
  ctx: MovementUpdateContext,
  vehicleIndex: number,
  currentEdgeIndex: number,
  currentEdge: Edge,
  rawNewRatio: number,
  targetRatio: number,
  out: EdgeTransitionResult
) {
  const data = ctx.vehicleDataArray.getData();
  const ptr = vehicleIndex * VEHICLE_DATA_SIZE;
  const nextEdgeState = data[ptr + MovementData.NEXT_EDGE_STATE];

  // Transition conditions:
  // 1. Reached end (rawNewRatio >= 1) AND targetRatio === 1 (normal case)
  // 2. Reached end (rawNewRatio >= 1) AND NEXT_EDGE is ready (MQTT command with nextEdge)
  //    - This handles case where targetRatio < currentRatio but nextEdge is set
  const shouldTransition = rawNewRatio >= 1 && (targetRatio === 1 || nextEdgeState === NextEdgeState.READY);

  if (shouldTransition) {
    // In MQTT_CONTROL mode, preserve TARGET_RATIO (don't overwrite with 1)
    const preserveTargetRatio = ctx.store.transferMode === TransferMode.MQTT_CONTROL;

    // Check if there's a reserved target ratio for the next edge (fixes premature target application bug)
    const nextTargetRatio = ctx.transferMgr.consumeNextEdgeReservation(vehicleIndex);

    handleEdgeTransition({
      vehicleDataArray: ctx.vehicleDataArray,
      store: ctx.store,
      vehicleIndex: vehicleIndex,
      initialEdgeIndex: currentEdgeIndex,
      initialRatio: rawNewRatio,
      edgeArray: ctx.edgeArray,
      target: out,
      preserveTargetRatio: preserveTargetRatio,
      nextTargetRatio: nextTargetRatio
    });

    // Edge transit 콜백 호출 (로깅용)
    if (ctx.onEdgeTransit && out.finalEdgeIndex !== currentEdgeIndex) {
      ctx.onEdgeTransit(
        vehicleIndex,
        currentEdgeIndex,
        out.finalEdgeIndex,
        ctx.simulationTime ?? 0
      );
    }

    // Edge 전환 완료 - 경로에서 지나간 Edge 제거
    if (out.finalEdgeIndex !== currentEdgeIndex) {
      const passedEdge = ctx.edgeArray[out.finalEdgeIndex];
      if (passedEdge) {
        ctx.transferMgr.onEdgeTransition(vehicleIndex, passedEdge.edge_name);
      }
    }
  } else {
    // Just update position on current edge
    out.finalEdgeIndex = currentEdgeIndex;
    out.finalRatio = rawNewRatio;
    out.activeEdge = currentEdge;
  }
}

function checkAndReleaseMergeLock(
  lockMgr: LockMgr,
  finalEdgeIndex: number,
  currentEdgeIndex: number,
  currentEdge: Edge,
  vehId: number
) {
  if (finalEdgeIndex === currentEdgeIndex) return;
  const prevToNode = currentEdge.to_node;
  if (lockMgr.isMergeNode(prevToNode)) {
    lockMgr.releaseLock(prevToNode, vehId);
  }
}

function checkTargetReached(
  rawNewRatio: number,
  targetRatio: number,
  currentVelocity: number,
  out: typeof SCRATCH_TARGET_CHECK
) {
  if (rawNewRatio >= targetRatio) {
    out.finalRatio = targetRatio;
    out.finalVelocity = 0;
    out.reached = true;
  } else {
    out.finalRatio = rawNewRatio;
    out.finalVelocity = currentVelocity;
    out.reached = false;
  }
}

function processSameEdgeLogic(
  isSameEdge: boolean,
  rawNewRatio: number,
  targetRatio: number,
  currentVelocity: number,
  data: Float32Array,
  ptr: number,
  out: typeof SCRATCH_TARGET_CHECK
): boolean {
  if (!isSameEdge) {
    return false;
  }

  checkTargetReached(rawNewRatio, targetRatio, currentVelocity, out);

  if (out.reached) {
    data[ptr + MovementData.MOVING_STATUS] = MovingStatus.STOPPED;
  }

  return true;
}
