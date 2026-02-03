// common/vehicle/memory/EdgeVehicleQueue.ts
// Edge-based vehicle order management using Int32Array

import { VEHICLE_DATA_SIZE, MovementData } from "@/common/vehicle/initialize/constants";

const MAX_VEHICLES_PER_EDGE = 100;
const EDGE_LIST_SIZE = MAX_VEHICLES_PER_EDGE + 1; // count + vehicles

export { EDGE_LIST_SIZE };

export class EdgeVehicleQueue {
  private readonly data: Int32Array;
  private readonly maxEdges: number;
  public readonly edgeListSize = EDGE_LIST_SIZE;

  constructor(maxEdges: number) {
    this.maxEdges = maxEdges;

    // Single contiguous Int32Array for all edges
    this.data = new Int32Array(maxEdges * EDGE_LIST_SIZE);

    // Initialize all edge counts to 0 and fill rest with -1
    for (let i = 0; i < maxEdges; i++) {
      const offset = i * EDGE_LIST_SIZE;
      this.data[offset] = 0; // count = 0
      this.data.fill(-1, offset + 1, offset + EDGE_LIST_SIZE);
    }
  }

  /**
   * Add a vehicle to an edge's queue
   * NOTE: edgeIndex is 1-based. 0 is invalid sentinel.
   */
  addVehicle(edgeIndex: number, vehicleIndex: number): void {
    // Convert 1-based to 0-based for internal array access
    const idx = edgeIndex - 1;
    if (idx < 0 || idx >= this.maxEdges) {
      return;
    }

    const offset = idx * EDGE_LIST_SIZE;
    const count = this.data[offset];

    if (count >= MAX_VEHICLES_PER_EDGE) {
      return;
    }

    // Check for duplicates
    for (let i = 0; i < count; i++) {
      if (this.data[offset + 1 + i] === vehicleIndex) {
        return;
      }
    }

    this.data[offset + 1 + count] = vehicleIndex;
    this.data[offset] = count + 1;
  }

  /**
   * Remove a vehicle from an edge's queue
   * NOTE: edgeIndex is 1-based. 0 is invalid sentinel.
   */
  removeVehicle(edgeIndex: number, vehicleIndex: number): void {
    // Convert 1-based to 0-based for internal array access
    const idx = edgeIndex - 1;
    if (idx < 0 || idx >= this.maxEdges) {
      return;
    }

    const offset = idx * EDGE_LIST_SIZE;
    const count = this.data[offset];

    for (let i = 0; i < count; i++) {
      if (this.data[offset + 1 + i] === vehicleIndex) {
        for (let j = i; j < count - 1; j++) {
          this.data[offset + 1 + j] = this.data[offset + 1 + j + 1];
        }
        this.data[offset + 1 + count - 1] = -1;
        this.data[offset] = count - 1;
        return;
      }
    }

  }

  /**
   * Get all vehicles on an edge
   * NOTE: edgeIndex is 1-based. 0 is invalid sentinel.
   */
  getVehicles(edgeIndex: number): number[] {
    // Convert 1-based to 0-based for internal array access
    const idx = edgeIndex - 1;
    if (idx < 0 || idx >= this.maxEdges) {
      return [];
    }

    const offset = idx * EDGE_LIST_SIZE;
    const count = this.data[offset];
    const vehicles: number[] = [];

    for (let i = 0; i < count; i++) {
      vehicles.push(this.data[offset + 1 + i]);
    }

    return vehicles;
  }

  /**
   * Get vehicle count on an edge
   * NOTE: edgeIndex is 1-based. 0 is invalid sentinel.
   */
  getCount(edgeIndex: number): number {
    // Convert 1-based to 0-based for internal array access
    const idx = edgeIndex - 1;
    if (idx < 0 || idx >= this.maxEdges) {
      return 0;
    }

    return this.data[idx * EDGE_LIST_SIZE];
  }

  /**
   * Get edge data as Int32Array view
   * NOTE: edgeIndex is 1-based. 0 is invalid sentinel.
   */
  getData(edgeIndex: number): Int32Array | null {
    // Convert 1-based to 0-based for internal array access
    const idx = edgeIndex - 1;
    if (idx < 0 || idx >= this.maxEdges) {
      return null;
    }

    // Return zero-copy view of this edge's data
    const offset = idx * EDGE_LIST_SIZE;
    return this.data.subarray(offset, offset + EDGE_LIST_SIZE);
  }

