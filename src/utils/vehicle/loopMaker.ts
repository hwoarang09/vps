


/**
 * Loop definition for vehicle movement
 * Each vehicle follows a sequence of edges in a loop
 */
export interface VehicleLoop {
  vehicleIndex: number;
  edgeSequence: string[]; // Array of edge names to follow in order
}






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

