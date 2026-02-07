// common/vehicle/logic/checkpoint/builder.ts
// Checkpoint 생성 핵심 로직
//
// 핵심 알고리즘: 역순 탐색
// - 각 edge를 요청하려면 그 edge의 fromNode에서 requestDistance만큼 전에서 요청해야 함
// - 역순으로 거슬러 올라가면서 거리 누적
// - 곡선을 만나면 그 곡선의 ratio 0.5에서 요청
// - path 시작까지 갔으면 첫 edge의 ratio 0에서 요청

import type { Checkpoint } from "@/common/vehicle/initialize/constants";
import {
  CheckpointFlags,
  MAX_CHECKPOINTS_PER_VEHICLE,
} from "@/common/vehicle/initialize/constants";
import type { Edge } from "@/types/edge";
import type {
  CheckpointBuildContext,
  CheckpointBuildResult,
  MergeCheckpointOptions,
} from "./types";
import { isCurveEdge, deduplicateCheckpoints } from "./utils";
import { devLog } from "@/logger/DevLogger";

/**
 * edge의 시작점(from_node)이 merge node인지 확인
 */
function isStartFromMergeNode(
  edge: Edge,
  isMergeNode: (nodeName: string) => boolean
): boolean {
  return isMergeNode(edge.from_node);
}

/**
 * 기본 옵션
 */
const DEFAULT_OPTIONS: MergeCheckpointOptions = {
  requestDistance: 5.1,   // 요청 거리 (meters) - edge.distance가 meters 단위
  releaseRatio: 0.01,     // Lock 해제 ratio
};

/**
 * 요청 지점 정보
 */
interface RequestPoint {
  edgeId: number;   // 1-based edge ID
  ratio: number;    // 0.0 ~ 1.0
}

/**
 * 0-based 배열을 1-based로 감싸기
 * edges[1] = 첫번째 edge, edges[edgeId] = edge ID에 해당하는 edge
 */
function toOneBasedArray<T>(arr: T[]): T[] {
  return [null as unknown as T, ...arr];  // [0]은 dummy, [1]부터 실제 데이터
}

/**
 * 역순 탐색으로 요청 지점 찾기 (Request Point)
 * - Lock 요청 + 다음 edge 요청 지점
 * - merge node에서 5100mm (5.1m) 전
 *
 * @param targetPathIdx - 대상 edge의 path 인덱스 (1-based, path[1]이 첫번째)
 * @param path - path 배열 (1-based, path[0]=length, path[1]=첫번째 edge ID)
 * @param edges - 1-based edge 배열 (edges[edgeId] = edge)
 * @param requestDistance - 요청 거리 (meters)
 * @returns 요청 지점 (edgeId, ratio)
 */
function findRequestPoint(
  targetPathIdx: number,
  path: number[],
  edges: Edge[],
  requestDistance: number
): RequestPoint {
  let accumulatedDist = 0;

  // 역순으로 거슬러 올라감 (targetPathIdx - 1부터, 대상 edge는 제외)
  for (let i = targetPathIdx - 1; i >= 1; i--) {
    const cpEdgeId = path[i];        // checkpoint를 둘 edge ID
    const cpEdge = edges[cpEdgeId];  // checkpoint를 둘 edge

    // 곡선 만남 → 곡선의 ratio 0.5에서 요청
    if (isCurveEdge(cpEdge)) {
      return { edgeId: cpEdgeId, ratio: 0.5 };
    }

    // 직선 거리 누적
    accumulatedDist += cpEdge.distance;

    if (accumulatedDist >= requestDistance) {
      // 충분한 거리 확보 → 이 edge 어딘가에서 요청
      // overshoot: 초과한 거리 = 이 edge의 시작점에서 얼마나 진행한 위치
      const overshoot = accumulatedDist - requestDistance;
      const ratio = overshoot / cpEdge.distance;
      return { edgeId: cpEdgeId, ratio };
    }
  }

  // path 시작까지 갔는데도 requestDistance 안 됨 → 첫 edge의 ratio 0
  return { edgeId: path[1], ratio: 0 };
}

/**
 * 역순 탐색으로 대기 지점 찾기 (Wait Point)
 * - Lock 못 받으면 대기하는 지점
 * - merge node에서 waiting_offset 전
 *
 * @param targetPathIdx - 대상 edge의 path 인덱스 (1-based)
 * @param path - path 배열 (1-based)
 * @param edges - 1-based edge 배열
 * @param waitDistance - 대기 거리 (meters)
 * @returns 대기 지점 (edgeId, ratio)
 */