  /**
   * PERFORMANCE: Direct access methods for hot paths (collision check)
   * Avoid subarray() overhead by using direct index calculation
   */

  /**
   * Get the underlying data array for direct access
   * Use with getOffsetForEdge() for maximum performance
   */
  getDataDirect(): Int32Array {
    return this.data;
  }

  /**
   * Calculate offset for direct array access
   * Usage: data[offset + 0] = count, data[offset + 1...] = vehicle IDs
   * NOTE: edgeIndex is 1-based. 0 is invalid sentinel.
   */
  getOffsetForEdge(edgeIndex: number): number {
    // Convert 1-based to 0-based for internal array access
    return (edgeIndex - 1) * EDGE_LIST_SIZE;
  }

  /**
   * Clear all vehicles from an edge
   * NOTE: edgeIndex is 1-based. 0 is invalid sentinel.
   */
  clearEdge(edgeIndex: number): void {
    // Convert 1-based to 0-based for internal array access
    const idx = edgeIndex - 1;
    if (idx < 0 || idx >= this.maxEdges) {
      return;
    }

    const offset = idx * EDGE_LIST_SIZE;
    this.data[offset] = 0;
    this.data.fill(-1, offset + 1, offset + EDGE_LIST_SIZE);
  }

  clearAll(): void {
    for (let i = 0; i < this.maxEdges; i++) {
      const offset = i * EDGE_LIST_SIZE;
      this.data[offset] = 0;
      this.data.fill(-1, offset + 1, offset + EDGE_LIST_SIZE);
    }
  }

  getMaxEdges(): number {
    return this.maxEdges;
  }

  /**
   * Check if an edge has any vehicles
   * NOTE: edgeIndex is 1-based. 0 is invalid sentinel.
   */
  hasVehicles(edgeIndex: number): boolean {
    // Convert 1-based to 0-based for internal array access
    const idx = edgeIndex - 1;
    if (idx < 0 || idx >= this.maxEdges) {
      return false;
    }
    return this.data[idx * EDGE_LIST_SIZE] > 0;
  }

  /**
   * Get vehicle at a specific position on an edge
   * NOTE: edgeIndex is 1-based. 0 is invalid sentinel.
   */
  getVehicleAt(edgeIndex: number, position: number): number {
    // Convert 1-based to 0-based for internal array access
    const idx = edgeIndex - 1;
    if (idx < 0 || idx >= this.maxEdges) {
      return -1;
    }

    const offset = idx * EDGE_LIST_SIZE;
    const count = this.data[offset];

    if (position < 0 || position >= count) {
      return -1;
    }

    return this.data[offset + 1 + position];
  }

  /**
   * Sort vehicles on an edge by their edge ratio
   * NOTE: edgeIndex is 1-based. 0 is invalid sentinel.
   */
  sortByEdgeRatio(edgeIndex: number, vehicleData: Float32Array): void {
    // Convert 1-based to 0-based for internal array access
    const idx = edgeIndex - 1;
    if (idx < 0 || idx >= this.maxEdges) {
      return;
    }

    const offset = idx * EDGE_LIST_SIZE;
    const count = this.data[offset];

    if (count <= 1) return;

    const vehicles: number[] = [];
    for (let i = 0; i < count; i++) {
      vehicles.push(this.data[offset + 1 + i]);
    }

    const EDGE_RATIO_OFFSET = MovementData.EDGE_RATIO;

    vehicles.sort((a, b) => {
      const ratioA = vehicleData[a * VEHICLE_DATA_SIZE + EDGE_RATIO_OFFSET];
      const ratioB = vehicleData[b * VEHICLE_DATA_SIZE + EDGE_RATIO_OFFSET];
      return ratioB - ratioA;
    });

    for (let i = 0; i < count; i++) {
      this.data[offset + 1 + i] = vehicles[i];
    }
  }

  /**
   * Dispose all internal data to allow garbage collection
   */
  dispose(): void {
    // No-op: single Int32Array will be garbage collected when reference is lost
  }
}

export default EdgeVehicleQueue;
