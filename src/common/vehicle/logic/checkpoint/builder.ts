// common/vehicle/logic/checkpoint/builder.ts
// Checkpoint 생성 핵심 로직
//
// ========================================
// 1. Request Point (다음 edge 요청 지점)
// ========================================
// - target edge의 from_node에서 역순으로 거슬러 올라감
// - 직선 target: 5.1m 전에서 요청
// - 곡선 target: 1.0m 전에서 요청
//
// 조건 (우선순위 순):
// 1) 누적거리 >= 요청거리 → 해당 직선 edge의 ratio에서 요청
// 2) 누적거리 < 요청거리 상태에서 곡선 만남 → 곡선의 ratio 0.5에서 요청
// 3) path 시작까지 가도 거리 부족 → 첫 edge의 ratio 0에서 요청
//
// ========================================
// 2. Wait Point (Lock 대기 지점)
// ========================================
// - waiting_offset은 merge node로 들어가는 edge (incomingEdge)에 정의됨
// - targetEdge = merge에서 나가는 edge
// - incomingEdge = merge로 들어가는 edge = path[targetIdx - 1]
//
// 합류 타입별 처리:
// - 곡선 합류: incomingEdge의 fn (ratio 0)에서 대기
// - 직선 합류: incomingEdge.waiting_offset 거리 전에서 대기

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
function checkEdgeStartFromMergeNode(
  edge: Edge,
  isMergeNode: (nodeName: string) => boolean
): boolean {
  return isMergeNode(edge.from_node);
}

/**
 * 기본 옵션
 */
const DEFAULT_OPTIONS: MergeCheckpointOptions = {
  straightRequestDistance: 5.1,  // 직선 target 요청 거리 (meters)
  curveRequestDistance: 1.0,     // 곡선 target 요청 거리 (meters)
  releaseRatio: 0.01,            // Lock 해제 ratio
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
 * - Target의 from_node에서 거리만큼 거슬러 올라감
 * - 직선 target: 5.1m
 * - 곡선 target: 1m
 *
 * @param targetPathIdx - 대상 edge의 path 인덱스 (1-based, path[1]이 첫번째)
 * @param path - path 배열 (1-based, path[0]=length, path[1]=첫번째 edge ID)
 * @param edges - 1-based edge 배열 (edges[edgeId] = edge)
 * @param straightRequestDistance - 직선 target 요청 거리 (meters, 기본 5.1m)
 * @param curveRequestDistance - 곡선 target 요청 거리 (meters, 기본 1m)
 * @param isTargetCurve - target edge가 곡선인지 여부
 * @returns 요청 지점 (edgeId, ratio)
 */
function findRequestPoint(
  targetPathIdx: number,
  path: number[],
  edges: Edge[],
  straightRequestDistance: number,
  curveRequestDistance: number,
  isTargetCurve: boolean
): RequestPoint {
  // target이 곡선이면 1m, 직선이면 5.1m
  const distanceToFind = isTargetCurve ? curveRequestDistance : straightRequestDistance;

  let accumulatedDist = 0;

  // target의 from_node에서 역순으로 거슬러 올라감
  for (let i = targetPathIdx - 1; i >= 1; i--) {
    const cpEdgeId = path[i];
    const cpEdge = edges[cpEdgeId];

    // 곡선 만남 → 곡선의 ratio 0.5에서 요청
    if (isCurveEdge(cpEdge)) {
      return { edgeId: cpEdgeId, ratio: 0.5 };
    }

    accumulatedDist += cpEdge.distance;

    if (accumulatedDist >= distanceToFind) {
      const overshoot = accumulatedDist - distanceToFind;
      const ratio = overshoot / cpEdge.distance;
      return { edgeId: cpEdgeId, ratio };
    }
  }

  // path 시작까지 감
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
    const isStartFromMergeNode = checkEdgeStartFromMergeNode(targetEdge, isMergeNode);
    const isTargetCurve = isCurveEdge(targetEdge);

    // Request Point 찾기 (target이 곡선/직선에 따라 다른 거리 적용)
    const requestPoint = findRequestPoint(
      targetIdx,
      path,
      edges,
      opts.straightRequestDistance,
      opts.curveRequestDistance,
      isTargetCurve
    );

    let flags = CheckpointFlags.MOVE_PREPARE;
    if (isStartFromMergeNode) {
      flags |= CheckpointFlags.LOCK_REQUEST;
    }

    checkpoints.push({
      edge: requestPoint.edgeId,
      ratio: requestPoint.ratio,
      flags,
    });

    // 2. Wait Point (합류점 진입 시 LOCK_WAIT)
    // - waiting_offset은 merge로 들어가는 edge (incomingEdge)에 정의됨
    // - 곡선 합류: 곡선의 fn (ratio 0)에서 대기
    // - 직선 합류: waiting_offset 거리 전에서 대기
    if (isStartFromMergeNode) {
      const incomingEdgeId = path[targetIdx - 1];
      const incomingEdge = edges[incomingEdgeId];

      if (isCurveEdge(incomingEdge)) {
        // 곡선 합류: 곡선의 fn (ratio 0)에서 대기
        checkpoints.push({
          edge: incomingEdgeId,
          ratio: 0,
          flags: CheckpointFlags.LOCK_WAIT,
        });
      } else {
        // 직선 합류: waiting_offset 거리 전에서 대기
        const waitingOffset = incomingEdge.waiting_offset ?? 0;
        if (waitingOffset > 0) {
          const waitPoint = findWaitPoint(
            targetIdx,
            path,
            edges,
            waitingOffset
          );
          checkpoints.push({
            edge: waitPoint.edgeId,
            ratio: waitPoint.ratio,
            flags: CheckpointFlags.LOCK_WAIT,
          });
        }
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
