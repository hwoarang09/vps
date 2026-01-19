// common/vehicle/movement/vehiclePosition.ts

import {
  MovementData,
  LogicData,
  StopReason,
  TrafficState,
} from "@/common/vehicle/initialize/constants";
import { interpolatePositionTo, type PositionResult } from "./positionInterpolator";
import { devLog } from "@/logger/DevLogger";
import type { LockMgr } from "@/common/vehicle/logic/LockMgr";
import type { Edge } from "@/types/edge";
import { EdgeType } from "@/types";
import type { VehicleTransitionResult } from "./vehicleTransition";
import type { MovementUpdateContext } from "./movementUpdate";

// ============================================================================
// 로그 중복 방지를 위한 상태 추적
// ============================================================================
interface MergeLockLogState {
  lastMergeNode: string;
  lastRequestEdge: string;
  lastIsGranted: boolean;
  lastLogTime: number;
}
const mergeLockLogStates = new Map<number, MergeLockLogState>();
const LOG_THROTTLE_MS = 2000; // 같은 상태일 때 2초마다만 로그

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

// ============================================================================
// Lock 관련 헬퍼 함수
// ============================================================================

/** 합류 타입 */
export type MergeType = 'STRAIGHT' | 'CURVE';

/** 합류 타겟 정보 */
export interface MergeTarget {
  type: MergeType;
  mergeNode: string;
  requestEdge: string;      // lock 요청 시 사용할 edge 이름 (merge node의 incoming edge)
  distanceToMerge: number;  // 현재 위치에서 합류점까지의 누적 거리
  requestDistance: number;  // lock 요청 거리 (설정값)
  waitDistance: number;     // 대기 거리 (설정값)
}

/** Next Edge 오프셋 배열 */
const NEXT_EDGE_OFFSETS = [
  MovementData.NEXT_EDGE_0,
  MovementData.NEXT_EDGE_1,
  MovementData.NEXT_EDGE_2,
  MovementData.NEXT_EDGE_3,
  MovementData.NEXT_EDGE_4,
];

/**
 * 경로를 따라가면서 모든 합류점 찾기
 * - 현재 위치에서 합류점까지의 누적 거리 계산
 * - 직선/곡선 합류 타입 결정
 */
function findAllMergeTargets(
  lockMgr: LockMgr,
  edgeArray: Edge[],
  currentEdge: Edge,
  currentRatio: number,
  data: Float32Array,
  ptr: number
): MergeTarget[] {
  const targets: MergeTarget[] = [];

  // 현재 edge 남은 거리
  let accumulatedDist = currentEdge.distance * (1 - currentRatio);

  // 1. currentEdge.tn 확인 (직선 합류)
  if (lockMgr.isMergeNode(currentEdge.to_node)) {
    targets.push({
      type: 'STRAIGHT',
      mergeNode: currentEdge.to_node,
      requestEdge: currentEdge.edge_name,  // 현재 edge가 merge node로 직접 들어감
      distanceToMerge: accumulatedDist,
      requestDistance: lockMgr.getRequestDistanceFromMergingStr(),
      waitDistance: lockMgr.getWaitDistanceFromMergingStr(),
    });
  }

  // 2. nextEdge들 순회 (최대 5개)
  for (const offset of NEXT_EDGE_OFFSETS) {
    const nextEdgeIdx = data[ptr + offset];
    if (nextEdgeIdx < 0) break;

    const nextEdge = edgeArray[nextEdgeIdx];
    if (!nextEdge) break;

    // 곡선이고 tn이 합류점이면 → 곡선 합류
    if (nextEdge.vos_rail_type !== EdgeType.LINEAR && lockMgr.isMergeNode(nextEdge.to_node)) {
      // e8 곡선 합류 디버그 로그
      if (nextEdge.edge_name === 'e8') {
        devLog.debug(`[MERGE_TARGET] 곡선 합류 타겟 발견: currentEdge=${currentEdge.edge_name}, nextEdge=e8, mergeNode=${nextEdge.to_node}, distanceToMerge=${accumulatedDist.toFixed(2)}, requestDist=${lockMgr.getRequestDistanceFromMergingCurve()}`);
      }
      targets.push({
        type: 'CURVE',
        mergeNode: nextEdge.to_node,
        requestEdge: nextEdge.edge_name,  // 곡선 edge가 merge node로 들어감
        distanceToMerge: accumulatedDist, // 곡선의 fn까지 거리 (현재 edge 끝까지 거리)
        requestDistance: lockMgr.getRequestDistanceFromMergingCurve(),
        waitDistance: lockMgr.getWaitDistanceFromMergingCurve(),
      });
    }
    // 직선이고 tn이 합류점이면 → 직선 합류
    else if (lockMgr.isMergeNode(nextEdge.to_node)) {
      targets.push({
        type: 'STRAIGHT',
        mergeNode: nextEdge.to_node,
        requestEdge: nextEdge.edge_name,  // 직선 edge가 merge node로 들어감
        distanceToMerge: accumulatedDist + nextEdge.distance, // edge 끝까지 거리
        requestDistance: lockMgr.getRequestDistanceFromMergingStr(),
        waitDistance: lockMgr.getWaitDistanceFromMergingStr(),
      });
    }

    accumulatedDist += nextEdge.distance;
  }

  return targets;
}

