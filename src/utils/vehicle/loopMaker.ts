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
 * Find all independent loops in the edge network
 * Starting from straight edges, follow connections to form loops
 * @param allEdges All edges in the map
 * @returns Array of independent loops
 */
export const findEdgeLoops = (allEdges: Edge[]): EdgeLoop[] => {
  const loops: EdgeLoop[] = [];
  const visited = new Set<number>();

  console.log(`[LoopMaker] Starting loop detection with ${allEdges.length} edges`);

  // Try to start from each unvisited edge
  for (let startIdx = 0; startIdx < allEdges.length; startIdx++) {
    if (visited.has(startIdx)) continue;

    const loopEdgeNames: string[] = [];
    const loopEdgeIndices: number[] = [];
    let currentIdx = startIdx;
    let foundLoop = false;
    let iterations = 0;
    const maxIterations = allEdges.length + 1; // Prevent infinite loops

    // Follow edges until we return to start or hit a dead end
    while (iterations < maxIterations) {
      iterations++;

      const currentEdge = allEdges[currentIdx];
      loopEdgeNames.push(currentEdge.edge_name);
      loopEdgeIndices.push(currentIdx);
      const toNode = currentEdge.to_node;

      // Find next edge that starts from current edge's end node
      let nextIdx = -1;
      for (let i = 0; i < allEdges.length; i++) {
        if (allEdges[i].from_node === toNode) {
          // Allow connecting back to start edge to complete loop
          if (i === startIdx && loopEdgeIndices.length > 1) {
            nextIdx = i;
            foundLoop = true;
            break;
          }
          // Don't revisit edges already in this loop (except start edge)
          if (!loopEdgeIndices.includes(i)) {
            nextIdx = i;
            break;
          }
        }
      }

      // Check if we completed a loop
      if (foundLoop) {
        break;
      }

      // Dead end - no next edge found
      if (nextIdx === -1) {
        break;
      }

      currentIdx = nextIdx;
    }

    // Only add if we found a valid loop
    if (foundLoop && loopEdgeNames.length > 0) {
      loops.push({ edgeNames: loopEdgeNames });
      for (const idx of loopEdgeIndices) {
        visited.add(idx);
      }
    } else {
      console.log(`[LoopMaker] ✗ No loop found starting from edge ${startIdx}`);
    }
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

