// LockMgr/checkpoint-loader.ts
// Checkpoint 로드 및 검증 로직

import {
  CHECKPOINT_SECTION_SIZE,
  CHECKPOINT_FIELDS,
  MovementData,
  LogicData,
  VEHICLE_DATA_SIZE,
} from "@/common/vehicle/initialize/constants";
import { MAX_PATH_LENGTH, PATH_LEN, PATH_EDGES_START } from "../TransferMgr";
import { devLog } from "@/logger/DevLogger";
import type { CheckpointState, ReachCheckResult, LockMgrState } from "./types";

/**
 * Checkpoint가 로드되어 있는지 확인하고, 없으면 로드
 * @returns CheckpointState 또는 null (더 이상 checkpoint 없음)
 */
export function ensureCheckpointLoaded(
  vehicleId: number,
  state: LockMgrState,
  eName: (idx: number) => string
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
    const currentEdge = data[ptr + MovementData.CURRENT_EDGE];
    const currentRatio = data[ptr + MovementData.EDGE_RATIO];
    const head = data[ptr + LogicData.CHECKPOINT_HEAD];

    devLog.veh(vehicleId).debug(
      `[ensureCP] cpEdge=0, trying load. curE=${eName(currentEdge)} curR=${currentRatio.toFixed(3)} head=${head}`
    );

    if (!loadNextCheckpoint(vehicleId, state, eName)) {
      return null; // 더 이상 checkpoint 없음
    }

    cpEdge = data[ptr + LogicData.CURRENT_CP_EDGE];
    cpRatio = data[ptr + LogicData.CURRENT_CP_RATIO];
    cpFlags = data[ptr + LogicData.CURRENT_CP_FLAGS];
  }

  return {
    edge: cpEdge,
    ratio: cpRatio,
    flags: cpFlags,
    target: cpTarget,
  };
}

/**
 * 현재 위치가 checkpoint에 도달했는지 체크
 */
export function checkCheckpointReached(
  vehicleId: number,
  cpState: CheckpointState,
  state: LockMgrState,
  eName: (idx: number) => string
): ReachCheckResult {
  if (!state.vehicleDataArray) {
    return { reached: false, missed: false, waiting: true };
  }

  const data = state.vehicleDataArray;
  const ptr = vehicleId * VEHICLE_DATA_SIZE;

  const currentEdge = data[ptr + MovementData.CURRENT_EDGE];
  const currentRatio = data[ptr + MovementData.EDGE_RATIO];
  const head = data[ptr + LogicData.CHECKPOINT_HEAD];

  // Edge mismatch 체크
  if (currentEdge !== cpState.edge) {
    // 놓친 CP 감지: cpEdge가 pathBuffer에 없으면 이미 지나간 것
    if (isCpEdgeBehind(vehicleId, cpState.edge, state)) {
      devLog.veh(vehicleId).debug(
        `[checkCP] MISSED! cur=${eName(currentEdge)}@${currentRatio.toFixed(3)} passed cp=${eName(cpState.edge)}@${cpState.ratio.toFixed(3)} flags=${cpState.flags} head=${head}`
      );
      return { reached: false, missed: true, waiting: false };
    }

    devLog.veh(vehicleId).debug(
      `[checkCP] SKIP edge mismatch: cur=${eName(currentEdge)} !== cp=${eName(cpState.edge)} curR=${currentRatio.toFixed(3)} cpR=${cpState.ratio.toFixed(3)} flags=${cpState.flags} head=${head}`
    );
    return { reached: false, missed: false, waiting: true };
  }

  // Ratio 체크
  if (currentRatio < cpState.ratio) {
    devLog.veh(vehicleId).debug(
      `[checkCP] SKIP ratio: cur=${eName(currentEdge)} curR=${currentRatio.toFixed(3)} < cpR=${cpState.ratio.toFixed(3)} flags=${cpState.flags} head=${head}`
    );
    return { reached: false, missed: false, waiting: true };
  }

  // ✅ Checkpoint 도달!
  devLog.veh(vehicleId).debug(
    `[checkCP] HIT! cur=${eName(currentEdge)}@${currentRatio.toFixed(3)} cp=${eName(cpState.edge)}@${cpState.ratio.toFixed(3)} flags=${cpState.flags} head=${head}`
  );
  return { reached: true, missed: false, waiting: false };
}

/**
 * CP의 edge가 이미 지나간 edge인지 확인
 */
function isCpEdgeBehind(
  vehicleId: number,
  cpEdge: number,
  state: LockMgrState
): boolean {
  if (!state.pathBuffer) return false;
  const pathPtr = vehicleId * MAX_PATH_LENGTH;
  const pathLen = state.pathBuffer[pathPtr + PATH_LEN];

  for (let i = 0; i < pathLen; i++) {
    if (state.pathBuffer[pathPtr + PATH_EDGES_START + i] === cpEdge) {
      return false; // cpEdge가 아직 경로에 있음
    }
  }
  return true; // pathBuffer에 없음 → 이미 지나감
}

/**
 * 다음 checkpoint를 배열에서 가져와서 VehicleDataArray에 저장
 * @returns 로드 성공 여부
 */
export function loadNextCheckpoint(
  vehicleId: number,
  state: LockMgrState,
  eName: (idx: number) => string
): boolean {
  if (!state.checkpointArray || !state.vehicleDataArray) return false;

  const data = state.vehicleDataArray;
  const ptr = vehicleId * VEHICLE_DATA_SIZE;

  const vehicleOffset = 1 + vehicleId * CHECKPOINT_SECTION_SIZE;
  const count = state.checkpointArray[vehicleOffset];
  const head = data[ptr + LogicData.CHECKPOINT_HEAD];

  // 더 이상 checkpoint 없음
  if (head >= count) {
    devLog.veh(vehicleId).debug(
      `[loadNextCP] END: head=${head} >= count=${count}`
    );
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

  const currentEdge = data[ptr + MovementData.CURRENT_EDGE];
  const currentRatio = data[ptr + MovementData.EDGE_RATIO];
  devLog.veh(vehicleId).debug(
    `[loadNextCP] head=${head}→${head + 1}/${count} loaded: cp=${eName(cpEdge)}@${cpRatio.toFixed(3)} flags=${cpFlags} tgt=${eName(cpTargetEdge)} | cur=${eName(currentEdge)}@${currentRatio.toFixed(3)}`
  );

  return true;
}