/**
 * Lock 요청 시점 판단
 * - 합류점까지의 누적 거리가 requestDistance 이하일 때 요청
 */
function shouldRequestLockNow(
  distanceToMerge: number,
  requestDistance: number
): boolean {
  if (requestDistance < 0) {
    return true;
  }
  return distanceToMerge <= requestDistance;
}

/**
 * 대기 지점의 ratio 계산
 * - 합류점까지의 누적 거리에서 waitDistance를 뺀 위치
 */
function getWaitRatio(
  currentEdge: Edge,
  currentRatio: number,
  distanceToMerge: number,
  waitDistance: number
): number {
  // 대기 지점까지의 거리 = distanceToMerge - waitDistance
  const distanceToWait = distanceToMerge - waitDistance;
  if (distanceToWait <= 0) {
    return 0; // 이미 대기 지점을 지남
  }

  // 현재 edge 남은 거리
  const remainingInCurrentEdge = currentEdge.distance * (1 - currentRatio);

  // 대기 지점이 현재 edge 내에 있는지 확인
  if (distanceToWait <= remainingInCurrentEdge) {
    // 현재 edge 내에 대기 지점이 있음
    // waitRatio = currentRatio + (remainingInCurrentEdge - distanceToWait) / currentEdge.distance
    // 간단히: waitRatio = 1 - distanceToWait / currentEdge.distance
    return 1 - distanceToWait / currentEdge.distance;
  }

  // 대기 지점이 현재 edge 밖에 있음 (다음 edge에 있음)
  // 현재 edge에서는 대기할 필요 없음 → ratio 1 반환 (edge 끝까지 갈 수 있음)
  return 1;
}

/** Blocking merge 결과 (lock 못 받은 첫 번째 merge) */
export interface BlockingMergeResult {
  mergeTarget: MergeTarget;
  distanceToWait: number;  // 대기 지점까지의 거리
}

/**
 * 경로상의 모든 merge 중 lock을 못 받은 첫 번째 merge를 찾습니다.
 * - 가까운 merge부터 순서대로 체크
 * - lock 획득 성공한 merge는 건너뜀
 * - lock 미획득 merge를 찾으면 해당 merge 반환
 *
 * @returns 첫 번째 blocking merge 정보, 없으면 null
 */
