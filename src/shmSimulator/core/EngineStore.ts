// shmSimulator/core/EngineStore.ts
// Internal store class replacing Zustand vehicleArrayStore

import { VehicleDataArrayBase, VehicleMemoryRegion } from "@/common/vehicle/memory/VehicleDataArrayBase";
import { EdgeVehicleQueue } from "@/common/vehicle/memory/EdgeVehicleQueue";
import { TransferMode } from "../types";
import type { IVehicleStore } from "@/common/vehicle/initialize";
import * as ops from "@/common/vehicle/store";

export class EngineStore implements IVehicleStore {
  private readonly vehicleDataArray: VehicleDataArrayBase;
  private readonly edgeVehicleQueue: EdgeVehicleQueue;

  public actualNumVehicles: number = 0;
  public transferMode: TransferMode = TransferMode.LOOP;

  /**
   * @param maxVehicles - 최대 vehicle 수
   * @param maxEdges - 최대 edge 수
   * @param skipAllocation - true이면 VehicleDataArray 임시 배열 할당 스킵 (SharedBuffer 사용 시)
   */
  constructor(maxVehicles: number, maxEdges: number, skipAllocation: boolean = false) {
    this.vehicleDataArray = new VehicleDataArrayBase(maxVehicles, skipAllocation);
    this.edgeVehicleQueue = new EdgeVehicleQueue(maxEdges);
  }

  /**
   * Set SharedArrayBuffer for Main-Worker communication
   * 하위호환: 전체 버퍼 사용
   */
  setSharedBuffer(buffer: SharedArrayBuffer): void {
    this.vehicleDataArray.setBuffer(buffer);
  }

  /**
   * Set SharedArrayBuffer with memory region restriction (for Multi-Worker)
   * 특정 영역만 사용하도록 제한
   */
  setSharedBufferWithRegion(buffer: SharedArrayBuffer, region: VehicleMemoryRegion): void {
    this.vehicleDataArray.setBufferWithRegion(buffer, region);
  }

  // === Data Accessors ===

  getVehicleDataArray(): VehicleDataArrayBase {
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
    ops.setVehiclePosition(this.vehicleDataArray, vehicleIndex, x, y, z);
  }

  getVehiclePosition(vehicleIndex: number): { x: number; y: number; z: number } {
    return this.vehicleDataArray.getPosition(vehicleIndex);
  }

  setVehicleRotation(vehicleIndex: number, rotation: number): void {
    ops.setVehicleRotation(this.vehicleDataArray, vehicleIndex, rotation);
  }

  getVehicleRotation(vehicleIndex: number): number {
    return this.vehicleDataArray.getRotation(vehicleIndex);
  }

  // === Vehicle Velocity ===

  setVehicleVelocity(vehicleIndex: number, velocity: number): void {
    ops.setVehicleVelocity(this.vehicleDataArray, vehicleIndex, velocity);
  }

  getVehicleVelocity(vehicleIndex: number): number {
    return this.vehicleDataArray.getVelocity(vehicleIndex);
  }

  // === Vehicle Status ===

  setVehicleMovingStatus(vehicleIndex: number, status: number): void {
    ops.setVehicleMovingStatus(this.vehicleDataArray, vehicleIndex, status);
  }

  getVehicleMovingStatus(vehicleIndex: number): number {
    return ops.getVehicleMovingStatus(this.vehicleDataArray, vehicleIndex);
  }

  // === Vehicle Acceleration/Deceleration ===

  setVehicleAcceleration(vehicleIndex: number, acceleration: number): void {
    ops.setVehicleAcceleration(this.vehicleDataArray, vehicleIndex, acceleration);
  }

  setVehicleDeceleration(vehicleIndex: number, deceleration: number): void {
    ops.setVehicleDeceleration(this.vehicleDataArray, vehicleIndex, deceleration);
  }

  // === Vehicle Edge ===

  setVehicleEdgeRatio(vehicleIndex: number, edgeRatio: number): void {
    ops.setVehicleEdgeRatio(this.vehicleDataArray, vehicleIndex, edgeRatio);
  }

  getVehicleEdgeRatio(vehicleIndex: number): number {
    return ops.getVehicleEdgeRatio(this.vehicleDataArray, vehicleIndex);
  }

  setVehicleCurrentEdge(vehicleIndex: number, edgeIndex: number): void {
    ops.setVehicleCurrentEdge(this.vehicleDataArray, vehicleIndex, edgeIndex);
  }

  getVehicleCurrentEdge(vehicleIndex: number): number {
    return ops.getVehicleCurrentEdge(this.vehicleDataArray, vehicleIndex);
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
    ops.clearAllVehicles(this.vehicleDataArray, this.edgeVehicleQueue, "[EngineStore]");
  }

  addVehicle(
    vehicleIndex: number,
    data: ops.AddVehicleData
  ): void {
    ops.addVehicle(this.vehicleDataArray, this.edgeVehicleQueue, vehicleIndex, data);
  }

  removeVehicle(vehicleIndex: number): void {
    ops.removeVehicle(this.vehicleDataArray, this.edgeVehicleQueue, vehicleIndex);
  }

  moveVehicleToEdge(
    vehicleIndex: number,
    newEdgeIndex: number,
    edgeRatio: number = 0
  ): void {
    ops.moveVehicleToEdge(this.vehicleDataArray, this.edgeVehicleQueue, vehicleIndex, newEdgeIndex, edgeRatio);
  }

  /**
   * Dispose all internal data to allow garbage collection
   */
  dispose(): void {
    this.clearAllVehicles();
    this.vehicleDataArray.dispose();
    this.edgeVehicleQueue.dispose();
  }
}
