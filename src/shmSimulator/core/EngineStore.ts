// shmSimulator/core/EngineStore.ts
// Internal store class replacing Zustand vehicleArrayStore

import VehicleDataArray from "../memory/vehicleDataArray";
import EdgeVehicleQueue from "../memory/edgeVehicleQueue";
import { TransferMode } from "../types";
import type { IVehicleStore, IEdgeVehicleQueue } from "@/common/vehicle/initialize";

export class EngineStore implements IVehicleStore {
  private vehicleDataArray: VehicleDataArray;
  private edgeVehicleQueue: EdgeVehicleQueue;

  public actualNumVehicles: number = 0;
  public transferMode: TransferMode = 0; // LOOP

  constructor(maxVehicles: number, maxEdges: number) {
    this.vehicleDataArray = new VehicleDataArray(maxVehicles);
    this.edgeVehicleQueue = new EdgeVehicleQueue(maxEdges);
  }

  /**
   * Set SharedArrayBuffer for Main-Worker communication
   */
  setSharedBuffer(buffer: SharedArrayBuffer): void {
    this.vehicleDataArray.setBuffer(buffer);
  }

  // === Data Accessors ===

  getVehicleDataArray(): VehicleDataArray {
    return this.vehicleDataArray;
  }

  getEdgeVehicleQueue(): EdgeVehicleQueue {
    return this.edgeVehicleQueue;
  }

  getVehicleDataRef(): Float32Array {
    return this.vehicleDataArray.getData();
  }

  // IVehicleStore interface method
  getVehicleData(): Float32Array {
    return this.vehicleDataArray.getData();
  }

  // === Configuration ===

  setActualNumVehicles(num: number): void {
    this.actualNumVehicles = num;
  }

  setTransferMode(mode: TransferMode): void {
    this.transferMode = mode;
  }

  // === Vehicle Position/Rotation ===

  setVehiclePosition(vehicleIndex: number, x: number, y: number, z: number): void {
    const vehicle = this.vehicleDataArray.get(vehicleIndex);
    vehicle.movement.x = x;
    vehicle.movement.y = y;
    vehicle.movement.z = z;
  }

  getVehiclePosition(vehicleIndex: number): { x: number; y: number; z: number } {
    return this.vehicleDataArray.getPosition(vehicleIndex);
  }

  setVehicleRotation(vehicleIndex: number, rotation: number): void {
    const vehicle = this.vehicleDataArray.get(vehicleIndex);
    vehicle.movement.rotation = rotation;
  }

  getVehicleRotation(vehicleIndex: number): number {
    return this.vehicleDataArray.getRotation(vehicleIndex);
  }

  // === Vehicle Velocity ===

  setVehicleVelocity(vehicleIndex: number, velocity: number): void {
    const vehicle = this.vehicleDataArray.get(vehicleIndex);
    vehicle.movement.velocity = velocity;
  }

  getVehicleVelocity(vehicleIndex: number): number {
    return this.vehicleDataArray.getVelocity(vehicleIndex);
  }

  // === Vehicle Status ===

  setVehicleMovingStatus(vehicleIndex: number, status: number): void {
    const vehicle = this.vehicleDataArray.get(vehicleIndex);
    vehicle.movement.movingStatus = status;
  }

  getVehicleMovingStatus(vehicleIndex: number): number {
    return this.vehicleDataArray.getMovingStatus(vehicleIndex);
  }

  // === Vehicle Acceleration/Deceleration ===

  setVehicleAcceleration(vehicleIndex: number, acceleration: number): void {
    const vehicle = this.vehicleDataArray.get(vehicleIndex);
    vehicle.movement.acceleration = acceleration;
  }

  setVehicleDeceleration(vehicleIndex: number, deceleration: number): void {
    const vehicle = this.vehicleDataArray.get(vehicleIndex);
    vehicle.movement.deceleration = deceleration;
  }

  // === Vehicle Edge ===

