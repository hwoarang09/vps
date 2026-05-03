// common/vehicle/logic/checkpoint/precompute.ts
// 토폴로지 기반 checkpoint 사전계산
//
// ========================================
// 목적
// ========================================
// 차량별·path별 매번 buildCheckpoints()를 돌리지 않고,
// 맵 로드 시 가능한 (chain, targetEdge) 조합마다 cp를 한 번 계산해 캐시.
// 차량 path가 들어오면 캐시에서 lookup + path 매칭으로 cp 배열 구성.
//
// ========================================
// Entry 구조
// ========================================
// 각 entry는 한 chain (= 특정 path prefix) 위에서 들어왔을 때 박힐 cp 1개.
// pathDependency: 차량 path 안에 이 시퀀스가 (target 직전에) 그대로 연속 포함돼야 valid.
//   - 마지막 원소 = incomingEdgeId.
//   - chain이 길수록 더 정확한 (= 우선해야 할) 결과 → lookup 시 가장 긴 매칭 채택.
//
// ========================================
// builder.ts 재사용 전략
// ========================================
// chain enumerate 후 fakePath = [...chain, targetEdgeId] 로 builder 호출 → cp 추출.
// chain enumerate는 incomingEdge 부터 BFS로 거슬러 가며 모든 길이의 chain 을 결과로 수집.
// (짧은 path에 매칭하려면 짧은 chain도 필요. lookup 단계에서 "가장 긴 매칭" 룰로 정확도 확보.)
//
// 종료 조건:
//   - chain[0] 직선 + distance >= MAX_LOOKBACK_DISTANCE_M → builder 가 그 안에서 cp 박음
//   - chain.length >= MAX_CHAIN_DEPTH                    → 분기 폭발 방지
//   - prev edge 없음 / 모두 cycle                        → path-start
// 곡선은 chain 안에 끼어들 수 있고, builder 가 알아서 곡선 ratio 0.5 에서 정지.

import type { Edge } from "@/types/edge";
import type { Checkpoint } from "@/common/vehicle/initialize/constants";
import { buildCheckpoints } from "./builder";
import { sortCheckpointsByPathOrder } from "./utils";
import { MAX_CHECKPOINTS_PER_VEHICLE } from "@/common/vehicle/initialize/constants";
import type { WaitRelocationEntry, MergeCheckpointOptions } from "./types";
import { isCurveEdge } from "./utils";

/**
 * 거슬러 갈 최대 거리 (m).
 * builder 가 거슬러 가는 거리는 두 cp 중 max:
 *   - LOCK_REQUEST: merge 에서 5.1m 전 (직선 target 기준)
 *   - LOCK_WAIT:    merge 에서 waiting_offset 전 (default 1.89m, edge.cfg 값)
 * 즉 5.1m 면 둘 다 cover. 안전마진 1m 추가 → 6m.
 * (LOCK_REQUEST 와 LOCK_WAIT 은 같은 path 위 다른 두 지점이며 합산하지 않음)
 */
const MAX_LOOKBACK_DISTANCE_M = 6.0;

/** chain 최대 깊이 — 분기 폭발/순환 방지 */
const MAX_CHAIN_DEPTH = 12;

/**
 * 사전계산 entry — 한 (incomingEdge → targetEdge) 분기에 대한 단일 cp.
 */
export interface PrecomputedCheckpointEntry {
  /** target edge ID (1-based) */
  targetEdgeId: number;
  /** path[t-1] 이어야 하는 incoming edge ID (편의 필드 — pathDependency 마지막 값) */
  incomingEdgeId: number;
  /** cp가 박힐 edge ID (1-based) */
  markerEdgeId: number;
  /** cp ratio (0~1) */
  ratio: number;
  /** CheckpointFlags bitmask */
  flags: number;
  /**
   * path 안에 (target 직전에) 정확히 이 순서로 연속 포함돼야 entry 적용.
   * 마지막 원소 = incomingEdgeId. 길이 1 = incoming 만 매칭하면 됨.
   */
  pathDependency: number[];
}

export type PrecomputedCheckpointMap = Map<number, PrecomputedCheckpointEntry[]>;