function findWaitPoint(
  targetPathIdx: number,
  path: number[],
  edges: Edge[],
  waitDistance: number
): RequestPoint {
  let accumulatedDist = 0;

  // 역순으로 거슬러 올라감 (targetPathIdx - 1부터, 대상 edge는 제외)
  for (let i = targetPathIdx - 1; i >= 1; i--) {
    const cpEdgeId = path[i];        // checkpoint를 둘 edge ID
    const cpEdge = edges[cpEdgeId];  // checkpoint를 둘 edge

    // 곡선 만남 → 곡선의 fn (ratio 0)에서 대기
    if (isCurveEdge(cpEdge)) {
      return { edgeId: cpEdgeId, ratio: 0 };
    }

    // 직선 거리 누적
    accumulatedDist += cpEdge.distance;

    if (accumulatedDist >= waitDistance) {
      // 충분한 거리 확보 → 이 edge 어딘가에서 대기
      const overshoot = accumulatedDist - waitDistance;
      const ratio = overshoot / cpEdge.distance;
      return { edgeId: cpEdgeId, ratio };
    }
  }

  // path 시작까지 갔는데도 waitDistance 안 됨 → 첫 edge의 ratio 0
  return { edgeId: path[1], ratio: 0 };
}

/**
 * Checkpoint 생성 함수
 *
 * 로직:
 * - 경로의 각 edge에 대해 (두 번째 edge부터)
 * - 역순 탐색으로 요청 지점 찾기
 * - MOVE_PREPARE 플래그로 checkpoint 생성
 * - 대상 edge의 fromNode가 merge면 LOCK_REQUEST 추가
 */
export function buildCheckpoints(
  ctx: CheckpointBuildContext,
  lockOptions: Partial<MergeCheckpointOptions> = {}
): CheckpointBuildResult {
  const opts = { ...DEFAULT_OPTIONS, ...lockOptions };
  const checkpoints: Checkpoint[] = [];
  const { edgeIndices, edgeArray, isMergeNode } = ctx;

  // ========================================
  // 1-based 배열로 변환
  // ========================================
  // edges[edgeId] = edge (edgeId는 1-based)
  const edges = toOneBasedArray(edgeArray);

  // path[0] = length, path[1] = 첫번째 edge ID, ...
  const pathLength = edgeIndices.length;
  const path = [pathLength, ...edgeIndices];

  // ========================================
  // 경로의 각 edge에 대해 checkpoint 생성
  // ========================================
  // path[1]은 첫번째 edge (이미 진입 중이므로 요청 불필요)
  // path[2]부터 요청 지점 찾기
  for (let targetIdx = 2; targetIdx <= pathLength; targetIdx++) {
    const targetEdgeId = path[targetIdx];
    const targetEdge = edges[targetEdgeId];
    const isMerge = isStartFromMergeNode(targetEdge, isMergeNode);

    // 1. Request Point (MOVE_PREPARE, merge면 LOCK_REQUEST도)
    const requestPoint = findRequestPoint(
      targetIdx,
      path,
      edges,
      opts.requestDistance
    );

    let flags = CheckpointFlags.MOVE_PREPARE;
    if (isMerge) {
      flags |= CheckpointFlags.LOCK_REQUEST;
    }

    checkpoints.push({
      edge: requestPoint.edgeId,
      ratio: requestPoint.ratio,
      flags,
    });

    // 2. Wait Point (merge면 LOCK_WAIT)
    if (isMerge) {
      const waitingOffset = targetEdge.waiting_offset; // mm 단위
      if (waitingOffset > 0) {
        const waitPoint = findWaitPoint(
          targetIdx,
          path,
          edges,
          waitingOffset / 1000 // mm → m 변환
        );

        checkpoints.push({
          edge: waitPoint.edgeId,
          ratio: waitPoint.ratio,
          flags: CheckpointFlags.LOCK_WAIT,
        });
      }
    }
  }

  // 중복 제거 (같은 위치면 flags OR)
  const dedupedCheckpoints = deduplicateCheckpoints(checkpoints);

  // 최대 개수 확인
  if (dedupedCheckpoints.length > MAX_CHECKPOINTS_PER_VEHICLE) {
    devLog.warn(
      `Checkpoint count (${dedupedCheckpoints.length}) exceeds maximum (${MAX_CHECKPOINTS_PER_VEHICLE}). Truncating.`
    );
    dedupedCheckpoints.splice(MAX_CHECKPOINTS_PER_VEHICLE);
  }

  return { checkpoints: dedupedCheckpoints };
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

      return `E${cp.edge}@${cp.ratio.toFixed(3)}[${flags.join("|")}]`;
    })
    .join(", ");

  devLog.veh(vehicleId).debug(
    `[checkpoint] Created ${checkpoints.length} checkpoints: ${summary}`
  );
}
