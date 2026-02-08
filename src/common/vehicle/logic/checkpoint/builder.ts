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
  LockWaitCheckpointParams,
} from "./types";
import { isCurveEdge, sortCheckpointsByPathOrder } from "./utils";
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
  curveRequestDistance: 1,       // 곡선 target 요청 거리 (meters)
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
 * 역순 탐색으로 MOVE_PREPARE 요청 지점 찾기
 * - Target의 from_node에서 거리만큼 거슬러 올라감
 * - 곡선 만나면 → 곡선의 ratio 0.5 (다음 edge 준비 지점)
 *
 * @param targetPathIdx - 대상 edge의 path 인덱스 (1-based)
 * @param path - path 배열 (1-based, path[0]=length)
 * @param edges - 1-based edge 배열
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
 * 곡선 합류 시 LOCK_REQUEST 지점 찾기
 * - 곡선(incoming edge)의 fn에서 curveRequestDistance 전
 * - 곡선을 건너뛰고 직전 직선 edge에서 위치 탐색
 *
 * @param targetPathIdx - 대상 edge의 path 인덱스 (1-based)
 * @param path - path 배열 (1-based)
 * @param edges - 1-based edge 배열
 * @param curveRequestDistance - 곡선 fn 전 요청 거리 (meters, 기본 1.0m)
 * @returns 요청 지점 (edgeId, ratio)
 */