export interface PrecomputeContext {
  edgeArray: Edge[];
  isMergeNode: (nodeName: string) => boolean;
  isDeadLockMergeNode?: (nodeName: string) => boolean;
  waitRelocations?: Map<string, WaitRelocationEntry>;
  options?: Partial<MergeCheckpointOptions>;
}

/**
 * to_node → 들어오는 edge ID 들 (1-based)
 */
function buildToNodeIncoming(edges: Edge[]): Map<string, number[]> {
  const map = new Map<string, number[]>();
  for (let i = 0; i < edges.length; i++) {
    const arr = map.get(edges[i].to_node) ?? [];
    arr.push(i + 1);
    map.set(edges[i].to_node, arr);
  }
  return map;
}

/**
 * incomingEdge 부터 거슬러 가는 모든 chain enumerate.
 * chain = [..., incomingEdgeId] (path 순서).
 *
 * 종료 조건 (이때만 result.push):
 *   - chain[0] 가 직선이고 distance >= maxLookbackM  (builder 가 그 안에서 cp 박음)
 *   - chain.length >= MAX_CHAIN_DEPTH                (분기 폭발 방지)
 *   - 거슬러 갈 prev edge 없음 / 모두 cycle           (path-start)
 *
 * 곡선은 chain 안에 끼어들 수 있고, builder 가 알아서 곡선 ratio 0.5 에서 멈춤.
 * 곡선 incoming 의 경우 LOCK_REQUEST 가 곡선 직전 직선 edge 에서 1m 거슬러 박히므로
 * chain 안에 곡선 + 그 직전 직선이 모두 포함돼야 정확함.
 */
function enumerateChains(
  incomingEdgeId: number,
  edges: Edge[],
  toNodeIncoming: Map<string, number[]>,
  maxLookbackM: number = MAX_LOOKBACK_DISTANCE_M
): number[][] {
  const result: number[][] = [];
  type Frame = { chain: number[]; visited: Set<number> };
  const stack: Frame[] = [
    { chain: [incomingEdgeId], visited: new Set([incomingEdgeId]) },
  ];

  while (stack.length > 0) {
    const { chain, visited } = stack.pop()!;
    const firstEdgeId = chain[0];
    const firstEdge = edges[firstEdgeId - 1];

    // 항상 현재 chain 을 결과에 추가 (모든 길이의 chain이 lookup 후보가 되도록)
    result.push(chain);

    if (!firstEdge) continue;

    // 종료 조건 1: 직선이고 자체 distance가 충분 → builder 가 그 안에서 cp 박음
    if (!isCurveEdge(firstEdge) && firstEdge.distance >= maxLookbackM) {
      continue;
    }

    // 종료 조건 2: chain 너무 깊어짐 (분기 폭발 방지)
    if (chain.length >= MAX_CHAIN_DEPTH) {
      continue;
    }

    // 더 거슬러 가야 함 — firstEdge.from_node 로 들어오는 edge 들
    const prevEdgeIds = toNodeIncoming.get(firstEdge.from_node) ?? [];
    for (const prevEdgeId of prevEdgeIds) {
      if (visited.has(prevEdgeId)) continue;
      const newChain = [prevEdgeId, ...chain];
      const newVisited = new Set(visited);
      newVisited.add(prevEdgeId);
      stack.push({ chain: newChain, visited: newVisited });
    }
  }

  return result;
}

/**
 * 한 (incomingEdge, targetEdge) 쌍에 대해 cp entries 생성.
 */
function precomputeForPair(
  incomingEdgeId: number,
  targetEdgeId: number,
  edges: Edge[],
  toNodeIncoming: Map<string, number[]>,
  ctx: PrecomputeContext
): PrecomputedCheckpointEntry[] {
  const chains = enumerateChains(incomingEdgeId, edges, toNodeIncoming);
  const entries: PrecomputedCheckpointEntry[] = [];

  for (const chain of chains) {
    const fakePath = [...chain, targetEdgeId];
    const result = buildCheckpoints(
      {
        edgeIndices: fakePath,
        edgeArray: edges,
        isMergeNode: ctx.isMergeNode,
        isDeadLockMergeNode: ctx.isDeadLockMergeNode ?? (() => false),
        waitRelocations: ctx.waitRelocations,
      },
      ctx.options ?? {}
    );

    // targetEdge에 대한 cp 만 추출 (chain 내부 edge에 대한 cp는 무시)
    for (const cp of result.checkpoints) {
      if (cp.targetEdge !== targetEdgeId) continue;
      entries.push({
        targetEdgeId,
        incomingEdgeId,
        markerEdgeId: cp.edge,
        ratio: cp.ratio,
        flags: cp.flags,
        pathDependency: chain,
      });
    }
  }

  return entries;
}

