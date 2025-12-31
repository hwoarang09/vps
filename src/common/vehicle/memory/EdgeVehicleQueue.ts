// common/vehicle/memory/EdgeVehicleQueue.ts
// Edge-based vehicle order management using Int32Array

import { VEHICLE_DATA_SIZE, MovementData } from "@/common/vehicle/initialize/constants";

const MAX_VEHICLES_PER_EDGE = 500;
const EDGE_LIST_SIZE = MAX_VEHICLES_PER_EDGE + 1; // count + vehicles

export class EdgeVehicleQueue {
  private readonly dataArrays: Int32Array[];
  private readonly maxEdges: number;

  constructor(maxEdges: number) {
    this.maxEdges = maxEdges;
    this.dataArrays = [];

    for (let i = 0; i < maxEdges; i++) {
      const data = new Int32Array(EDGE_LIST_SIZE);
      data[0] = 0;
      data.fill(-1, 1);
      this.dataArrays.push(data);
    }
  }

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

    // Check for duplicates
    for (let i = 0; i < count; i++) {
      if (data[1 + i] === vehicleIndex) {
        console.warn(
          `[EdgeQueue] DUPLICATE! VEH${vehicleIndex} already in Edge${edgeIndex} at position ${i}`
        );
        return;
      }
    }

    data[1 + count] = vehicleIndex;
    data[0] = count + 1;
  }

  removeVehicle(edgeIndex: number, vehicleIndex: number): void {
    if (edgeIndex < 0 || edgeIndex >= this.maxEdges) {
      console.error(`Invalid edge index: ${edgeIndex}`);
      return;
    }

    const data = this.dataArrays[edgeIndex];
    const count = data[0];

    for (let i = 0; i < count; i++) {
      if (data[1 + i] === vehicleIndex) {
        for (let j = i; j < count - 1; j++) {
          data[1 + j] = data[1 + j + 1];
        }
        data[1 + count - 1] = -1;
        data[0] = count - 1;
        return;
      }
    }

    console.warn(
      `[EdgeQueue] Vehicle ${vehicleIndex} not found in edge ${edgeIndex}`
    );
  }

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

  getCount(edgeIndex: number): number {
    if (edgeIndex < 0 || edgeIndex >= this.maxEdges) {
      console.error(`Invalid edge index: ${edgeIndex}`);
      return 0;
    }

    return this.dataArrays[edgeIndex][0];
  }

  getData(edgeIndex: number): Int32Array | null {
    if (edgeIndex < 0 || edgeIndex >= this.maxEdges) {
      console.error(`Invalid edge index: ${edgeIndex}`);
      return null;
    }

    return this.dataArrays[edgeIndex];
  }

  clearEdge(edgeIndex: number): void {
    if (edgeIndex < 0 || edgeIndex >= this.maxEdges) {
      console.error(`Invalid edge index: ${edgeIndex}`);
      return;
    }

    const data = this.dataArrays[edgeIndex];
    data[0] = 0;
    data.fill(-1, 1);
  }

  clearAll(): void {
    for (let i = 0; i < this.maxEdges; i++) {
      this.clearEdge(i);
    }
  }

  getMaxEdges(): number {
    return this.maxEdges;
  }

  hasVehicles(edgeIndex: number): boolean {
    if (edgeIndex < 0 || edgeIndex >= this.maxEdges) {
      return false;
    }
    return this.dataArrays[edgeIndex][0] > 0;
  }

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

  sortByEdgeRatio(edgeIndex: number, vehicleData: Float32Array): void {
    if (edgeIndex < 0 || edgeIndex >= this.maxEdges) {
      console.error(`Invalid edge index: ${edgeIndex}`);
      return;
    }

    const data = this.dataArrays[edgeIndex];
    const count = data[0];

    if (count <= 1) return;

    const vehicles: number[] = [];
    for (let i = 0; i < count; i++) {
      vehicles.push(data[1 + i]);
    }

    const EDGE_RATIO_OFFSET = MovementData.EDGE_RATIO;

    vehicles.sort((a, b) => {
      const ratioA = vehicleData[a * VEHICLE_DATA_SIZE + EDGE_RATIO_OFFSET];
      const ratioB = vehicleData[b * VEHICLE_DATA_SIZE + EDGE_RATIO_OFFSET];
      return ratioB - ratioA;
    });

    for (let i = 0; i < count; i++) {
      data[1 + i] = vehicles[i];
    }
  }
}

export default EdgeVehicleQueue;
