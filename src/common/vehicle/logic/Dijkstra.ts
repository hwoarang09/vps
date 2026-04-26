// common/vehicle/logic/Dijkstra.ts
import { Edge } from "@/types/edge";
import type { IEdgeVehicleQueue } from "@/common/vehicle/initialize/types";
import type { EdgeStatsTracker } from "./EdgeStatsTracker";
import { isCurveEdge } from "./checkpoint/utils";

interface PerformanceStats {
  count: number;
  totalTime: number;
  minTime: number;
  maxTime: number;
  cacheHits: number;
  cacheMisses: number;
}

// Performance tracking
const perfStats: PerformanceStats = {
  count: 0,
  totalTime: 0,
  minTime: Infinity,
  maxTime: 0,
  cacheHits: 0,
  cacheMisses: 0,
};

// ============================================================
// Routing Strategy & BPR Configuration
// ============================================================
export type RoutingStrategy = "DISTANCE" | "BPR" | "EWMA";

export interface RoutingConfig {
  strategy: RoutingStrategy;
  /** BPR alpha parameter */
  bprAlpha: number;
  /** BPR beta parameter */
  bprBeta: number;
  /** Minimum capacity per edge (prevents division by zero) */
  bprMinCapacity: number;
  /** EWMA smoothing factor (0.0~1.0) */
  ewmaAlpha: number;
}

/**
 * Per-call routing context. Passed to findShortestPath to support per-fab BPR.
 */
export interface RoutingContext {
  config: RoutingConfig;
  edgeVehicleQueue: IEdgeVehicleQueue;
  vehicleSpacing: number;
  /** Linear max speed (m/s) for free-flow time calculation */
  linearMaxSpeed: number;
  /** Curve max speed (m/s) for free-flow time calculation */
  curveMaxSpeed: number;
  /** EWMA tracker instance (per-fab) */
  edgeStatsTracker?: EdgeStatsTracker;
}

export const DEFAULT_ROUTING_CONFIG: RoutingConfig = {
  strategy: "DISTANCE",
  bprAlpha: 4,
  bprBeta: 8,
  bprMinCapacity: 1,
  ewmaAlpha: 0.1,
};

/** Active context for current findShortestPath call (set before processNeighbors) */
let activeCtx: RoutingContext | null = null;

/**
 * Free-flow time: edge를 maxSpeed로 통과하는 데 걸리는 시간 (simulation-seconds).
 * 직선/곡선에 따라 다른 maxSpeed 적용.
 */
function freeFlowTime(edge: Edge, ctx: RoutingContext): number {
  const maxSpeed = isCurveEdge(edge) ? ctx.curveMaxSpeed : ctx.linearMaxSpeed;
  return edge.distance / maxSpeed; // meters / (m/s) = seconds
}

/**
 * Unified edge cost function (unit: simulation-seconds).
 *
 * DISTANCE: free-flow time (static)
 * BPR:      t0 * (1 + α * (volume/capacity)^β)  — 학술 표준 BPR
 * EWMA:     관측된 EWMA transit time (cold → free-flow time fallback)
 */
function edgeCost(edge: Edge, edgeIndex1Based: number): number {
  if (!activeCtx) return edge.distance; // fallback (no context)

  const ctx = activeCtx;
  const t0 = freeFlowTime(edge, ctx);

  switch (ctx.config.strategy) {
    case "DISTANCE":
      return t0;

    case "BPR": {
      const { bprAlpha, bprBeta, bprMinCapacity } = ctx.config;
      const volume = ctx.edgeVehicleQueue.getCount(edgeIndex1Based);
      const capacity = Math.max(bprMinCapacity, Math.floor(edge.distance / ctx.vehicleSpacing));
      const ratio = volume / capacity;
      return t0 * (1 + bprAlpha * Math.pow(ratio, bprBeta));
    }

    case "EWMA": {
      const tracker = ctx.edgeStatsTracker;
      if (!tracker) return t0;
      const ewma = tracker.getEwma(edgeIndex1Based);
      if (ewma !== undefined) return ewma;
      // cold: seed with free-flow time so future observe() smooths into it
      tracker.seed(edgeIndex1Based, t0);
      return t0;
    }
  }
}

// ============================================================
// Min-Heap Priority Queue (reusable, minimal GC pressure)
// ============================================================
class MinHeap {
  private heap: number[] = []; // [edgeIndex0, cost0, edgeIndex1, cost1, ...]
  private size = 0;