/**
 * 사전계산 메인 — 모든 edge를 target으로 시도하여 cp entries 생성.
 */
export function precomputeCheckpoints(ctx: PrecomputeContext): PrecomputedCheckpointMap {
  const edges = ctx.edgeArray;
  const toNodeIncoming = buildToNodeIncoming(edges);
  const result: PrecomputedCheckpointMap = new Map();

  for (let targetIdx = 0; targetIdx < edges.length; targetIdx++) {
    const targetEdge = edges[targetIdx];
    const targetEdgeId = targetIdx + 1;

    // target.from_node 로 들어오는 incoming edges
    const incomings = toNodeIncoming.get(targetEdge.from_node) ?? [];
    if (incomings.length === 0) continue;

    const entries: PrecomputedCheckpointEntry[] = [];
    for (const incomingEdgeId of incomings) {
      // self-loop 회피
      if (incomingEdgeId === targetEdgeId) continue;

      const pairEntries = precomputeForPair(
        incomingEdgeId,
        targetEdgeId,
        edges,
        toNodeIncoming,
        ctx
      );
      entries.push(...pairEntries);
    }

    if (entries.length > 0) {
      result.set(targetEdgeId, entries);
    }
  }

  return result;
}

/**
 * pathDependency 가 path[i-len..i-1] 에 정확히 매칭하는지
 */
function pathDependencyMatches(
  edgeIndices: number[],
  targetIdxInPath: number,
  pathDependency: number[]
): boolean {
  const depLen = pathDependency.length;
  const start = targetIdxInPath - depLen;
  if (start < 0) return false;
  for (let j = 0; j < depLen; j++) {
    if (edgeIndices[start + j] !== pathDependency[j]) return false;
  }
  return true;
}

/**
 * 차량 path 에 대해 캐시에서 cp 배열 구성.
 * - 한 (incomingEdgeId, flags) 그룹 안에서 가장 긴 pathDependency 매칭 entry 1개만 채택
 * - sortCheckpointsByPathOrder + MAX_CHECKPOINTS_PER_VEHICLE 슬라이스
 */
export function lookupCheckpointsFromPath(
  edgeIndices: number[],
  cache: PrecomputedCheckpointMap
): Checkpoint[] {
  const checkpoints: Checkpoint[] = [];

  // path[1] 부터 target 후보 (path[0] 은 첫 edge — 진입 중이므로 cp 만들지 않음)
  for (let i = 1; i < edgeIndices.length; i++) {
    const targetEdgeId = edgeIndices[i];
    const entries = cache.get(targetEdgeId);
    if (!entries || entries.length === 0) continue;

    // (incomingEdgeId, flags) 그룹별 best (가장 긴 pathDependency) 매칭
    const bestByGroup = new Map<string, PrecomputedCheckpointEntry>();

    for (const entry of entries) {
      if (!pathDependencyMatches(edgeIndices, i, entry.pathDependency)) continue;

      const key = `${entry.incomingEdgeId}|${entry.flags}`;
      const existing = bestByGroup.get(key);
      if (!existing || entry.pathDependency.length > existing.pathDependency.length) {
        bestByGroup.set(key, entry);
      }
    }

    for (const entry of bestByGroup.values()) {
      checkpoints.push({
        edge: entry.markerEdgeId,
        ratio: entry.ratio,
        flags: entry.flags,
        targetEdge: entry.targetEdgeId,
      });
    }
  }

  sortCheckpointsByPathOrder(checkpoints, edgeIndices);

  if (checkpoints.length > MAX_CHECKPOINTS_PER_VEHICLE) {
    checkpoints.splice(MAX_CHECKPOINTS_PER_VEHICLE);
  }

  return checkpoints;
}
