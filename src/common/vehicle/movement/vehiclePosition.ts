// common/vehicle/movement/vehiclePosition.ts

import {
  MovementData,
  LogicData,
  StopReason,
  TrafficState,
} from "@/common/vehicle/initialize/constants";
import { interpolatePositionTo, type PositionResult } from "./positionInterpolator";
import type { LockMgr } from "@/common/vehicle/logic/LockMgr";
import type { Edge } from "@/types/edge";
import { EdgeType } from "@/types";
import type { VehicleTransitionResult } from "./vehicleTransition";
import type { MovementUpdateContext } from "./movementUpdate";

// ============================================================================
// 위치 계산 결과 타입
// ============================================================================

export interface VehiclePositionResult {
  /** 최종 X 좌표 */
  finalX: number;
  /** 최종 Y 좌표 */
  finalY: number;
  /** 최종 Z 좌표 */
  finalZ: number;
  /** 최종 회전값 */
  finalRotation: number;
  /** 최종 Edge 비율 (merge 대기로 조정될 수 있음) */
  finalRatio: number;
  /** 최종 속도 (merge 대기 시 0) */
  finalVelocity: number;
}

// Zero-GC Scratchpads
const SCRATCH_POS: PositionResult = {
  x: 0,
  y: 0,
  z: 0,
  rotation: 0,
};

