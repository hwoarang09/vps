import { vehicleDataArray, MovementData, NextEdgeState, VEHICLE_DATA_SIZE } from "@/store/vehicle/arrayMode/vehicleDataArray";
import { Edge } from "@/types/edge";
import { VehicleLoop, getNextEdgeInLoop } from "@/utils/vehicle/loopMaker";
import { TransferMode } from "@/store/vehicle/arrayMode/vehicleStore";

// Simple queue for now
const transferQueue: number[] = [];

/**
 * Enqueue vehicle for transfer processing
 */
export function enqueueVehicleTransfer(vehicleIndex: number) {
  transferQueue.push(vehicleIndex);
}

/**
 * Get current queue length
 */
export function getTransferQueueLength() {
  return transferQueue.length;
}

/**
 * Process the transfer queue (Main TransferMgr Logic)
 */
export function processTransferQueue(
  edgeArray: Edge[],
  vehicleLoopMap: Map<number, VehicleLoop>,
  edgeNameToIndex: Map<string, number>,
  mode: TransferMode
) {
  const data = vehicleDataArray.getData();

  // Process all pending requests (or limit count if performance issue arises)
  const queueLength = transferQueue.length;
  for (let i = 0; i < queueLength; i++) {
    const vehId = transferQueue.shift();
    if (vehId === undefined) break;

    const ptr = vehId * VEHICLE_DATA_SIZE;
    // Actually we should use VEHICLE_DATA_SIZE. Let's fix imports if needed or just use literal 18 for now strictly or import it?
    // I will use imports below, assume imports work.

    // Check if state is still PENDING (might have been reset if reset occurred?)
    // const state = data[ptr + MovementData.NEXT_EDGE_STATE];
    // if (state !== NextEdgeState.PENDING) continue; 
    // Optimization: Skip check if we trust queue integrity

    const currentEdgeIdx = Math.trunc(data[ptr + MovementData.CURRENT_EDGE]);
    const currentEdge = edgeArray[currentEdgeIdx];

    if (!currentEdge) {
        // Error case: Invalid edge, maybe just reset state?
        data[ptr + MovementData.NEXT_EDGE_STATE] = NextEdgeState.EMPTY;
        continue;
    }

    // Determine Next Edge
    const nextEdgeIndex = determineNextEdge(
      currentEdge,
      vehId,
      vehicleLoopMap,
      edgeNameToIndex,
      mode
    );

    // Assign Next Edge
    if (nextEdgeIndex === -1) {
        // No path found? Keep sending request? or Stop?
        // Ideally: retry later or stop. For now, leave as PENDING or reset to EMPTY?
        // If we leave as PENDING, it might get re-queued? No, we popped it.
        // We probably should reset to EMPTY so it requests again? 
        // Or if no path, maybe it will just stop naturally at the end.
      data[ptr + MovementData.NEXT_EDGE_STATE] = NextEdgeState.EMPTY;
    } else {
      data[ptr + MovementData.NEXT_EDGE] = nextEdgeIndex;
      data[ptr + MovementData.NEXT_EDGE_STATE] = NextEdgeState.READY;
    }
  }
}

/**
 * Helper: Determine next edge based on mode
 */
function determineNextEdge(
  currentEdge: Edge,
  vehicleIndex: number,
  vehicleLoopMap: Map<number, VehicleLoop>,
  edgeNameToIndex: Map<string, number>,
  mode: TransferMode
): number {
  // Common case: Direct transition (no diverge)
  if (canDirectlyTransition(currentEdge)) {
    return currentEdge.nextEdgeIndices![0];
  }

  // Diverge case: Handle based on mode
  if (mode === TransferMode.LOOP) {
    return getNextEdgeFromLoop(currentEdge, vehicleIndex, vehicleLoopMap, edgeNameToIndex);
  } else {
    // Random Mode
    return getNextEdgeRandomly(currentEdge);
  }
}

/**
 * Helper: Get next edge randomly
 */
function getNextEdgeRandomly(currentEdge: Edge): number {
  if (currentEdge.nextEdgeIndices && currentEdge.nextEdgeIndices.length > 0) {
    const randomIndex = Math.floor(Math.random() * currentEdge.nextEdgeIndices.length);
    return currentEdge.nextEdgeIndices[randomIndex];
  }
  return -1;
}


/**
 * Helper: Check if simple transition is possible
 */
function canDirectlyTransition(currentEdge: Edge): boolean {
  return !currentEdge.toNodeIsDiverge && (currentEdge.nextEdgeIndices?.length ?? 0) > 0;
}

/**
 * Helper: Get next edge from loop map or fallback
 */
function getNextEdgeFromLoop(
  currentEdge: Edge,
  vehicleIndex: number,
  vehicleLoopMap: Map<number, VehicleLoop>,
  edgeNameToIndex: Map<string, number>
): number {
  let nextEdgeIndex = -1;
  const loop = vehicleLoopMap.get(vehicleIndex);

  if (loop) {
     const nextName = getNextEdgeInLoop(currentEdge.edge_name, loop.edgeSequence);
     const found = edgeNameToIndex.get(nextName);
     if (found !== undefined) nextEdgeIndex = found;
  }

  // Fallback: This logic mirrors edgeTransition.ts
  if (nextEdgeIndex === -1 && currentEdge.nextEdgeIndices?.length) {
    nextEdgeIndex = currentEdge.nextEdgeIndices[0];
  }

  return nextEdgeIndex;
}
