// common/vehicle/logic/checkpoint/builder.ts
// Checkpoint 생성 핵심 로직

import type { Edge } from "@/types/edge";
import type { Checkpoint } from "@/common/vehicle/initialize/constants";
import {
  CheckpointFlags,
  MAX_CHECKPOINTS_PER_VEHICLE,
} from "@/common/vehicle/initialize/constants";
import type {
  CheckpointBuildContext,
  CheckpointBuildResult,
  MergeCheckpointOptions,
  OnCurveCheckpointOptions,
} from "./types";
import {
  distanceToRatio,
  isCurveEdge,
  deduplicateCheckpoints,
} from "./utils";
import { devLog } from "@/logger/DevLogger";

/**
 * 기본 Merge checkpoint 옵션
 */
const DEFAULT_MERGE_OPTIONS: MergeCheckpointOptions = {
  requestDistance: 5100,  // Lock 요청 거리 (m) - 파라미터로 설정
  releaseRatio: 0.01,      // 다음 edge 20% 지점
};

/**
 * 기본 On-Curve checkpoint 옵션
 */
const DEFAULT_ON_CURVE_OPTIONS: OnCurveCheckpointOptions = {
  prepareRatio: 0.5,  // 곡선 50% 지점에서 다음 edge 준비 (config에서 가져올 예정)
};

/**
 * 최상위 checkpoint 생성 함수
 */
export function buildCheckpoints(
  ctx: CheckpointBuildContext,
  pathOptions: Partial<OnCurveCheckpointOptions> = {},
  lockOptions: Partial<MergeCheckpointOptions> = {}
): CheckpointBuildResult {
  // 1. 경로 관련 checkpoint 생성
  const pathCps = buildPathCheckpoints(ctx, pathOptions);

  // 2. Lock 관련 checkpoint 생성
  const lockCps = buildLockCheckpoints(ctx, lockOptions);

  // 3. 합치고 중복 제거 및 정렬
  const allCheckpoints = [...pathCps, ...lockCps];
  const deduplicated = deduplicateCheckpoints(allCheckpoints);

  // 4. 최대 개수 확인 (초과 시 자르기)
  if (deduplicated.length > MAX_CHECKPOINTS_PER_VEHICLE) {
    devLog.warn(
      `Checkpoint count (${deduplicated.length}) exceeds maximum (${MAX_CHECKPOINTS_PER_VEHICLE}). Truncating.`
    );
    deduplicated.splice(MAX_CHECKPOINTS_PER_VEHICLE);
  }

  return {
    checkpoints: deduplicated,
  };
}

/**
 * 경로 관련 checkpoint 생성 (곡선, 목적지 등)
 */
function buildPathCheckpoints(
  ctx: CheckpointBuildContext,
  options: Partial<OnCurveCheckpointOptions>
): Checkpoint[] {
  const opts = { ...DEFAULT_ON_CURVE_OPTIONS, ...options };
  const checkpoints: Checkpoint[] = [];

  // TODO: 구현
  // 1. On-Curve checkpoint (MOVE_PREPARE)
  //    - 곡선 edge 위에서 다음 edge 준비
  // 2. On-Linear checkpoint? (MOVE_SLOW)
  //    - 곡선 진입 전 감속
  // 3. 목적지 감속 checkpoint (MOVE_SLOW)
  //    - 마지막 edge의 80% 지점

  return checkpoints;
}

/**
 * Lock 관련 checkpoint 생성 (REQUEST, WAIT, RELEASE)
 */
function buildLockCheckpoints(
  ctx: CheckpointBuildContext,
  options: Partial<MergeCheckpointOptions>
): Checkpoint[] {
  const opts = { ...DEFAULT_MERGE_OPTIONS, ...options };
  const checkpoints: Checkpoint[] = [];

  // TODO: 구현
  // 1. 경로를 순회하며 merge node 찾기
  // 2. 각 merge node마다:
  //    - REQUEST: merge에서 역으로 requestDistance(5100m) 지점 계산
  //      → 어느 edge의 몇 % 지점인지 찾아서 checkpoint 추가
  //    - WAIT: merge에서 역으로 edge.waiting_offset 지점 계산
  //      → 어느 edge의 몇 % 지점인지 찾아서 checkpoint 추가
  //    - RELEASE: merge 통과 후 다음 edge의 releaseRatio 지점
  //      → checkpoint 추가

  return checkpoints;
}


/**
 * Checkpoint 리스트를 로그로 출력 (디버깅용)
 */
export function logCheckpoints(vehicleId: number, checkpoints: Checkpoint[]): void {
  if (checkpoints.length === 0) {
    devLog.veh(vehicleId).debug(`[checkpoint] No checkpoints`);
    return;
  }

  const summary = checkpoints
    .map((cp) => {
      const flags: string[] = [];
      if (cp.flags & CheckpointFlags.LOCK_REQUEST) flags.push("REQ");
      if (cp.flags & CheckpointFlags.LOCK_WAIT) flags.push("WAIT");
      if (cp.flags & CheckpointFlags.LOCK_RELEASE) flags.push("REL");
      if (cp.flags & CheckpointFlags.MOVE_PREPARE) flags.push("PREP");
      if (cp.flags & CheckpointFlags.MOVE_SLOW) flags.push("SLOW");

      return `E${cp.edge}@${cp.ratio.toFixed(3)}[${flags.join("|")}]`;
    })
    .join(", ");

  devLog.veh(vehicleId).debug(
    `[checkpoint] Created ${checkpoints.length} checkpoints: ${summary}`
  );
}
