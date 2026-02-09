// LockMgr/checkpoint-processor.ts
// Checkpoint 처리 메인 로직

import {
  CheckpointFlags,
  LogicData,
  MovementData,
  VEHICLE_DATA_SIZE,
} from "@/common/vehicle/initialize/constants";
import { devLog } from "@/logger/DevLogger";
import { getFbLog } from "@/logger";
import type { CheckpointState, LockMgrState } from "./types";
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
    const cpState = ensureCheckpointLoaded(vehicleId, state, eName);
    if (!cpState) return; // 더 이상 checkpoint 없음

    // 2. 도달 체크
    const reachResult = checkCheckpointReached(vehicleId, cpState, state, eName);

    if (reachResult.missed) {
      // 놓친 CP 처리
      handleMissedCheckpoint(vehicleId, state, cpState.flags, eName);
      data[ptr + LogicData.CURRENT_CP_FLAGS] = 0;
      loadNextCheckpoint(vehicleId, state, eName);
      continue; // 다음 CP도 놓쳤을 수 있음
    }

    if (reachResult.waiting) {
      // 아직 도달하지 않음
      return;
    }

    // 3. ✅ Checkpoint 도달! - Flag 처리
    processCheckpointFlags(vehicleId, state, cpState, eName);

    // 4. 다음 checkpoint 로드
    if (shouldLoadNextCheckpoint(vehicleId, state)) {
      // const currentEdge = data[ptr + MovementData.CURRENT_EDGE];
      // const head = data[ptr + LogicData.CHECKPOINT_HEAD];
      // devLog.veh(vehicleId).debug(
      //   `[processCP] flags=0, loading next. cur=${eName(currentEdge)} head=${head}`
      // );

      // // FbLogger: Checkpoint 로그 (구조화된 필드만 사용)
      // const fbLog = getFbLog();
      // if (fbLog) {
      //   const currentRatio = data[ptr + MovementData.EDGE_RATIO];
      //   fbLog.checkpoint({
      //     vehId: vehicleId,
      //     cpIndex: head,
      //     edgeId: currentEdge,
      //     ratio: currentRatio,
      //     flags: 0,
      //     action: "LOAD_NEXT",
      //   });
      // }

      loadNextCheckpoint(vehicleId, state, eName);
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
    handleMovePrepare(vehicleId, state, eName);
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
    handleLockRequest(vehicleId, state, eName);
    cpFlags &= ~CheckpointFlags.LOCK_REQUEST;
    data[ptr + LogicData.CURRENT_CP_FLAGS] = cpFlags;
  }

  // LOCK_WAIT 처리 (lock 대기)
  if (cpFlags & CheckpointFlags.LOCK_WAIT) {
    const granted = handleLockWait(vehicleId, state, eName);
    if (granted) {
      cpFlags &= ~CheckpointFlags.LOCK_WAIT;
      data[ptr + LogicData.CURRENT_CP_FLAGS] = cpFlags;
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
