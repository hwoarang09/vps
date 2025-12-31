// common/vehicle/initialize/types.ts
// Shared types for vehicle initialization

import type { Edge } from "@/types/edge";

/**
 * Vehicle placement data
 */
export interface VehiclePlacement {
  vehicleIndex: number;
  edgeName: string;
  x: number;
  y: number;
  z: number;
  rotation: number;
  edgeRatio: number;
}

/**
 * Data required to add a vehicle
 */
export interface AddVehicleData {
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

/**
 * Result of vehicle initialization
 */
export interface InitializationResult {
  edgeNameToIndex: Map<string, number>;
  edgeArray: Edge[];
  actualNumVehicles: number;
}

/**
 * Interface for EdgeVehicleQueue operations
 */
export interface IEdgeVehicleQueue {
  addVehicle(edgeIndex: number, vehicleIndex: number): void;
  removeVehicle(edgeIndex: number, vehicleIndex: number): void;
  getVehicles(edgeIndex: number): number[];
  getCount(edgeIndex: number): number;
  sortByEdgeRatio(edgeIndex: number, data: Float32Array): void;
  clearAll(): void;
}

/**
 * Interface for LockManager operations
 */
export interface ILockMgr {
  isMergeNode(nodeName: string): boolean;
  requestLock(nodeName: string, edgeName: string, vehicleId: number): void;
}

/**
 * Interface for VehicleStore operations needed for initialization
 */
export interface IVehicleStore {
  addVehicle(vehicleIndex: number, data: AddVehicleData): void;
  setActualNumVehicles(num: number): void;
  getVehicleData(): Float32Array;
  getEdgeVehicleQueue(): IEdgeVehicleQueue;
}

/**
 * Configuration for vehicle initialization
 */
export interface VehicleInitConfig {
  linearAcceleration: number;
  linearDeceleration: number;
  linearMaxSpeed: number;
  curveMaxSpeed: number;
  vehicleZOffset: number;
}

/**
 * Parameters for initializing vehicles (common function)
 */
export interface InitializeVehiclesCommonParams {
  edges: Edge[];
  placements: VehiclePlacement[];
  store: IVehicleStore;
  lockMgr: ILockMgr;
  config: VehicleInitConfig;
  // Optional callbacks for platform-specific behavior
  onVehicleCreated?: (placement: VehiclePlacement, edgeIndex: number) => void;
  // Sensor point update function (platform-specific)
  updateSensorPoints: (
    vehicleIndex: number,
    x: number,
    y: number,
    rotation: number,
    presetIndex: number
  ) => void;
}
