// edgeVehicleQueue.ts
// Edge-based vehicle order management using Int32Array (single thread)

import { VEHICLE_DATA_SIZE, MovementData } from "./vehicleDataArray";

const MAX_VEHICLES_PER_EDGE = 500;
const EDGE_LIST_SIZE = MAX_VEHICLES_PER_EDGE + 1; // count + vehicles

class EdgeVehicleQueue {
  private dataArrays: Int32Array[];
  private maxEdges: number;

  constructor(maxEdges: number) {
    this.maxEdges = maxEdges;
    this.dataArrays = [];

    // Create separate Int32Array for each edge
    for (let i = 0; i < maxEdges; i++) {
      const data = new Int32Array(EDGE_LIST_SIZE);
      data[0] = 0; // count = 0
      data.fill(-1, 1); // vehicles = -1 (empty)
      this.dataArrays.push(data);
    }
  }

  /**
   * Add vehicle to edge list (just append to end)
   */
  addVehicle(edgeIndex: number, vehicleIndex: number): void {
    if (edgeIndex < 0 || edgeIndex >= this.maxEdges) {
      console.error(`Invalid edge index: ${edgeIndex}`);
      return;
    }

    const data = this.dataArrays[edgeIndex];
    const count = data[0];

    if (count >= MAX_VEHICLES_PER_EDGE) {
      console.error(
        `Edge ${edgeIndex} is full (max ${MAX_VEHICLES_PER_EDGE} vehicles)`
      );
      return;
    }

    // Check for duplicates (DEBUG)
    for (let i = 0; i < count; i++) {
      if (data[1 + i] === vehicleIndex) {
        console.warn(`[EdgeQueue] DUPLICATE! VEH${vehicleIndex} already in Edge${edgeIndex} at position ${i}`);
        console.trace(); // Print stack trace
        return; // Don't add duplicate
      }
    }

    // Add vehicle at the end
    data[1 + count] = vehicleIndex;
    data[0] = count + 1;

    // // Debug log (sample 1%)
    // if (Math.random() < 0.01) {
    //   console.log(`[EdgeList] Added VEH${vehicleIndex} to Edge${edgeIndex} (count: ${count + 1})`);
    // }
  }

  /**
   * Remove vehicle from edge list
   */
  removeVehicle(edgeIndex: number, vehicleIndex: number): void {
    if (edgeIndex < 0 || edgeIndex >= this.maxEdges) {
      console.error(`Invalid edge index: ${edgeIndex}`);
      return;
    }

    const data = this.dataArrays[edgeIndex];
    const count = data[0];

    // Find and remove vehicle
    for (let i = 0; i < count; i++) {
      if (data[1 + i] === vehicleIndex) {
        // Shift remaining vehicles forward
        for (let j = i; j < count - 1; j++) {
          data[1 + j] = data[1 + j + 1];
        }
        data[1 + count - 1] = -1; // Clear last slot
        data[0] = count - 1; // Decrease count

        // Debug log (sample 1%)
        if (Math.random() < 0.01) {
          console.log(`[EdgeList] Removed VEH${vehicleIndex} from Edge${edgeIndex} (count: ${count - 1})`);
        }
        return;
      }
    }

    console.warn(
      `[EdgeQueue] Vehicle ${vehicleIndex} not found in edge ${edgeIndex} (tried to remove)`
    );
  }

  /**
   * Get all vehicles in an edge (returns array copy)
   */
  getVehicles(edgeIndex: number): number[] {
    if (edgeIndex < 0 || edgeIndex >= this.maxEdges) {
      console.error(`Invalid edge index: ${edgeIndex}`);
      return [];
    }

    const data = this.dataArrays[edgeIndex];
    const count = data[0];
    const vehicles: number[] = [];

    for (let i = 0; i < count; i++) {
      vehicles.push(data[1 + i]);
    }

    return vehicles;
  }

  /**
   * Get vehicle count in an edge
   */
  getCount(edgeIndex: number): number {
    if (edgeIndex < 0 || edgeIndex >= this.maxEdges) {
      console.error(`Invalid edge index: ${edgeIndex}`);
      return 0;
    }

    return this.dataArrays[edgeIndex][0];
  }