  clear(): void {
    this.size = 0;
  }

  isEmpty(): boolean {
    return this.size === 0;
  }

  push(edgeIndex: number, cost: number): void {
    const idx = this.size * 2;
    if (idx >= this.heap.length) {
      this.heap.push(edgeIndex, cost);
    } else {
      this.heap[idx] = edgeIndex;
      this.heap[idx + 1] = cost;
    }
    this.size++;
    this.bubbleUp(this.size - 1);
  }

  pop(): { edgeIndex: number; cost: number } | null {
    if (this.size === 0) return null;

    const edgeIndex = this.heap[0];
    const cost = this.heap[1];

    this.size--;
    if (this.size > 0) {
      // Move last to root
      this.heap[0] = this.heap[this.size * 2];
      this.heap[1] = this.heap[this.size * 2 + 1];
      this.bubbleDown(0);
    }

    return { edgeIndex, cost };
  }

  private bubbleUp(i: number): void {
    while (i > 0) {
      const parent = Math.floor((i - 1) / 2);
      if (this.heap[i * 2 + 1] >= this.heap[parent * 2 + 1]) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  private bubbleDown(i: number): void {
    while (true) {
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      let smallest = i;

      if (left < this.size && this.heap[left * 2 + 1] < this.heap[smallest * 2 + 1]) {
        smallest = left;
      }
      if (right < this.size && this.heap[right * 2 + 1] < this.heap[smallest * 2 + 1]) {
        smallest = right;
      }
      if (smallest === i) break;
      this.swap(i, smallest);
      i = smallest;
    }
  }

  private swap(i: number, j: number): void {
    const iIdx = i * 2;
    const jIdx = j * 2;
    const tmpEdge = this.heap[iIdx];
    const tmpCost = this.heap[iIdx + 1];
    this.heap[iIdx] = this.heap[jIdx];
    this.heap[iIdx + 1] = this.heap[jIdx + 1];
    this.heap[jIdx] = tmpEdge;
    this.heap[jIdx + 1] = tmpCost;
  }
}

// ============================================================
// LRU Path Cache
// ============================================================
const PATH_CACHE_MAX_SIZE = 2000;
const pathCache = new Map<string, number[] | null>();

function getCacheKey(start: number, end: number): string {
  return `${start}:${end}`;
}

function getCachedPath(start: number, end: number): number[] | null | undefined {
  const key = getCacheKey(start, end);
  const cached = pathCache.get(key);
  if (cached !== undefined) {
    // Move to end (LRU refresh)
    pathCache.delete(key);
    pathCache.set(key, cached);
    return cached;
  }
  return undefined;
}

function setCachedPath(start: number, end: number, path: number[] | null): void {
  const key = getCacheKey(start, end);
  // Evict oldest if at capacity
  if (pathCache.size >= PATH_CACHE_MAX_SIZE) {
    const firstKey = pathCache.keys().next().value;
    if (firstKey !== undefined) {
      pathCache.delete(firstKey);
    }
  }
  pathCache.set(key, path);
}

/**
 * Clear path cache (e.g., when map changes)
 */
export function clearPathCache(): void {
  pathCache.clear();
}

// ============================================================
// Reusable data structures (minimize GC)
// ============================================================
const heap = new MinHeap();
const distArray: number[] = [];
const prevArray: number[] = [];

function ensureArraySize(size: number): void {
  while (distArray.length < size) {
    distArray.push(Infinity);
    prevArray.push(0); // 0 is invalid sentinel (1-based indexing)
  }
}

function resetArrays(size: number): void {
  for (let i = 0; i < size; i++) {
    distArray[i] = Infinity;
    prevArray[i] = 0; // 0 is invalid sentinel (1-based indexing)
  }
}

/**
 * Finds the shortest path between startEdge and endEdge using Dijkstra's algorithm.
 * Uses Min-Heap for O(E log V) complexity and LRU cache for repeated queries.
 *
 * NOTE: All indices are 1-based. 0 is reserved as invalid sentinel.
 *
 * @param startEdgeIndex Index of the starting edge (1-based)
 * @param endEdgeIndex Index of the destination edge (1-based)
 * @param edgeArray Full array of all edges (0-based array)
 * @param routingCtx Optional per-fab routing context for BPR cost. If omitted, uses DISTANCE strategy.
 * @returns Array of edge INDICES (1-based) representing the path (start -> ... -> end), or null if no path found.
 */
export function findShortestPath(
  startEdgeIndex: number,
  endEdgeIndex: number,
  edgeArray: Edge[],
  routingCtx?: RoutingContext
): number[] | null {
  const startTime = performance.now();

  // Validate: 1-based index check and array bounds
  if (startEdgeIndex < 1 || endEdgeIndex < 1 ||
      !edgeArray[startEdgeIndex - 1] || !edgeArray[endEdgeIndex - 1]) {
    recordPerformance(performance.now() - startTime);
    return null;
  }
  if (startEdgeIndex === endEdgeIndex) {
    recordPerformance(performance.now() - startTime);
    return [startEdgeIndex];
  }

  const isDynamic = routingCtx && routingCtx.config.strategy !== "DISTANCE";

  // Check cache first (skip cache for dynamic strategies — congestion/EWMA changes)
  if (!isDynamic) {
    const cached = getCachedPath(startEdgeIndex, endEdgeIndex);
    if (cached !== undefined) {
      perfStats.cacheHits++;
      recordPerformance(performance.now() - startTime);
      return cached ? [...cached] : null; // Return copy to prevent mutation
    }
  }
  perfStats.cacheMisses++;

  // Set active context for processNeighbors → bprCost
  activeCtx = routingCtx ?? null;

  // Use array length + 1 to accommodate 1-based indexing
  const n = edgeArray.length + 1;
  ensureArraySize(n);
  resetArrays(n);
  heap.clear();

  // Init (using 1-based index directly)
  distArray[startEdgeIndex] = 0;
  heap.push(startEdgeIndex, 0);

  while (!heap.isEmpty()) {
    const node = heap.pop()!;
    const u = node.edgeIndex;
    const cost = node.cost;

    if (cost > distArray[u]) continue;
    if (u === endEdgeIndex) break; // Found target

    processNeighbors(u, cost, edgeArray);
  }

  // Clear active context
  activeCtx = null;

  // Reconstruct path
  const result = reconstructPath(startEdgeIndex, endEdgeIndex);

  // Cache the result (skip for dynamic strategies)
  if (!isDynamic) {
    setCachedPath(startEdgeIndex, endEdgeIndex, result);
  }

  recordPerformance(performance.now() - startTime);
  return result;
}

function processNeighbors(u: number, cost: number, edgeArray: Edge[]): void {
  // u is 1-based, convert to 0-based for array access
  const currentEdge = edgeArray[u - 1];
  if (!currentEdge) return;
  const nextIndices = currentEdge.nextEdgeIndices || [];

  for (const v of nextIndices) {
    // v is 1-based, convert to 0-based for array access
    if (v < 1 || !edgeArray[v - 1]) continue;

    const weight = edgeCost(edgeArray[v - 1], v);
    const alt = cost + weight;

    if (alt < distArray[v]) {
      distArray[v] = alt;
      prevArray[v] = u;
      heap.push(v, alt);
    }
  }
}

function reconstructPath(startEdgeIndex: number, endEdgeIndex: number): number[] | null {
  if (prevArray[endEdgeIndex] === 0) return null; // 0 is invalid sentinel

  const path: number[] = [];
  let curr = endEdgeIndex;

  while (curr !== 0 && curr !== startEdgeIndex) { // 0 is invalid sentinel
    path.push(curr);
    curr = prevArray[curr];
  }
  path.push(startEdgeIndex);
  path.reverse();
  return path;
}

/**
 * Record performance measurement
 */
function recordPerformance(elapsedTime: number): void {
  perfStats.count++;
  perfStats.totalTime += elapsedTime;
  perfStats.minTime = Math.min(perfStats.minTime, elapsedTime);
  perfStats.maxTime = Math.max(perfStats.maxTime, elapsedTime);

  // Log every 100000 calls
  if (perfStats.count % 100000 === 0) {
    logPerformanceStats();
  }
}

/**
 * Log current performance statistics (compact format)
 */
function logPerformanceStats(): void {
  // Rule A.1: Remove useless assignments - avg and hitRate not used
}

/**
 * Get current performance statistics
 */
export function getDijkstraPerformanceStats(): Readonly<PerformanceStats> {
  return { ...perfStats };
}

/**
 * Reset performance statistics
 */
export function resetDijkstraPerformanceStats(): void {
  perfStats.count = 0;
  perfStats.totalTime = 0;
  perfStats.minTime = Infinity;
  perfStats.maxTime = 0;
  perfStats.cacheHits = 0;
  perfStats.cacheMisses = 0;
}