function findLockRequestBeforeCurve(
  targetPathIdx: number,
  path: number[],
  edges: Edge[],
  curveRequestDistance: number
): RequestPoint {
  let accumulatedDist = 0;

  // targetPathIdx - 1 = incoming (곡선), 건너뛰고 targetPathIdx - 2부터 탐색
  for (let i = targetPathIdx - 2; i >= 1; i--) {
    const cpEdgeId = path[i];
    const cpEdge = edges[cpEdgeId];

    // 또 곡선 만남 → 곡선의 ratio 0.5
    if (isCurveEdge(cpEdge)) {
      return { edgeId: cpEdgeId, ratio: 0.5 };
    }

    accumulatedDist += cpEdge.distance;

    if (accumulatedDist >= curveRequestDistance) {
      const overshoot = accumulatedDist - curveRequestDistance;
      const ratio = overshoot / cpEdge.distance;
      return { edgeId: cpEdgeId, ratio };
    }
  }

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
 * 곡선 합류 시 checkpoint 생성 (MOVE_PREPARE + LOCK_REQUEST 분리)
 */
function createCheckpointsForCurveMerge(
  checkpoints: Checkpoint[],
  requestPoint: RequestPoint,
  targetIdx: number,
  targetEdgeId: number,
  path: number[],
  edges: Edge[],
  opts: MergeCheckpointOptions
): void {
  // MOVE_PREPARE만 (곡선@0.5)
  checkpoints.push({
    edge: requestPoint.edgeId,
    ratio: requestPoint.ratio,
    flags: CheckpointFlags.MOVE_PREPARE,
    targetEdge: targetEdgeId,
  });

  // LOCK_REQUEST: 곡선의 fn에서 curveRequestDistance 전 (직전 직선 edge)
  const lockReqPoint = findLockRequestBeforeCurve(
    targetIdx,
    path,
    edges,
    opts.curveRequestDistance
  );
  checkpoints.push({
    edge: lockReqPoint.edgeId,
    ratio: lockReqPoint.ratio,
    flags: CheckpointFlags.LOCK_REQUEST,
    targetEdge: targetEdgeId,
  });
}

/**
 * 직선 합류 + 곡선 target 시 checkpoint 생성
 */
function createCheckpointsForStraightMergeCurveTarget(
  checkpoints: Checkpoint[],
  requestPoint: RequestPoint,
  targetIdx: number,
  targetEdgeId: number,
  path: number[],
  edges: Edge[],
  opts: MergeCheckpointOptions
): void {
  // PREP는 1.0m 전 (곡선 target 기준, requestPoint 그대로)
  checkpoints.push({
    edge: requestPoint.edgeId,
    ratio: requestPoint.ratio,
    flags: CheckpointFlags.MOVE_PREPARE,
    targetEdge: targetEdgeId,
  });

  // REQ는 5.1m 전 (lock 요청은 항상 straightRequestDistance)
  const lockReqPoint = findRequestPoint(
    targetIdx,
    path,
    edges,
    opts.straightRequestDistance,
    opts.curveRequestDistance,
    false // 직선 거리(5.1m) 강제 사용
  );
  checkpoints.push({
    edge: lockReqPoint.edgeId,
    ratio: lockReqPoint.ratio,
    flags: CheckpointFlags.LOCK_REQUEST,
    targetEdge: targetEdgeId,
  });
}

/**
 * 기타 경우 checkpoint 생성 (직선 합류 또는 비합류)
 */
function createCheckpointsForOthers(
  checkpoints: Checkpoint[],
  requestPoint: RequestPoint,
  targetEdgeId: number,
  isStartFromMergeNode: boolean
): void {
  // 직선 합류(직선 target) 또는 비합류: 기존 방식 (REQ|PREP 또는 PREP만)
  let flags = CheckpointFlags.MOVE_PREPARE;
  if (isStartFromMergeNode) {
    flags |= CheckpointFlags.LOCK_REQUEST;
  }
  checkpoints.push({
    edge: requestPoint.edgeId,
    ratio: requestPoint.ratio,
    flags,
    targetEdge: targetEdgeId,
  });
}

/**
 * LOCK_WAIT checkpoint 생성
 */
function createLockWaitCheckpoint(params: LockWaitCheckpointParams): void {
  const {
    checkpoints,
    targetEdgeId,
    incomingEdgeId,
    incomingEdge,
    isCurveIncoming,
    targetIdx,
    path,
    edges,
  } = params;

  if (isCurveIncoming) {
    // 곡선 합류: 곡선의 fn (ratio 0)에서 대기
    checkpoints.push({
      edge: incomingEdgeId,
      ratio: 0,
      flags: CheckpointFlags.LOCK_WAIT,
      targetEdge: targetEdgeId,
    });
  } else {
    // 직선 합류: waiting_offset 거리 전에서 대기 (없으면 기본 1.89m)
    const DEFAULT_WAITING_OFFSET = 1.89;
    const waitingOffset = incomingEdge.waiting_offset ?? DEFAULT_WAITING_OFFSET;
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
      targetEdge: targetEdgeId,
    });
  }
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

    // incoming edge 확인 (merge 직전 edge)
    const incomingEdgeId = path[targetIdx - 1];
    const incomingEdge = edges[incomingEdgeId];
    const isCurveIncoming = isCurveEdge(incomingEdge);

    // ========================================
    // 1. MOVE_PREPARE & LOCK_REQUEST
    // ========================================
    const requestPoint = findRequestPoint(
      targetIdx,
      path,
      edges,
      opts.straightRequestDistance,
      opts.curveRequestDistance,
      isTargetCurve
    );

    if (isStartFromMergeNode && isCurveIncoming) {
      createCheckpointsForCurveMerge(checkpoints, requestPoint, targetIdx, targetEdgeId, path, edges, opts);
    } else if (isStartFromMergeNode && isTargetCurve) {
      createCheckpointsForStraightMergeCurveTarget(checkpoints, requestPoint, targetIdx, targetEdgeId, path, edges, opts);
    } else {
      createCheckpointsForOthers(checkpoints, requestPoint, targetEdgeId, isStartFromMergeNode);
    }

    // ========================================
    // 2. LOCK_WAIT
    // ========================================
    if (isStartFromMergeNode) {
      createLockWaitCheckpoint({
        checkpoints,
        targetEdgeId,
        incomingEdgeId,
        incomingEdge,
        isCurveIncoming,
        targetIdx,
        path,
        edges,
      });
    }
  }

  // 경로 순서 기반 전체 정렬 (edge 경로 위치 → ratio 순)
  sortCheckpointsByPathOrder(checkpoints, edgeIndices);

  // 최대 개수 확인
  if (checkpoints.length > MAX_CHECKPOINTS_PER_VEHICLE) {
    devLog.warn(
      `Checkpoint count (${checkpoints.length}) exceeds maximum (${MAX_CHECKPOINTS_PER_VEHICLE}). Truncating.`
    );
    checkpoints.splice(MAX_CHECKPOINTS_PER_VEHICLE);
  }

  return { checkpoints };
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

      const tgt = cp.targetEdge ? `→E${cp.targetEdge}` : '';
      return `E${cp.edge}@${cp.ratio.toFixed(3)}[${flags.join("|")}]${tgt}`;
    })
    .join(", ");

  devLog.veh(vehicleId).debug(
    `[checkpoint] Created ${checkpoints.length} checkpoints: ${summary}`
  );
}
