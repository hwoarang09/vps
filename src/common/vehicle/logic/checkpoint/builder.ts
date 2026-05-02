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
  WaitRelocationEntry,
} from "./types";
import { isCurveEdge, sortCheckpointsByPathOrder } from "./utils";
import { DEFAULT_WAITING_OFFSET, DZ_ENTRY_WAIT_OFFSET } from "./constants";

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
 * 통합 wait entry 정보 (정적/변형 DZ 공용)
 */
interface DzEntry {
  edgeId: number;
  ratio: number;
  pathIdx: number;
}

/**
 * Deadlock zone entry 대기 지점 찾기 (정적 DZ)
 * incoming edge의 deadlockZoneId로 zone을 식별하고,
 * 같은 zone의 entry edge (branch node 직전)를 반환
 */
function findDeadlockZoneEntry(
  targetIdx: number,
  path: number[],
  edges: Edge[],
): DzEntry | null {
  const incomingEdge = edges[path[targetIdx - 1]];
  if (!incomingEdge?.deadlockZoneId) return null;
  const zoneId = incomingEdge.deadlockZoneId;

  for (let i = targetIdx - 1; i >= 1; i--) {
    const edgeId = path[i];
    const edge = edges[edgeId];
    if (!edge) continue;
    if (edge.isDeadlockZoneEntry && edge.deadlockZoneId === zoneId) {
      // entry edge 끝에서 대기 (branch node 직전)
      const ratio = edge.distance > DZ_ENTRY_WAIT_OFFSET
        ? 1 - DZ_ENTRY_WAIT_OFFSET / edge.distance
        : 0;
      return { edgeId, ratio, pathIdx: i };
    }
  }
  return null;
}

/**
 * 변형 DZ entry 대기 지점 찾기 (짧은 LINEAR chain)
 * - waitRelocations에서 incoming edge name으로 reloc 정보 lookup
 * - path에서 reloc.waitEdge 찾아서 그 edge 끝 waiting_offset 전 위치 반환
 * - waitEdge가 path에 없으면 (우회로) null → 일반 합류 분기로 fallback
 */
function findVariantDzEntry(
  targetIdx: number,
  path: number[],
  edges: Edge[],
  waitRelocations: Map<string, WaitRelocationEntry> | undefined
): DzEntry | null {
  if (!waitRelocations || waitRelocations.size === 0) return null;

  const incomingEdge = edges[path[targetIdx - 1]];
  if (!incomingEdge) return null;

  const reloc = waitRelocations.get(incomingEdge.edge_name);
  if (!reloc) return null;

  // path에서 waitEdge를 거꾸로 찾음
  for (let i = targetIdx - 1; i >= 1; i--) {
    const edgeId = path[i];
    const edge = edges[edgeId];
    if (!edge || edge.edge_name !== reloc.waitEdge) continue;

    const offset = edge.waiting_offset ?? DEFAULT_WAITING_OFFSET;
    const clamped = Math.min(offset, edge.distance);
    const ratio = edge.distance > 0
      ? Math.max(0, 1 - clamped / edge.distance)
      : 0;
    return { edgeId, ratio, pathIdx: i };
  }
  return null; // path가 우회로면 fallback
}

/**
 * 정적 DZ + 변형 DZ 통합 entry 검색
 * - 정적 DZ 우선
 * - waitRelocations에 정적 DZ는 미리 제외되어있음 (nodeStore 분석 시점에 가드)
 */
function findDzEntry(
  targetIdx: number,
  path: number[],
  edges: Edge[],
  waitRelocations: Map<string, WaitRelocationEntry> | undefined
): DzEntry | null {
  return (
    findDeadlockZoneEntry(targetIdx, path, edges)
    ?? findVariantDzEntry(targetIdx, path, edges, waitRelocations)
  );
}