  /**
   * Get Int32Array for a specific edge (direct access)
   */
  getData(edgeIndex: number): Int32Array | null {
    if (edgeIndex < 0 || edgeIndex >= this.maxEdges) {
      console.error(`Invalid edge index: ${edgeIndex}`);
      return null;
    }

    return this.dataArrays[edgeIndex];
  }

  /**
   * Clear all vehicles from an edge
   */
  clearEdge(edgeIndex: number): void {
    if (edgeIndex < 0 || edgeIndex >= this.maxEdges) {
      console.error(`Invalid edge index: ${edgeIndex}`);
      return;
    }

    const data = this.dataArrays[edgeIndex];
    data[0] = 0; // count = 0
    data.fill(-1, 1); // clear all vehicles
  }

  /**
   * Clear all edges
   */
  clearAll(): void {
    for (let i = 0; i < this.maxEdges; i++) {
      this.clearEdge(i);
    }
  }

  /**
   * Get max edges
   */
  getMaxEdges(): number {
    return this.maxEdges;
  }

  /**
   * Check if edge has any vehicles
   */
  hasVehicles(edgeIndex: number): boolean {
    if (edgeIndex < 0 || edgeIndex >= this.maxEdges) {
      return false;
    }
    return this.dataArrays[edgeIndex][0] > 0;
  }

  /**
   * Get vehicle at specific position in edge list
   */
  getVehicleAt(edgeIndex: number, position: number): number {
    if (edgeIndex < 0 || edgeIndex >= this.maxEdges) {
      console.error(`Invalid edge index: ${edgeIndex}`);
      return -1;
    }

    const data = this.dataArrays[edgeIndex];
    const count = data[0];

    if (position < 0 || position >= count) {
      return -1;
    }

    return data[1 + position];
  }

  /**
   * Sort vehicles in edge by edgeRatio (descending order - front to back)
   * Front vehicle has higher edgeRatio (closer to end of edge)
   */
  sortByEdgeRatio(edgeIndex: number, vehicleData: Float32Array): void {
    if (edgeIndex < 0 || edgeIndex >= this.maxEdges) {
      console.error(`Invalid edge index: ${edgeIndex}`);
      return;
    }

    const data = this.dataArrays[edgeIndex];
    const count = data[0];

    if (count <= 1) return; // No need to sort

    // Extract vehicle indices
    const vehicles: number[] = [];
    for (let i = 0; i < count; i++) {
      vehicles.push(data[1 + i]);
    }

    // Sort by edgeRatio (descending - front to back)
    // Use imported VEHICLE_DATA_SIZE and MovementData.EDGE_RATIO
    const EDGE_RATIO_OFFSET = MovementData.EDGE_RATIO;

    // DEBUG: Log before sort
    // console.log(`  [EdgeQueue] Edge${edgeIndex} BEFORE sort:`);
    vehicles.forEach((vehIdx, i) => {
      const ratio = vehicleData[vehIdx * VEHICLE_DATA_SIZE + EDGE_RATIO_OFFSET];
      // console.log(`    [${i}] VEH${vehIdx}: ratio=${ratio.toFixed(3)}`);
    });

    vehicles.sort((a, b) => {
      const ratioA = vehicleData[a * VEHICLE_DATA_SIZE + EDGE_RATIO_OFFSET];
      const ratioB = vehicleData[b * VEHICLE_DATA_SIZE + EDGE_RATIO_OFFSET];
      return ratioB - ratioA; // Descending order
    });

    // DEBUG: Log after sort
    // console.log(`  [EdgeQueue] Edge${edgeIndex} AFTER sort:`);
    vehicles.forEach((vehIdx, i) => {
      const ratio = vehicleData[vehIdx * VEHICLE_DATA_SIZE + EDGE_RATIO_OFFSET];
      // console.log(`    [${i}] VEH${vehIdx}: ratio=${ratio.toFixed(3)}`);
    });

    // Write sorted vehicles back to array
    for (let i = 0; i < count; i++) {
      data[1 + i] = vehicles[i];
    }
  }
}

// Singleton instance (1000 edges, 500 vehicles per edge max)
export const edgeVehicleQueue = new EdgeVehicleQueue(200000);

export default EdgeVehicleQueue;
