// common/vehicle/logic/Dijkstra.ts
import { Edge } from "@/types/edge";

interface PathNode {
  edgeIndex: number;
  cost: number;
}

interface PerformanceStats {
  count: number;
  totalTime: number;
  minTime: number;
  maxTime: number;
}

// Performance tracking
const perfStats: PerformanceStats = {
  count: 0,
  totalTime: 0,
  minTime: Infinity,
  maxTime: 0,
};

/**
 * Finds the shortest path between startEdge and endEdge using Dijkstra's algorithm.
 * Since edges are nodes in the routing graph (Node-Edge duality), we traverse from edge to edge via connectivity.
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

  const dist = new Map<number, number>();
  const prev = new Map<number, number>();
  const queue: PathNode[] = [];

  // Init
  dist.set(startEdgeIndex, 0);
  queue.push({ edgeIndex: startEdgeIndex, cost: 0 });

  while (queue.length > 0) {
    // Sort descending to pop smallest
    queue.sort((a, b) => b.cost - a.cost);
    const { edgeIndex: u, cost } = queue.pop()!;

    if (cost > (dist.get(u) ?? Infinity)) continue;
    if (u === endEdgeIndex) break; // Found target

    processNeighbors(u, cost, edgeArray, dist, prev, queue);
  }

  // Reconstruct path
  const result = reconstructPath(endEdgeIndex, prev);
  
  // Record performance
  recordPerformance(performance.now() - startTime);
  
  return result;
}

function processNeighbors(
  u: number,
  cost: number,
  edgeArray: Edge[],
  dist: Map<number, number>,
  prev: Map<number, number>,
  queue: PathNode[]
) {
  const currentEdge = edgeArray[u];
  const nextIndices = currentEdge.nextEdgeIndices || [];

  for (const v of nextIndices) {
    if (!edgeArray[v]) continue;

    const weight = edgeArray[v].distance; // Cost to traverse edge v
    const alt = cost + weight;

    if (alt < (dist.get(v) ?? Infinity)) {
      dist.set(v, alt);
      prev.set(v, u);
      queue.push({ edgeIndex: v, cost: alt });
    }
  }
}

function reconstructPath(endEdgeIndex: number, prev: Map<number, number>): number[] | null {
  if (!prev.has(endEdgeIndex)) return null;

  const path: number[] = [];
  let curr: number | undefined = endEdgeIndex;
  
  while (curr !== undefined) {
    path.unshift(curr);
    curr = prev.get(curr);
  }
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
  
  // Log every 1000 calls (reduced from 100 to avoid spam)
  if (perfStats.count % 1000 === 0) {
    logPerformanceStats();
  }
}

/**
 * Log current performance statistics (compact format)
 */
function logPerformanceStats(): void {
  const avg = perfStats.totalTime / perfStats.count;
  console.log(`[Dijkstra] ${perfStats.count} calls | Avg: ${avg.toFixed(3)}ms | Min: ${perfStats.minTime.toFixed(3)}ms | Max: ${perfStats.maxTime.toFixed(3)}ms`);
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
}
