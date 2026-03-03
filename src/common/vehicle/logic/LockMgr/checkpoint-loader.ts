// LockMgr/checkpoint-loader.ts
// Checkpoint 로드 및 검증 로직

import {
  CHECKPOINT_SECTION_SIZE,
  CHECKPOINT_FIELDS,
  MovementData,
  LogicData,
  VEHICLE_DATA_SIZE,
  NEXT_EDGE_COUNT,
} from "@/common/vehicle/initialize/constants";
import type { CheckpointState, ReachCheckResult, LockMgrState } from "./types";

// Scratch objects - 매 프레임 재사용 (GC 방지)
const _cpState: CheckpointState = { edge: 0, ratio: 0, flags: 0, target: 0 };
const _reachResult: ReachCheckResult = { reached: false, missed: false, waiting: true };

/**
 * Checkpoint가 로드되어 있는지 확인하고, 없으면 로드
 * @returns CheckpointState 또는 null (더 이상 checkpoint 없음)
 */
export function ensureCheckpointLoaded(
  vehicleId: number,
  state: LockMgrState
): CheckpointState | null {
  if (!state.vehicleDataArray || !state.checkpointArray) return null;

  const data = state.vehicleDataArray;
  const ptr = vehicleId * VEHICLE_DATA_SIZE;

  let cpEdge = data[ptr + LogicData.CURRENT_CP_EDGE];
  let cpRatio = data[ptr + LogicData.CURRENT_CP_RATIO];
  let cpFlags = data[ptr + LogicData.CURRENT_CP_FLAGS];
  const cpTarget = data[ptr + LogicData.CURRENT_CP_TARGET];

  // checkpoint가 없으면 로드 시도
  if (cpEdge === 0) {
    if (!loadNextCheckpoint(vehicleId, state)) {
      return null; // 더 이상 checkpoint 없음
    }

    cpEdge = data[ptr + LogicData.CURRENT_CP_EDGE];
    cpRatio = data[ptr + LogicData.CURRENT_CP_RATIO];
    cpFlags = data[ptr + LogicData.CURRENT_CP_FLAGS];
  }

  _cpState.edge = cpEdge;
  _cpState.ratio = cpRatio;
  _cpState.flags = cpFlags;
  _cpState.target = cpTarget;
  return _cpState;
}

/**
 * 현재 위치가 checkpoint에 도달했는지 체크
 */
export function checkCheckpointReached(
  vehicleId: number,
  cpState: CheckpointState,
  state: LockMgrState
): ReachCheckResult {
  if (!state.vehicleDataArray) {
    _reachResult.reached = false; _reachResult.missed = false; _reachResult.waiting = true;
    return _reachResult;
  }

  const data = state.vehicleDataArray;
  const ptr = vehicleId * VEHICLE_DATA_SIZE;

  const currentEdge = data[ptr + MovementData.CURRENT_EDGE];
  const currentRatio = data[ptr + MovementData.EDGE_RATIO];

  // Edge mismatch 체크
  if (currentEdge !== cpState.edge) {
    // 놓친 CP 감지: cpEdge가 pathBuffer에 없으면 이미 지나간 것
    if (isCpEdgeBehind(vehicleId, cpState.edge, state)) {
      _reachResult.reached = false; _reachResult.missed = true; _reachResult.waiting = false;
      return _reachResult;
    }

    _reachResult.reached = false; _reachResult.missed = false; _reachResult.waiting = true;
    return _reachResult;
  }

  // Ratio 체크
  if (currentRatio < cpState.ratio) {
    _reachResult.reached = false; _reachResult.missed = false; _reachResult.waiting = true;
    return _reachResult;
  }

  // ✅ Checkpoint 도달!
  _reachResult.reached = true; _reachResult.missed = false; _reachResult.waiting = false;
  return _reachResult;
}

/**
 * CP의 edge가 이미 지나간 edge인지 확인
 *
 * NEXT_EDGE_0~4를 확인하여 cpEdge가 있으면 아직 도달하지 않은 것,
 * 없으면 이미 지나간 것으로 판단 (O(5) 고정 - pathBuffer 순회 제거로 성능 개선)
 */
function isCpEdgeBehind(
  vehicleId: number,
  cpEdge: number,
  state: LockMgrState
): boolean {
  if (!state.vehicleDataArray) return false;

  const data = state.vehicleDataArray;
  const ptr = vehicleId * VEHICLE_DATA_SIZE;

  // NEXT_EDGE_0~4에 cpEdge가 있으면 아직 앞에 있음 (도달하지 않음)
  for (let i = 0; i < NEXT_EDGE_COUNT; i++) {
    if (data[ptr + MovementData.NEXT_EDGE_0 + i] === cpEdge) {
      return false; // cpEdge가 앞으로 갈 경로에 있음
    }
  }

  // NEXT_EDGE에 없음 → 이미 지나감
  return true;
}

/**
 * 다음 checkpoint를 배열에서 가져와서 VehicleDataArray에 저장
 * @returns 로드 성공 여부
 */
export function loadNextCheckpoint(
  vehicleId: number,
  state: LockMgrState
): boolean {
  if (!state.checkpointArray || !state.vehicleDataArray) return false;

  const data = state.vehicleDataArray;
  const ptr = vehicleId * VEHICLE_DATA_SIZE;

  const vehicleOffset = 1 + vehicleId * CHECKPOINT_SECTION_SIZE;
  const count = state.checkpointArray[vehicleOffset];
  const head = data[ptr + LogicData.CHECKPOINT_HEAD];

  // 더 이상 checkpoint 없음
  if (head >= count) {
    data[ptr + LogicData.CURRENT_CP_EDGE] = 0;
    data[ptr + LogicData.CURRENT_CP_RATIO] = 0;
    data[ptr + LogicData.CURRENT_CP_FLAGS] = 0;
    data[ptr + LogicData.CURRENT_CP_TARGET] = 0;
    return false;
  }

  // checkpoint 배열에서 읽기
  const cpOffset = vehicleOffset + 1 + head * CHECKPOINT_FIELDS;
  const cpEdge = state.checkpointArray[cpOffset + 0];
  const cpRatio = state.checkpointArray[cpOffset + 1];
  const cpFlags = state.checkpointArray[cpOffset + 2];
  const cpTargetEdge = state.checkpointArray[cpOffset + 3];

  // VehicleDataArray에 저장
  data[ptr + LogicData.CURRENT_CP_EDGE] = cpEdge;
  data[ptr + LogicData.CURRENT_CP_RATIO] = cpRatio;
  data[ptr + LogicData.CURRENT_CP_FLAGS] = cpFlags;
  data[ptr + LogicData.CURRENT_CP_TARGET] = cpTargetEdge;

  // head 증가
  data[ptr + LogicData.CHECKPOINT_HEAD] = head + 1;

  return true;
}