  setVehicleEdgeRatio(vehicleIndex: number, edgeRatio: number): void {
    const vehicle = this.vehicleDataArray.get(vehicleIndex);
    vehicle.movement.edgeRatio = edgeRatio;
  }

  getVehicleEdgeRatio(vehicleIndex: number): number {
    return this.vehicleDataArray.getEdgeRatio(vehicleIndex);
  }

  setVehicleCurrentEdge(vehicleIndex: number, edgeIndex: number): void {
    const vehicle = this.vehicleDataArray.get(vehicleIndex);
    vehicle.movement.currentEdge = edgeIndex;
  }

  getVehicleCurrentEdge(vehicleIndex: number): number {
    const vehicle = this.vehicleDataArray.get(vehicleIndex);
    return vehicle.movement.currentEdge;
  }

  // === Edge Vehicle Queue ===

  addVehicleToEdgeList(edgeIndex: number, vehicleIndex: number): void {
    this.edgeVehicleQueue.addVehicle(edgeIndex, vehicleIndex);
  }

  removeVehicleFromEdgeList(edgeIndex: number, vehicleIndex: number): void {
    this.edgeVehicleQueue.removeVehicle(edgeIndex, vehicleIndex);
  }

  getVehiclesInEdge(edgeIndex: number): number[] {
    return this.edgeVehicleQueue.getVehicles(edgeIndex);
  }

  getEdgeVehicleCount(edgeIndex: number): number {
    return this.edgeVehicleQueue.getCount(edgeIndex);
  }

  // === Vehicle Management ===

  clearVehicleData(vehicleIndex: number): void {
    this.vehicleDataArray.clearVehicle(vehicleIndex);
  }

  clearAllVehicles(): void {
    this.edgeVehicleQueue.clearAll();
    this.vehicleDataArray.clearAll();
    console.log("[EngineStore] All vehicles cleared");
  }

  addVehicle(
    vehicleIndex: number,
    data: {
      x: number;
      y: number;
      z: number;
      edgeIndex: number;
      edgeRatio?: number;
      rotation?: number;
      velocity?: number;
      acceleration?: number;
      deceleration?: number;
      movingStatus?: number;
    }
  ): void {
    const vehicle = this.vehicleDataArray.get(vehicleIndex);

    vehicle.movement.x = data.x;
    vehicle.movement.y = data.y;
    vehicle.movement.z = data.z;
    vehicle.movement.rotation = data.rotation ?? 0;
    vehicle.movement.velocity = data.velocity ?? 0;
    vehicle.movement.acceleration = data.acceleration ?? 0;
    vehicle.movement.deceleration = data.deceleration ?? 0;
    vehicle.movement.edgeRatio = data.edgeRatio ?? 0;
    vehicle.movement.movingStatus = data.movingStatus ?? 0;
    vehicle.movement.currentEdge = data.edgeIndex;
    vehicle.sensor.hitZone = -1;

    this.edgeVehicleQueue.addVehicle(data.edgeIndex, vehicleIndex);
  }

  removeVehicle(vehicleIndex: number): void {
    const currentEdge = this.vehicleDataArray.get(vehicleIndex).movement.currentEdge;

    if (currentEdge !== -1) {
      this.removeVehicleFromEdgeList(currentEdge, vehicleIndex);
    }

    this.clearVehicleData(vehicleIndex);
  }

  moveVehicleToEdge(
    vehicleIndex: number,
    newEdgeIndex: number,
    edgeRatio: number = 0
  ): void {
    const vehicle = this.vehicleDataArray.get(vehicleIndex);
    const oldEdge = vehicle.movement.currentEdge;

    if (oldEdge !== -1) {
      this.removeVehicleFromEdgeList(oldEdge, vehicleIndex);
    }

    this.addVehicleToEdgeList(newEdgeIndex, vehicleIndex);
    vehicle.movement.currentEdge = newEdgeIndex;
    vehicle.movement.edgeRatio = edgeRatio;
  }
}
