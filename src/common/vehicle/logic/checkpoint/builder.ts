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
  CurveCheckpointOptions,
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
  requestDistanceLinear: 20,  // 직선 20m 전
  waitDistanceLinear: 7,      // 직선 7m 전
  requestDistanceCurve: 30,   // 곡선 30m 전
  waitDistanceCurve: 5,       // 곡선 5m 전
  releaseRatio: 0.2,          // 다음 edge 20% 지점
};

/**
 * 기본 Curve checkpoint 옵션
 */
const DEFAULT_CURVE_OPTIONS: CurveCheckpointOptions = {
  slowRatio: 0.3,     // 곡선 70% 전부터 감속
  prepareRatio: 0.5,  // 곡선 50% 지점에서 준비
};

/**
 * 경로로부터 checkpoint 리스트 생성
 */
export function buildCheckpointsFromPath(
  ctx: CheckpointBuildContext,
  mergeOptions: Partial<MergeCheckpointOptions> = {},
  curveOptions: Partial<CurveCheckpointOptions> = {}
): CheckpointBuildResult {
  const mergeOpts = { ...DEFAULT_MERGE_OPTIONS, ...mergeOptions };
  const curveOpts = { ...DEFAULT_CURVE_OPTIONS, ...curveOptions };

  const checkpoints: Checkpoint[] = [];
  const warnings: string[] = [];

  for (let i = 0; i < ctx.edgeIndices.length; i++) {
    const edgeIdx = ctx.edgeIndices[i];
    if (edgeIdx < 1) continue; // 1-based: 0 is invalid

    const edge = ctx.edgeArray[edgeIdx - 1]; // Convert to 0-based
    if (!edge) continue;

    // 1. Merge checkpoint 추가
    if (ctx.isMergeNode(edge.to_node)) {
      const mergeCps = buildMergeCheckpoints(
        edge,
        edgeIdx,
        ctx,
        i,
        mergeOpts
      );
      checkpoints.push(...mergeCps);
    }

    // 2. Curve checkpoint 추가
    if (isCurveEdge(edge)) {
      const curveCps = buildCurveCheckpoints(edge, edgeIdx, curveOpts);
      checkpoints.push(...curveCps);
    }

    // 3. 목적지 도착 전 감속 checkpoint (마지막 edge)
    if (i === ctx.edgeIndices.length - 1) {
      checkpoints.push({
        edge: edgeIdx,
        ratio: 0.8, // 목적지 20% 전
        flags: CheckpointFlags.MOVE_SLOW,
      });
    }
  }

  // 중복 제거 및 정렬
  const deduplicated = deduplicateCheckpoints(checkpoints);

  // 최대 개수 확인
  if (deduplicated.length > MAX_CHECKPOINTS_PER_VEHICLE) {
    warnings.push(
      `Checkpoint count (${deduplicated.length}) exceeds maximum (${MAX_CHECKPOINTS_PER_VEHICLE}). Truncating.`
    );
    deduplicated.splice(MAX_CHECKPOINTS_PER_VEHICLE);
  }

  return {
    checkpoints: deduplicated,
    count: deduplicated.length,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

/**
 * Merge checkpoint 3개 생성 (REQUEST, WAIT, RELEASE)
 */
function buildMergeCheckpoints(
  edge: Edge,
  edgeIdx: number,
  ctx: CheckpointBuildContext,
  currentPathIndex: number,
  options: MergeCheckpointOptions
): Checkpoint[] {
  const checkpoints: Checkpoint[] = [];
  const isCurve = isCurveEdge(edge);

  // REQUEST: merge 전 충분한 거리
  const requestDist = isCurve
    ? -options.requestDistanceCurve
    : -options.requestDistanceLinear;
  const requestRatio = distanceToRatio(edge, requestDist);

  checkpoints.push({
    edge: edgeIdx,
    ratio: requestRatio,
    flags: CheckpointFlags.LOCK_REQUEST,
  });

  // WAIT: merge 직전 대기 지점
  const waitDist = isCurve
    ? -options.waitDistanceCurve
    : -options.waitDistanceLinear;
  const waitRatio = distanceToRatio(edge, waitDist);

  checkpoints.push({
    edge: edgeIdx,
    ratio: waitRatio,
    flags: CheckpointFlags.LOCK_WAIT,
  });

  // RELEASE: merge 통과 후 (다음 edge)
  if (currentPathIndex + 1 < ctx.edgeIndices.length) {
    const nextEdgeIdx = ctx.edgeIndices[currentPathIndex + 1];
    checkpoints.push({
      edge: nextEdgeIdx,
      ratio: options.releaseRatio,
      flags: CheckpointFlags.LOCK_RELEASE,
    });
  }

  return checkpoints;
}

/**
 * Curve checkpoint 생성 (MOVE_SLOW, MOVE_PREPARE)
 */
function buildCurveCheckpoints(
  _edge: Edge,
  edgeIdx: number,
  options: CurveCheckpointOptions
): Checkpoint[] {
  const checkpoints: Checkpoint[] = [];

  // MOVE_SLOW: 감속 시작
  checkpoints.push({
    edge: edgeIdx,
    ratio: options.slowRatio,
    flags: CheckpointFlags.MOVE_SLOW,
  });

  // MOVE_PREPARE: 곡선 진입 준비
  checkpoints.push({
    edge: edgeIdx,
    ratio: options.prepareRatio,
    flags: CheckpointFlags.MOVE_PREPARE,
  });

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