export function findFirstBlockingMerge(
  lockMgr: LockMgr,
  edgeArray: Edge[],
  currentEdge: Edge,
  currentRatio: number,
  vehId: number,
  data: Float32Array,
  ptr: number
): BlockingMergeResult | null {
  // 곡선에서는 이미 lock 처리가 끝난 상태로 간주
  if (currentEdge.vos_rail_type !== EdgeType.LINEAR) {
    return null;
  }

  const mergeTargets = findAllMergeTargets(
    lockMgr,
    edgeArray,
    currentEdge,
    currentRatio,
    data,
    ptr
  );

  for (const target of mergeTargets) {
    // 아직 request 지점에 도달 안 했으면 skip (아직 lock 요청 전)
    if (!shouldRequestLockNow(target.distanceToMerge, target.requestDistance)) {
      continue;
    }

    // Lock 획득 여부 확인 (request는 vehiclePosition의 processMergeLogicInline에서 처리됨)
    const isGranted = lockMgr.checkGrant(target.mergeNode, vehId);

    if (!isGranted) {
      // 이 merge가 첫 번째 blocking merge
      const distanceToWait = target.distanceToMerge - target.waitDistance;
      return {
        mergeTarget: target,
        distanceToWait: Math.max(0, distanceToWait)
      };
    }
    // lock 획득 성공 → 다음 merge 체크
  }

  // 모든 merge에서 lock 획득 성공 (또는 아직 request 지점에 도달 안 함)
  return null;
}

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
    edgeArray,
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
  edgeArray: Edge[],
  finalEdge: Edge,
  vehIdx: number,
  ratio: number,
  data: Float32Array,
  ptr: number,
  outPos: PositionResult
): boolean {
  const shouldWait = processMergeLogicInline(
    lockMgr,
    edgeArray,
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
 * ## 핵심 로직
 * - **항상 직선 위에서만** lock 요청 여부를 계산
 * - 경로 전체(NEXT_EDGE_0~4)를 탐색해서 합류점 찾기
 * - 각 합류점까지의 **누적 거리** 기반으로 request/wait 판단
 * - 순차적으로 처리: 먼저 도달하는 합류점부터 처리
 */
function processMergeLogicInline(
  lockMgr: LockMgr,
  edgeArray: Edge[],
  currentEdge: Edge,
  vehId: number,
  currentRatio: number,
  data: Float32Array,
  ptr: number,
  target: PositionResult
): boolean {
  // 곡선 위에서는 기본적으로 lock 계산 안 함 (이미 이전 직선에서 lock을 획득한 상태)
  // 단, 곡선→곡선→합류 케이스는 별도 처리
  if (currentEdge.vos_rail_type !== EdgeType.LINEAR) {
    const currentTrafficState = data[ptr + LogicData.TRAFFIC_STATE];

    // ACQUIRED 상태면 그대로 유지
    if (currentTrafficState === TrafficState.ACQUIRED) {
      return false;
    }

    // 곡선→곡선→합류 케이스 처리
    // 현재 곡선의 다음이 곡선이고, 그 곡선의 tn이 합류노드인 경우
    const nextEdgeIdx = data[ptr + MovementData.NEXT_EDGE_0];
    if (nextEdgeIdx >= 0) {
      const nextEdge = edgeArray[nextEdgeIdx];
      if (nextEdge &&
          nextEdge.vos_rail_type !== EdgeType.LINEAR &&  // 다음도 곡선
          lockMgr.isMergeNode(nextEdge.to_node)) {       // 그 곡선의 tn이 합류노드

        // 현재 곡선의 남은 거리로 lock 요청 시점 판단
        const remainingDist = currentEdge.distance * (1 - currentRatio);
        const requestDist = lockMgr.getRequestDistanceFromMergingCurve();

        if (remainingDist <= requestDist) {
          // lock 요청 (현재 곡선 끝 = 다음 곡선 시작에서)
          lockMgr.requestLock(nextEdge.to_node, nextEdge.edge_name, vehId);
          const isGranted = lockMgr.checkGrant(nextEdge.to_node, vehId);

          devLog.veh(vehId).debug(
            `[CURVE_CURVE_MERGE] currentEdge=${currentEdge.edge_name}, nextEdge=${nextEdge.edge_name}, ` +
            `mergeNode=${nextEdge.to_node}, remainingDist=${remainingDist.toFixed(2)}, isGranted=${isGranted}`
          );

          if (!isGranted) {
            data[ptr + LogicData.TRAFFIC_STATE] = TrafficState.WAITING;
            // mergeBraking에서 감속 처리됨
            return false;
          }
          data[ptr + LogicData.TRAFFIC_STATE] = TrafficState.ACQUIRED;
        }
      }
    }

    // 곡선에서 WAITING이면 edge 끝까지 진행은 허용 (급정지 방지)
    return false;
  }

  // 경로 전체를 탐색해서 합류점 찾기
  const mergeTargets = findAllMergeTargets(
    lockMgr,
    edgeArray,
    currentEdge,
    currentRatio,
    data,
    ptr
  );

  // 합류점이 없으면 자유 통행
  if (mergeTargets.length === 0) {
    const currentReason = data[ptr + LogicData.STOP_REASON];
    if ((currentReason & StopReason.LOCKED) !== 0) {
      data[ptr + LogicData.STOP_REASON] = currentReason & ~StopReason.LOCKED;
    }
    data[ptr + LogicData.TRAFFIC_STATE] = TrafficState.FREE;
    return false;
  }

  const currentTrafficState = data[ptr + LogicData.TRAFFIC_STATE];
  const currentReason = data[ptr + LogicData.STOP_REASON];

  // 각 merge target을 순차적으로 처리
  // 먼저 도달하는 request 지점의 lock부터 처리하고, 못 받으면 해당 wait 지점에서 대기
  for (const mergeTarget of mergeTargets) {
    const shouldRequest = shouldRequestLockNow(mergeTarget.distanceToMerge, mergeTarget.requestDistance);

    if (!shouldRequest) {
      // 아직 이 target의 request 지점에 도달 안 함 → 다음 target 확인
      continue;
    }

    // 요청 시점 도달 - Lock 요청 (중복 요청은 requestLock 내부에서 방지됨)
    lockMgr.requestLock(mergeTarget.mergeNode, mergeTarget.requestEdge, vehId);

    // Lock 획득 여부 확인
    const isGranted = lockMgr.checkGrant(mergeTarget.mergeNode, vehId);

    // 로그 중복 방지: 상태 변경 또는 일정 시간 경과 시에만 로그
    if (mergeTarget.type === 'CURVE') {
      const now = Date.now();
      const prevLogState = mergeLockLogStates.get(vehId);
      const stateChanged = !prevLogState ||
        prevLogState.lastMergeNode !== mergeTarget.mergeNode ||
        prevLogState.lastRequestEdge !== mergeTarget.requestEdge ||
        prevLogState.lastIsGranted !== isGranted;
      const timeElapsed = !prevLogState || (now - prevLogState.lastLogTime) >= LOG_THROTTLE_MS;

      if (stateChanged || timeElapsed) {
        devLog.veh(vehId).debug(`[MERGE_LOCK] 곡선 합류 락: currentEdge=${currentEdge.edge_name}, requestEdge=${mergeTarget.requestEdge}, mergeNode=${mergeTarget.mergeNode}, isGranted=${isGranted}, dist=${mergeTarget.distanceToMerge.toFixed(2)}`);
        mergeLockLogStates.set(vehId, {
          lastMergeNode: mergeTarget.mergeNode,
          lastRequestEdge: mergeTarget.requestEdge,
          lastIsGranted: isGranted,
          lastLogTime: now,
        });
      }
    }

    if (!isGranted) {
      // Lock 획득 실패 - 이 target의 wait 지점에서 대기
      data[ptr + LogicData.TRAFFIC_STATE] = TrafficState.WAITING;

      // 대기 지점 계산: distanceToWait <= 0 이면 이미 대기 지점을 지남
      const distanceToWait = mergeTarget.distanceToMerge - mergeTarget.waitDistance;

      if (distanceToWait <= 0) {
        // 대기 지점을 넘어갔으면 되돌림
        // waitRatio = currentRatio + (distanceToWait / currentEdge.distance)
        // distanceToWait가 음수이므로 waitRatio < currentRatio
        const waitRatio = currentRatio + distanceToWait / currentEdge.distance;

        if (waitRatio < 0) {
          // 대기 지점이 현재 edge 밖 (이전 edge)에 있음 - 여기까지 오면 안 됨
          devLog.veh(vehId).error(
            `[MERGE_WAIT] BUG: 대기지점이 현재 edge 이전에 있음! mergeNode=${mergeTarget.mergeNode}, ` +
            `currentEdge=${currentEdge.edge_name}, waitRatio=${waitRatio.toFixed(3)}`
          );
          // edge 시작점에서 대기 (fallback)
          data[ptr + LogicData.STOP_REASON] = currentReason | StopReason.LOCKED;
          target.x = 0;
          return true;
        }

        devLog.veh(vehId).debug(
          `[MERGE_WAIT] 대기지점 되돌림: mergeNode=${mergeTarget.mergeNode}, ` +
          `currentRatio=${currentRatio.toFixed(3)} → waitRatio=${waitRatio.toFixed(3)}, ` +
          `distToWait=${distanceToWait.toFixed(2)}`
        );

        data[ptr + LogicData.STOP_REASON] = currentReason | StopReason.LOCKED;
        target.x = waitRatio;
        return true;
      }

      // 대기 지점 이전이면 현재 위치 유지
      if ((currentReason & StopReason.LOCKED) !== 0) {
        data[ptr + LogicData.STOP_REASON] = currentReason & ~StopReason.LOCKED;
      }
      return false;
    }

    // 이 target의 lock 획득 성공 → 다음 target 확인
  }

  // 모든 도달한 target의 lock 획득 성공 (또는 아직 어떤 request 지점에도 도달 안 함)
  if ((currentReason & StopReason.LOCKED) !== 0) {
    data[ptr + LogicData.STOP_REASON] = currentReason & ~StopReason.LOCKED;
  }

  // 하나라도 request 지점에 도달했고 lock 받았으면 ACQUIRED, 아니면 FREE 유지
  const anyRequested = mergeTargets.some(t => shouldRequestLockNow(t.distanceToMerge, t.requestDistance));
  const newState = anyRequested ? TrafficState.ACQUIRED : TrafficState.FREE;

  // 디버그: 곡선 합류 시 trafficState 변경
  const hasCurveMerge = mergeTargets.some(t => t.type === 'CURVE');
  if (hasCurveMerge && newState !== currentTrafficState) {
    const prevStr = currentTrafficState === TrafficState.FREE ? 'FREE' : currentTrafficState === TrafficState.ACQUIRED ? 'ACQUIRED' : currentTrafficState === TrafficState.WAITING ? 'WAITING' : `UNKNOWN(${currentTrafficState})`;
    const newStr = newState === TrafficState.FREE ? 'FREE' : newState === TrafficState.ACQUIRED ? 'ACQUIRED' : 'WAITING';
    const targetNodes = mergeTargets.map(t => `${t.mergeNode}(${t.type},${t.requestEdge})`).join(', ');
    devLog.veh(vehId).debug(`[TRAFFIC_STATE] ${prevStr} → ${newStr}, targets=[${targetNodes}]`);
  }

  data[ptr + LogicData.TRAFFIC_STATE] = newState;

  return false;
}