/**
 * LOCK_WAIT checkpoint 생성
 * 처리 우선순위:
 *   1. DZ entry (정적 또는 변형) → entry edge 위치
 *   2. 곡선 incoming → 곡선 시작 (ratio 0)
 *   3. 직선 incoming → merge에서 waiting_offset 거꾸로
 */
function createLockWaitCheckpoint(
  params: LockWaitCheckpointParams,
  waitRelocations: Map<string, WaitRelocationEntry> | undefined
): void {
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

  // ── Deadlock zone (정적/변형 통합): entry에서 대기 ──
  const dzEntry = findDzEntry(targetIdx, path, edges, waitRelocations);
  if (dzEntry) {
    checkpoints.push({
      edge: dzEntry.edgeId,
      ratio: dzEntry.ratio,
      flags: CheckpointFlags.LOCK_WAIT,
      targetEdge: targetEdgeId,
    });
    return;
  }

  // ── 일반 합류 ──
  if (isCurveIncoming) {
    // 곡선 합류: 곡선의 fn (ratio 0)에서 대기
    checkpoints.push({
      edge: incomingEdgeId,
      ratio: 0,
      flags: CheckpointFlags.LOCK_WAIT,
      targetEdge: targetEdgeId,
    });
  } else {
    // 직선 합류: waiting_offset 거리 전에서 대기
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
  const { edgeIndices, edgeArray, isMergeNode, waitRelocations } = ctx;

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
    // Deadlock zone 사전 탐지 (정적 우선, 변형 fallback)
    // ========================================
    const staticDzEntry = isStartFromMergeNode
      ? findDeadlockZoneEntry(targetIdx, path, edges)
      : null;
    const variantDzEntry = (isStartFromMergeNode && !staticDzEntry)
      ? findVariantDzEntry(targetIdx, path, edges, waitRelocations)
      : null;
    const dzEntry = staticDzEntry ?? variantDzEntry;

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

    if (dzEntry) {
      // ── Deadlock zone ──
      // MOVE_PREPARE: 기존 위치 (merge 직전)
      checkpoints.push({
        edge: requestPoint.edgeId,
        ratio: requestPoint.ratio,
        flags: CheckpointFlags.MOVE_PREPARE,
        targetEdge: targetEdgeId,
      });
      // LOCK_REQUEST 위치:
      // - 정적 DZ: entry 앞 5.1m (zone 진입 차단)
      // - 변형 DZ: chain start 앞 1m (곡선 fn과 같은 처리)
      //   chain은 곧 곡선으로 이어지므로 차량은 이미 pre-brake 중 → 1m 충분
      const useShortDistance = !!variantDzEntry;
      const dzReqPoint = findRequestPoint(
        dzEntry.pathIdx, path, edges,
        opts.straightRequestDistance, opts.curveRequestDistance,
        useShortDistance  // true → curveRequestDistance(1m), false → straightRequestDistance(5.1m)
      );
      checkpoints.push({
        edge: dzReqPoint.edgeId,
        ratio: dzReqPoint.ratio,
        flags: CheckpointFlags.LOCK_REQUEST,
        targetEdge: targetEdgeId,
      });
    } else if (isStartFromMergeNode && isCurveIncoming) {
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
      }, waitRelocations);
    }
  }

  // 경로 순서 기반 전체 정렬 (edge 경로 위치 → ratio 순)
  sortCheckpointsByPathOrder(checkpoints, edgeIndices);

  // 최대 개수 확인
  if (checkpoints.length > MAX_CHECKPOINTS_PER_VEHICLE) {
    checkpoints.splice(MAX_CHECKPOINTS_PER_VEHICLE);
  }

  return { checkpoints };
}

/**
 * Checkpoint 리스트를 로그로 출력 (디버깅용)
 * SimLogger의 DEV 이벤트로 전환 완료 — 이 함수는 하위 호환을 위해 no-op으로 유지
 */
export function logCheckpoints(_vehicleId: number, _checkpoints: Checkpoint[]): void {
  // no-op: checkpoint logging is handled by SimLogger.logCheckpoint()
}