const SCRATCH_MERGE_POS: PositionResult = {
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
// 실제 좌표 계산 및 merge 대기 처리
// ============================================================================

/**
 * Phase 3: 차량의 실제 좌표를 계산합니다.
 *
 * ## 왜 interpolatePositionTo를 2번 호출하는가?
 *
 * ### 1차 호출 (394-400줄)
 * - Edge transition 후의 기본 위치 계산
 * - finalRatio에 해당하는 실제 좌표(x, y, z, rotation) 계산
 *
 * ### 2차 호출 (418-424줄) - Merge 대기 시에만
 * - 차량이 대기 지점을 넘어간 경우에만 발생
 * - finalRatio가 대기 지점으로 변경되므로 좌표를 다시 계산해야 함
 *
 * #### 예시:
 * ```
 * 1. 속도 계산 후: finalRatio=0.85
 * 2. 1차 interpolatePositionTo(0.85) → 위치 A
 * 3. Merge 대기 체크: 대기 지점이 0.80
 * 4. shouldWait=true, finalRatio를 0.80으로 되돌림
 * 5. 2차 interpolatePositionTo(0.80) → 위치 B (대기 지점)
 * 6. 결과: 차량은 위치 B에 멈춤
 * ```
 *
 * @param ctx Movement 업데이트 컨텍스트
 * @param vehicleIndex 차량 인덱스
 * @param data Float32Array 데이터
 * @param ptr 차량 데이터 포인터
 * @param transition 이전 단계의 전환 결과
 * @param out 결과를 저장할 scratchpad
 * @returns out 참조
 */
export function updateVehiclePosition(
  ctx: MovementUpdateContext,
  vehicleIndex: number,
  data: Float32Array,
  ptr: number,
  transition: VehicleTransitionResult,
  out: VehiclePositionResult
): VehiclePositionResult {
  const { edgeArray, lockMgr, config } = ctx;
  const { finalEdgeIndex, activeEdge } = transition;
  let { finalRatio, finalVelocity } = transition;

  // 기본 좌표값 (이전 값 유지)
  let finalX = data[ptr + MovementData.X];
  let finalY = data[ptr + MovementData.Y];
  let finalZ = data[ptr + MovementData.Z];
  let finalRotation = data[ptr + MovementData.ROTATION];

  // 1차 위치 보간: Edge transition 후 기본 위치 계산
  if (activeEdge) {
    interpolatePositionTo(activeEdge, finalRatio, SCRATCH_POS, config.vehicleZOffset);
    finalX = SCRATCH_POS.x;
    finalY = SCRATCH_POS.y;
    finalZ = SCRATCH_POS.z;
    finalRotation = SCRATCH_POS.rotation;
  }

  // Merge 대기 처리
  const finalEdge = edgeArray[finalEdgeIndex];
  const shouldWait = checkAndProcessMergeWait(
    lockMgr,
    finalEdge,
    vehicleIndex,
    finalRatio,
    data,
    ptr,
    SCRATCH_MERGE_POS
  );

  if (shouldWait) {
    // 차량이 대기 지점을 넘어간 경우: 대기 지점으로 되돌림
    finalRatio = SCRATCH_MERGE_POS.x;  // 새로운 ratio (대기 지점)

    // DEBUG: Merge 대기로 속도 0
    if (finalVelocity > 0) {
      console.warn(`[DEBUG] MERGE 대기로 정지: veh=${vehicleIndex}, edge=${finalEdge.edge_name}, ` +
        `ratio=${finalRatio.toFixed(3)}, vel=${finalVelocity.toFixed(2)}`);
    }

    // 2차 위치 보간: 변경된 ratio에 맞는 좌표 재계산
    if (activeEdge) {
      interpolatePositionTo(activeEdge, finalRatio, SCRATCH_POS, config.vehicleZOffset);
      finalX = SCRATCH_POS.x;
      finalY = SCRATCH_POS.y;
      finalZ = SCRATCH_POS.z;
      finalRotation = SCRATCH_POS.rotation;
    }
    finalVelocity = 0;  // 대기 중이므로 속도 0
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
// Helper Functions
// ============================================================================

function checkAndProcessMergeWait(
  lockMgr: LockMgr,
  finalEdge: Edge,
  vehIdx: number,
  ratio: number,
  data: Float32Array,
  ptr: number,
  outPos: PositionResult
): boolean {
  const shouldWait = processMergeLogicInline(
    lockMgr,
    finalEdge,
    vehIdx,
    ratio,
    data,
    ptr,
    outPos
  );

  return shouldWait;
}

/**
 * Merge 대기 로직 처리
 *
 * @returns true = 대기 필요 (차량이 대기 지점을 넘어가서 위치 조정 필요)
 *          false = 대기 불필요 (통과 가능 또는 대기 지점 도달 전)
 *
 * ## 중요: return true일 때 위치 재계산이 필요한 이유
 *
 * 차량이 속도 계산 후 대기 지점(waitDistance)을 넘어갔을 때:
 * 1. target.x에 대기 지점의 ratio를 설정 (차량을 뒤로 당김)
 * 2. 호출자는 이 새로운 ratio로 interpolatePositionTo를 재호출해야 함
 *
 * 예시:
 * - 현재 위치: ratio=0.75
 * - 속도 계산 후: ratio=0.85 (너무 멀리 감)
 * - 대기 지점: waitDist=0.80
 * - 결과: target.x=0.80으로 설정, return true
 * - 호출자: ratio를 0.80으로 변경하고 좌표 재계산 필요
 */
function processMergeLogicInline(
  lockMgr: LockMgr,
  currentEdge: Edge,
  vehId: number,
  currentRatio: number,
  data: Float32Array,
  ptr: number,
  target: PositionResult
): boolean {
  // Merge Node가 아니면 자유 통행
  if (!lockMgr.isMergeNode(currentEdge.to_node)) {
    const currentReason = data[ptr + LogicData.STOP_REASON];
    if ((currentReason & StopReason.LOCKED) !== 0) {
      data[ptr + LogicData.STOP_REASON] = currentReason & ~StopReason.LOCKED;
    }
    data[ptr + LogicData.TRAFFIC_STATE] = TrafficState.FREE;
    return false;
  }

  // 이미 ACQUIRED 상태면 바로 통과 (곡선 merge edge에서 미리 lock 획득한 경우)
  const currentTrafficState = data[ptr + LogicData.TRAFFIC_STATE];
  if (currentTrafficState === TrafficState.ACQUIRED) {
    // 혹시 모를 LOCKED 플래그 제거
    const currentReason = data[ptr + LogicData.STOP_REASON];
    if ((currentReason & StopReason.LOCKED) !== 0) {
      data[ptr + LogicData.STOP_REASON] = currentReason & ~StopReason.LOCKED;
    }
    return false;
  }

  // Lock 요청 시점 계산
  // requestDistance가 -1이면 진입 즉시 요청 (무조건 shouldRequest = true)
  const requestDistance = lockMgr.getRequestDistance();
  let shouldRequest = true;
  if (requestDistance >= 0 && currentEdge.vos_rail_type === EdgeType.LINEAR && currentEdge.distance >= requestDistance) {
    const distToNode = currentEdge.distance * (1 - currentRatio);
    if (distToNode > requestDistance) {
      shouldRequest = false;
    }
  }

  // 아직 요청 시점이 아니면 FREE 유지하고 통과
  if (!shouldRequest) {
    const currentReason = data[ptr + LogicData.STOP_REASON];
    if ((currentReason & StopReason.LOCKED) !== 0) {
      data[ptr + LogicData.STOP_REASON] = currentReason & ~StopReason.LOCKED;
    }
    data[ptr + LogicData.TRAFFIC_STATE] = TrafficState.FREE;
    return false;
  }

  // 요청 시점 도달 - Lock 요청 (FREE일 때만, 중복 요청 방지)
  if (currentTrafficState === TrafficState.FREE) {
    lockMgr.requestLock(currentEdge.to_node, currentEdge.edge_name, vehId);
  }

  // Lock 획득 여부 확인
  const isGranted = lockMgr.checkGrant(currentEdge.to_node, vehId);
  const currentReason = data[ptr + LogicData.STOP_REASON];

  if (isGranted) {
    // Lock 획득 성공 - 통과 가능
    if ((currentReason & StopReason.LOCKED) !== 0) {
      data[ptr + LogicData.STOP_REASON] = currentReason & ~StopReason.LOCKED;
    }
    data[ptr + LogicData.TRAFFIC_STATE] = TrafficState.ACQUIRED;
    return false;
  }

  // Lock 획득 실패 - 대기 상태
  data[ptr + LogicData.TRAFFIC_STATE] = TrafficState.WAITING;

  // 곡선 Edge에서는 대기 지점으로 되돌리지 않음 (곡선에서 급정지 방지)
  // Lock은 필요하지만, 곡선 끝까지는 부드럽게 진행하고 Edge 전환만 막음
  // if (currentEdge.vos_rail_type !== EdgeType.LINEAR) {
  //   // WAITING 상태는 유지하되, 위치 되돌림은 하지 않음
  //   if ((currentReason & StopReason.LOCKED) !== 0) {
  //     data[ptr + LogicData.STOP_REASON] = currentReason & ~StopReason.LOCKED;
  //   }
  //   return false;
  // }

  const waitDist = lockMgr.getWaitDistance(currentEdge);
  const currentDist = currentRatio * currentEdge.distance;

  // 핵심: 차량이 대기 지점을 넘어갔는지 체크
  if (currentDist >= waitDist) {
    // 차량이 너무 멀리 갔으므로 대기 지점으로 되돌림
    data[ptr + LogicData.STOP_REASON] = currentReason | StopReason.LOCKED;
    // target.x에 새로운 ratio를 저장 (호출자가 위치 재계산에 사용)
    target.x = waitDist / currentEdge.distance;
    return true; // 위치 재계산 필요!
  }

  // 대기 지점 이전이면 현재 위치 유지
  if ((currentReason & StopReason.LOCKED) !== 0) {
    data[ptr + LogicData.STOP_REASON] = currentReason & ~StopReason.LOCKED;
  }

  return false;
}
