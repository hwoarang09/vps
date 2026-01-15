// common/vehicle/logic/Dijkstra.ts
import { Edge } from "@/types/edge";

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
    prevArray.push(-1);
  }
}

function resetArrays(size: number): void {
  for (let i = 0; i < size; i++) {
    distArray[i] = Infinity;
    prevArray[i] = -1;
  }
}

/**
 * Finds the shortest path between startEdge and endEdge using Dijkstra's algorithm.
 * Uses Min-Heap for O(E log V) complexity and LRU cache for repeated queries.
 *
 * @param startEdgeIndex Index of the starting edge
 * @param endEdgeIndex Index of the destination edge
 * @param edgeArray Full array of all edges
 * @returns Array of edge INDICES representing the path (start -> ... -> end), or null if no path found.
 */
export function findShortestPath(
  startEdgeIndex: number,
  endEdgeIndex: number,
  edgeArray: Edge[]
): number[] | null {
  const startTime = performance.now();

  if (!edgeArray[startEdgeIndex] || !edgeArray[endEdgeIndex]) {
    recordPerformance(performance.now() - startTime);
    return null;
  }
  if (startEdgeIndex === endEdgeIndex) {
    recordPerformance(performance.now() - startTime);
    return [startEdgeIndex];
  }

  // Check cache first
  const cached = getCachedPath(startEdgeIndex, endEdgeIndex);
  if (cached !== undefined) {
    perfStats.cacheHits++;
    recordPerformance(performance.now() - startTime);
    return cached ? [...cached] : null; // Return copy to prevent mutation
  }
  perfStats.cacheMisses++;

  const n = edgeArray.length;
  ensureArraySize(n);
  resetArrays(n);
  heap.clear();

  // Init
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

  // Reconstruct path
  const result = reconstructPath(startEdgeIndex, endEdgeIndex);

  // Cache the result
  setCachedPath(startEdgeIndex, endEdgeIndex, result);

  recordPerformance(performance.now() - startTime);
  return result;
}

function processNeighbors(u: number, cost: number, edgeArray: Edge[]): void {
  const currentEdge = edgeArray[u];
  const nextIndices = currentEdge.nextEdgeIndices || [];

  for (const v of nextIndices) {
    if (!edgeArray[v]) continue;

    const weight = edgeArray[v].distance;
    const alt = cost + weight;

    if (alt < distArray[v]) {
      distArray[v] = alt;
      prevArray[v] = u;
      heap.push(v, alt);
    }
  }
}

function reconstructPath(startEdgeIndex: number, endEdgeIndex: number): number[] | null {
  if (prevArray[endEdgeIndex] === -1) return null;

  const path: number[] = [];
  let curr = endEdgeIndex;

  while (curr !== -1 && curr !== startEdgeIndex) {
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
  const avg = perfStats.totalTime / perfStats.count;
  const hitRate = perfStats.cacheHits + perfStats.cacheMisses > 0
    ? ((perfStats.cacheHits / (perfStats.cacheHits + perfStats.cacheMisses)) * 100).toFixed(1)
    : "0.0";
  console.log(
    `[Dijkstra] ${perfStats.count} calls | Avg: ${avg.toFixed(3)}ms | ` +
    `Min: ${perfStats.minTime.toFixed(3)}ms | Max: ${perfStats.maxTime.toFixed(3)}ms | ` +
    `Cache: ${hitRate}% (${perfStats.cacheHits}/${perfStats.cacheHits + perfStats.cacheMisses})`
  );
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
