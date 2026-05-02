// common/vehicle/movement/mergeBraking.ts
// 합류점 사전 감속 체크
//
// 목표: LOCK_WAIT CP를 본인이 holder 아닌 채 다가가는 차량은 사전 감속 →
//       CP 도달 시 velocity ≈ 0 → tick overshoot 최소화

import type { Edge } from "@/types/edge";
import type { MovementConfig } from "./movementUpdate";
import type { LockMgr } from "@/common/vehicle/logic/LockMgr/index";
import {
  CheckpointFlags,
  LogicData,
  MovementData,
  NEXT_EDGE_COUNT,
} from "@/common/vehicle/initialize/constants";

export interface MergeBrakeCheckResult {
  shouldBrake: boolean;
  deceleration: number;
  distanceToMerge: number;
}

const NO_BRAKE: MergeBrakeCheckResult = {
  shouldBrake: false,
  deceleration: 0,
  distanceToMerge: Infinity,
};

/**
 * 차량 currentEdge부터 cpEdge까지 잔여 거리 계산
 * - currentEdge === cpEdge: (cpRatio - currentRatio) * currentEdge.distance
 * - currentEdge != cpEdge: (1 - currentRatio) * currentEdge.distance + 사이 edges + cpRatio * cpEdge.distance
 *   (NEXT_EDGE_0~4에서 cpEdge 찾음, 못 찾으면 -1 반환)
 */
function distanceToCp(
  currentEdge: Edge,
  currentRatio: number,
  cpEdgeIdx: number,
  cpRatio: number,
  edgeArray: Edge[],
  data: Float32Array,
  ptr: number,
  currentEdgeIdx: number
): number {
  const cpEdge = cpEdgeIdx >= 1 ? edgeArray[cpEdgeIdx - 1] : undefined;
  if (!cpEdge) return -1;

  // Same edge
  if (currentEdgeIdx === cpEdgeIdx) {
    return (cpRatio - currentRatio) * currentEdge.distance;
  }

  // Multi-edge: NEXT_EDGE_0~4 traversal
  let dist = (1 - currentRatio) * currentEdge.distance;
  for (let i = 0; i < NEXT_EDGE_COUNT; i++) {
    const nextIdx = Math.trunc(data[ptr + MovementData.NEXT_EDGE_0 + i]);
    if (nextIdx < 1) return -1; // 더 이상 next 없음, cpEdge 못 찾음
    if (nextIdx === cpEdgeIdx) {
      dist += cpRatio * cpEdge.distance;
      return dist;
    }
    const nextEdge = edgeArray[nextIdx - 1];
    if (!nextEdge) return -1;
    dist += nextEdge.distance;
  }
  return -1; // NEXT_EDGE_0~4 안에 cpEdge 없음
}

/**
 * 합류점 사전 감속 체크
 *
 * 트리거 조건:
 * 1. CURRENT_CP_FLAGS에 LOCK_WAIT 비트.
 * 2. 본인이 lock holder 아님 (holder면 통과 가능).
 * 3. DZ gate 처리 차량 아님 (gate가 별도 stop).
 * 4. WAIT CP까지 잔여 거리 <= 정지 거리 (v² / 2a).
 */
export function checkMergePreBraking({
  vehId,
  currentEdge,
  currentRatio,
  currentVelocity,
  edgeArray,
  lockMgr,
  config,
  data,
  ptr,
}: {
  vehId: number;
  currentEdge: Edge;
  currentRatio: number;
  currentVelocity: number;
  edgeArray: Edge[];
  lockMgr: LockMgr;
  config: MovementConfig;
  data: Float32Array;
  ptr: number;
}): MergeBrakeCheckResult {
  if (currentVelocity <= 0) return NO_BRAKE;

  const cpFlags = Math.trunc(data[ptr + LogicData.CURRENT_CP_FLAGS]);
  if (!(cpFlags & CheckpointFlags.LOCK_WAIT)) return NO_BRAKE;

  const targetEdgeIdx = Math.trunc(data[ptr + LogicData.CURRENT_CP_TARGET]);
  if (targetEdgeIdx < 1) return NO_BRAKE;
  const targetEdge = edgeArray[targetEdgeIdx - 1];
  if (!targetEdge) return NO_BRAKE;

  const nodeName = targetEdge.from_node;

  // Deadlock zone merge → gate 처리, brake 안 함
  if (lockMgr.isDeadlockZoneMerge(nodeName)) return NO_BRAKE;

  // 본인이 holder여도 사전 감속은 함 — 다른 incoming의 mergeZoneCollision sensor stop 방지
  // (holder면 WAIT CP 통과 후 다시 가속됨)
  const isHolder = lockMgr.isLockHolder(nodeName, vehId);

  const cpEdgeIdx = Math.trunc(data[ptr + LogicData.CURRENT_CP_EDGE]);
  if (cpEdgeIdx < 1) return NO_BRAKE;
  const cpRatio = data[ptr + LogicData.CURRENT_CP_RATIO];
  const currentEdgeIdx = Math.trunc(data[ptr + MovementData.CURRENT_EDGE]);

  // WAIT CP까지 잔여 거리
  const distToWait = distanceToCp(
    currentEdge,
    currentRatio,
    cpEdgeIdx,
    cpRatio,
    edgeArray,
    data,
    ptr,
    currentEdgeIdx
  );
  if (distToWait < 0) return NO_BRAKE; // CP 위치 모름
  if (distToWait <= 0) return NO_BRAKE; // 이미 통과 (overshoot 발생)

  // 필요 감속도: 목표 속도 vTarget까지 distToWait 안에 줄이려면 얼마의 감속도 필요한가
  // - holder: WAIT CP에서 통과하므로 약간 느려져도 OK (mergeZoneCollision STOP 방지 용도)
  //   → 곡선 진입 속도(curveMaxSpeed) 정도까지만 줄임
  // - 일반: WAIT CP에서 정지해야 함 → vTarget = 0
  const preBrakeDecel = config.linearPreBrakeDeceleration ?? -2;
  const vTarget = isHolder ? Math.min(currentVelocity, config.curveMaxSpeed ?? 1.0) : 0;
  if (currentVelocity <= vTarget) return NO_BRAKE; // 이미 충분히 느림

  // requiredDecel = -(v² - vTarget²) / (2s)
  const vSqDiff = currentVelocity * currentVelocity - vTarget * vTarget;
  const requiredDecel = -(vSqDiff / (2 * distToWait));

  // requiredDecel이 preBrakeDecel보다 약하면(절댓값 작으면) 아직 여유 있음 → brake 안 함
  if (requiredDecel > preBrakeDecel) {
    return NO_BRAKE;
  }

  return {
    shouldBrake: true,
    deceleration: requiredDecel, // 적정 감속도 적용 (정지 또는 vTarget 도달)
    distanceToMerge: distToWait,
  };
}
