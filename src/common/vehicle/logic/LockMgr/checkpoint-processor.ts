// LockMgr/checkpoint-processor.ts
// Checkpoint 처리 메인 로직

import {
  CheckpointFlags,
  LogicData,
  MovementData,
  VEHICLE_DATA_SIZE,
} from "@/common/vehicle/initialize/constants";
import type { CheckpointState, LockMgrState } from "./types";
import { CheckpointAction } from "./types";
import {
  ensureCheckpointLoaded,
  checkCheckpointReached,
  loadNextCheckpoint,
} from "./checkpoint-loader";
import {
  handleMovePrepare,
  handleLockRelease,
  handleLockRequest,
  handleLockWait,
  handleMissedCheckpoint,
} from "./lock-handlers";

/** Emit checkpoint event if callback is set */
function emitCheckpointEvent(
  state: LockMgrState,
  vehicleId: number,
  cpEdge: number,
  cpFlags: number,
  action: number,
  cpRatio: number,
): void {
  if (!state.onCheckpointEvent || !state.vehicleDataArray) return;
  const data = state.vehicleDataArray;
  const ptr = vehicleId * VEHICLE_DATA_SIZE;
  const currentEdge = Math.trunc(data[ptr + MovementData.CURRENT_EDGE]);
  const currentRatio = data[ptr + MovementData.EDGE_RATIO];
  state.onCheckpointEvent(vehicleId, cpEdge, cpFlags, action, cpRatio, currentEdge, currentRatio);
}

/**
 * Checkpoint 기반 락 처리 - 핵심 알고리즘
 *
 * 이 함수는 LockMgr의 핵심 로직으로, Checkpoint 시스템의 모든 처리를 담당합니다.
 *
 * 동작 흐름:
 * 1. Checkpoint 로드 (ensureCheckpointLoaded)
 *    - CURRENT_CP_EDGE가 0이면 checkpointArray에서 다음 CP 로드
 *    - VehicleDataArray의 CURRENT_CP_* 필드에 저장
 *
 * 2. 도달 체크 (checkCheckpointReached)
 *    - Edge 일치: currentEdge === cpEdge
 *    - Ratio 일치: currentRatio >= cpRatio
 *    - 놓친 CP 감지: cpEdge가 pathBuffer에 없으면 → 이미 지나감
 *
 * 3. Flag 처리 (processCheckpointFlags)
 *    - 각 flag 처리 후 해당 flag 제거 (비트 연산)
 *    - MOVE_PREPARE → LOCK_RELEASE → LOCK_REQUEST → LOCK_WAIT 순서
 *
 * 4. 다음 Checkpoint 로드 (shouldLoadNextCheckpoint)
 *    - flags === 0이면 loadNextCheckpoint 호출
 *
 * Catch-up 처리:
 * - 짧은 edge를 한 프레임에 통과하여 CP를 놓친 경우
 * - 최대 10개까지 연속 처리 (MAX_CATCHUP)
 */
export function processCheckpoint(
  vehicleId: number,
  state: LockMgrState,
  eName: (idx: number) => string
): void {
  if (!state.vehicleDataArray || !state.checkpointArray) return;

  const data = state.vehicleDataArray;
  const ptr = vehicleId * VEHICLE_DATA_SIZE;

  // Catch-up loop: 놓친 CP를 연속 처리 (최대 10개)
  const MAX_CATCHUP = 10;
  for (let attempt = 0; attempt < MAX_CATCHUP; attempt++) {
    // 1. Checkpoint 로드
    const cpState = ensureCheckpointLoaded(vehicleId, state);
    if (!cpState) return; // 더 이상 checkpoint 없음

    // 2. 도달 체크
    const reachResult = checkCheckpointReached(vehicleId, cpState, state);

    if (reachResult.missed) {
      // 놓친 CP 처리
      emitCheckpointEvent(state, vehicleId, cpState.edge, cpState.flags, CheckpointAction.MISS, cpState.ratio);
      const shouldAdvance = handleMissedCheckpoint(vehicleId, state, cpState.flags, eName);
      if (!shouldAdvance) {
        return; // LOCK_WAIT miss: 락 없어서 현재 위치 정지, CP 유지
      }
      data[ptr + LogicData.CURRENT_CP_FLAGS] = 0;
      loadNextCheckpoint(vehicleId, state);
      continue; // 다음 CP도 놓쳤을 수 있음
    }

    if (reachResult.waiting) {
      // 아직 도달하지 않음
      return;
    }

    // 3. ✅ Checkpoint 도달! - Flag 처리
    emitCheckpointEvent(state, vehicleId, cpState.edge, cpState.flags, CheckpointAction.HIT, cpState.ratio);
    processCheckpointFlags(vehicleId, state, cpState, eName);

    // 4. 다음 checkpoint 로드
    if (shouldLoadNextCheckpoint(vehicleId, state)) {
      loadNextCheckpoint(vehicleId, state);
    }

    return; // 정상 HIT 처리 완료
  }
}

/**
 * Checkpoint의 모든 flag 처리
 */
function processCheckpointFlags(
  vehicleId: number,
  state: LockMgrState,
  cpState: CheckpointState,
  eName: (idx: number) => string
): void {
  if (!state.vehicleDataArray) return;

  const data = state.vehicleDataArray;
  const ptr = vehicleId * VEHICLE_DATA_SIZE;
  let cpFlags = cpState.flags;

  // MOVE_PREPARE 처리 (가장 먼저 - edge 요청)
  if (cpFlags & CheckpointFlags.MOVE_PREPARE) {
    handleMovePrepare(vehicleId, state);
    cpFlags &= ~CheckpointFlags.MOVE_PREPARE;
    data[ptr + LogicData.CURRENT_CP_FLAGS] = cpFlags;
  }

  // LOCK_RELEASE 처리 (lock 해제)
  if (cpFlags & CheckpointFlags.LOCK_RELEASE) {
    handleLockRelease(vehicleId, state, eName);
    cpFlags &= ~CheckpointFlags.LOCK_RELEASE;
    data[ptr + LogicData.CURRENT_CP_FLAGS] = cpFlags;
  }

  // LOCK_REQUEST 처리 (lock 요청 - 요청 후 무조건 flag 해제)
  if (cpFlags & CheckpointFlags.LOCK_REQUEST) {
    handleLockRequest(vehicleId, state);
    cpFlags &= ~CheckpointFlags.LOCK_REQUEST;
    data[ptr + LogicData.CURRENT_CP_FLAGS] = cpFlags;
  }

  // LOCK_WAIT 처리 (lock 대기)
  if (cpFlags & CheckpointFlags.LOCK_WAIT) {
    const granted = handleLockWait(vehicleId, state);
    if (granted) {
      cpFlags &= ~CheckpointFlags.LOCK_WAIT;
      data[ptr + LogicData.CURRENT_CP_FLAGS] = cpFlags;
    } else {
      emitCheckpointEvent(state, vehicleId, cpState.edge, cpFlags, CheckpointAction.WAIT_BLOCKED, cpState.ratio);
    }
  }
}

/**
 * 다음 checkpoint를 로드해야 하는지 확인
 */
function shouldLoadNextCheckpoint(
  vehicleId: number,
  state: LockMgrState
): boolean {
  if (!state.vehicleDataArray) return false;

  const data = state.vehicleDataArray;
  const ptr = vehicleId * VEHICLE_DATA_SIZE;
  const cpFlags = data[ptr + LogicData.CURRENT_CP_FLAGS];

  return cpFlags === 0;
}
