import { Edge } from "@/types";

/**
 * Loop definition for vehicle movement
 * Each vehicle follows a sequence of edges in a loop
 */
export interface VehicleLoop {
  vehicleIndex: number;
  edgeSequence: string[]; // Array of edge names to follow in order
}

/**
 * Independent loop found in the map
 */
export interface EdgeLoop {
  edgeNames: string[]; // Edge names that form this loop
}

/**
 * Result types for edge traversal
 */
type NextEdgeResult =
  | { type: 'loop_completed'; edgeIdx: number }
  | { type: 'continue'; edgeIdx: number }
  | { type: 'dead_end' };

/**
 * Result types for loop tracing
 */
type LoopTraceResult =
  | { type: 'success'; edgeNames: string[]; edgeIndices: number[] }
  | { type: 'failed'; reason: 'dead_end' | 'max_iterations' };

/**
 * Find next edge index that connects from the given node
 */
function findNextEdge(
  allEdges: Edge[],
  fromNode: string,
  startIdx: number,
  loopEdgeIndices: number[]
): NextEdgeResult {
  for (let i = 0; i < allEdges.length; i++) {
    if (allEdges[i].from_node === fromNode) {
      // Allow connecting back to start edge to complete loop
      if (i === startIdx && loopEdgeIndices.length > 1) {
        return { type: 'loop_completed', edgeIdx: i };
      }
      // Don't revisit edges already in this loop (except start edge)
      if (!loopEdgeIndices.includes(i)) {
        return { type: 'continue', edgeIdx: i };
      }
    }
  }
  return { type: 'dead_end' };
}

/**
 * Trace a loop starting from a given edge index
 */
function traceLoop(
  allEdges: Edge[],
  startIdx: number
): LoopTraceResult {
  const loopEdgeNames: string[] = [];
  const loopEdgeIndices: number[] = [];
  let currentIdx = startIdx;
  let iterations = 0;
  const maxIterations = allEdges.length + 1;

  while (iterations < maxIterations) {
    iterations++;

    const currentEdge = allEdges[currentIdx];
    loopEdgeNames.push(currentEdge.edge_name);
    loopEdgeIndices.push(currentIdx);
    const toNode = currentEdge.to_node;

    const result = findNextEdge(allEdges, toNode, startIdx, loopEdgeIndices);

    if (result.type === 'loop_completed') {
      return { type: 'success', edgeNames: loopEdgeNames, edgeIndices: loopEdgeIndices };
    }

    if (result.type === 'dead_end') {
      return { type: 'failed', reason: 'dead_end' };
    }

    currentIdx = result.edgeIdx;
  }

  return { type: 'failed', reason: 'max_iterations' };
}

/**
 * Process loop trace result
 */
function processLoopResult(
  loops: EdgeLoop[],
  visited: Set<number>,
  result: LoopTraceResult,
  startIdx: number
): void {
  if (result.type === 'success') {
    loops.push({ edgeNames: result.edgeNames });
    for (const idx of result.edgeIndices) {
      visited.add(idx);
    }
  } else {
    console.log(`[LoopMaker] ✗ No loop found starting from edge ${startIdx} (${result.reason})`);
  }
}

/**
 * Find all independent loops in the edge network
 * Starting from straight edges, follow connections to form loops
 * @param allEdges All edges in the map
 * @returns Array of independent loops
 */
export const findEdgeLoops = (allEdges: Edge[]): EdgeLoop[] => {
  const loops: EdgeLoop[] = [];
  const visited = new Set<number>();

  console.log(`[LoopMaker] Starting loop detection with ${allEdges.length} edges`);

  for (let startIdx = 0; startIdx < allEdges.length; startIdx++) {
    if (visited.has(startIdx)) continue;

    const result = traceLoop(allEdges, startIdx);
    processLoopResult(loops, visited, result, startIdx);
  }

  console.log(`[LoopMaker] Found ${loops.length} independent loops total`);
  return loops;
};

/**
 * Assign vehicles to loops
 * Assigns all vehicles to the first loop (for now)
 * @param edgeLoops Array of independent loops
 * @param numVehicles Total number of vehicles to assign
 * @returns Array of vehicle loops
 */
export const assignVehiclesToLoops = (
  edgeLoops: EdgeLoop[],
  numVehicles: number
): VehicleLoop[] => {
  const vehicleLoops: VehicleLoop[] = [];

  if (edgeLoops.length === 0) {
    console.warn('[LoopMaker] No loops found, cannot assign vehicles');
    return vehicleLoops;
  }

  // Assign all vehicles to the first loop
  const firstLoop = edgeLoops[0];
  for (let i = 0; i < numVehicles; i++) {
    vehicleLoops.push({
      vehicleIndex: i,
      edgeSequence: [...firstLoop.edgeNames]
    });
  }

  console.log(`[LoopMaker] Assigned ${numVehicles} vehicles to first loop (out of ${edgeLoops.length} loops)`);

  return vehicleLoops;
};

/**
 * Get next edge name in the loop
 * @param currentEdgeName Current edge name
 * @param edgeSequence Edge sequence for this vehicle (edge names)
 * @returns Next edge name
 */
export const getNextEdgeInLoop = (
  currentEdgeName: string,
  edgeSequence: string[]
): string => {
  const currentPosition = edgeSequence.indexOf(currentEdgeName);

  if (currentPosition === -1) {
    console.warn(`Current edge ${currentEdgeName} not found in sequence, returning first edge`);
    return edgeSequence[0];
  }

  // Move to next edge, wrap around to start if at end
  const nextPosition = (currentPosition + 1) % edgeSequence.length;
  return edgeSequence[nextPosition];
};

