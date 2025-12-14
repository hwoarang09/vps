// vehicleDataArray.ts
// Vehicle state storage using Float32Array (single thread)

import { getMaxVehicles } from "@/config/vehicleConfig";

// Vehicle status enum (Moving State)
export const MovingStatus = {
  STOPPED: 0,
  MOVING: 1,
  PAUSED: 2,
} as const;

// Traffic Regulation State (Intersection/Merge control)
export const TrafficState = {
  FREE: 0,      // Normal driving
  WAITING: 1,   // Waiting for lock (Must Stop)
  ACQUIRED: 2,  // Lock acquired (Can Enter)
} as const;

// Stop Reason Bitmask (Why are we stopped?)
// 32-bit compatible, but stored in Float32 (safe up to 2^24 integers)
export const StopReason = {
  NONE: 0,
  OBS_LIDAR: 1,         // Lidar obstacle
  OBS_CAMERA: 1 << 1,        // Camera obstacle
  E_STOP: 1 << 2,            // Emergency Stop Button
  WAITING_FOR_LOCK: 1 << 3,  // Waiting for Traffic Lock
  DESTINATION_REACHED: 1 << 4,
  PATH_BLOCKED: 1 << 5,      // Blocked by vehicle ahead
  LOAD_ON: 1 << 6,           // Loading action in progress
  LOAD_OFF: 1 << 7,          // Unloading action in progress
  NOT_INITIALIZED: 1 << 8,   // System safety start
} as const;

// High-level Mission Job State
export const JobState = {
  INITIALIZING: 0,
  IDLE: 1,
  MOVE_TO_LOAD: 2,
  LOADING: 3,
  MOVE_TO_UNLOAD: 4,
  UNLOADING: 5,
  ERROR: 6,
} as const;

// Data structure layout
// Next Edge State for TransferMgr
export const NextEdgeState = {
  EMPTY: 0,
  PENDING: 1,
  READY: 2,
} as const;

// --- ID Generator for Auto-Offsets ---
let _mPtr = 0;
export const MovementData = {
  X: _mPtr++,
  Y: _mPtr++,
  Z: _mPtr++,
  ROTATION: _mPtr++,
  VELOCITY: _mPtr++,
  ACCELERATION: _mPtr++,
  DECELERATION: _mPtr++,
  EDGE_RATIO: _mPtr++,
  MOVING_STATUS: _mPtr++, // 0=STOPPED, 1=MOVING, 2=PAUSED
  CURRENT_EDGE: _mPtr++, // Edge index
  NEXT_EDGE: _mPtr++,        // Edge index (valid only when NEXT_EDGE_STATE==READY, else -1)
  NEXT_EDGE_STATE: _mPtr++,  // 0=EMPTY, 1=PENDING, 2=READY
  OFFSET: _mPtr++,      // Distance from edge start (accumulated or current segment)
} as const;
const MOVEMENT_SIZE = _mPtr;

let _sPtr = MOVEMENT_SIZE;
export const SensorData = {
  PRESET_IDX: _sPtr++, // 0=STRAIGHT, 1=CURVE_LEFT, 2=CURVE_RIGHT, 3=MERGE, 4=BRANCH
  HIT_ZONE: _sPtr++,   // -1=none, 0=approach, 1=brake, 2=stop
} as const;
const SENSOR_SIZE = _sPtr - MOVEMENT_SIZE;

let _lPtr = _sPtr;
export const LogicData = {
  TRAFFIC_STATE: _lPtr++,
  STOP_REASON: _lPtr++,
  JOB_STATE: _lPtr++,
} as const;
const LOGIC_SIZE = _lPtr - _sPtr;

export const VEHICLE_DATA_SIZE = _lPtr; // Total Size

export const HitZone = {
  NONE: -1,
  APPROACH: 0,
  BRAKE: 1,
  STOP: 2,
} as const;

/**
 * VehicleDataArray - Manages array-based vehicle state data
 * - Single thread only (no SharedArrayBuffer)
 * - Direct memory access via Float32Array
 */
class VehicleDataArray {
  private data: Float32Array;
  private readonly maxVehicles: number;

  constructor(maxVehicles: number = getMaxVehicles()) {
    this.maxVehicles = maxVehicles;
    this.data = new Float32Array(maxVehicles * VEHICLE_DATA_SIZE);
  }

  /**
   * Get vehicle data accessor (dict-like access)
   * Usage: vehicleDataArray.get(0).movement.x = 10;
   */
  get(vehicleIndex: number) {
    const offset = vehicleIndex * VEHICLE_DATA_SIZE;
    const data = this.data;

    return {
      movement: {
        get x() {
          return data[offset + MovementData.X];
        },
        set x(val: number) {
          data[offset + MovementData.X] = val;
        },

        get y() {
          return data[offset + MovementData.Y];
        },
        set y(val: number) {
          data[offset + MovementData.Y] = val;
        },

        get z() {
          return data[offset + MovementData.Z];
        },
        set z(val: number) {
          data[offset + MovementData.Z] = val;
        },

        get rotation() {
          return data[offset + MovementData.ROTATION];
        },
        set rotation(val: number) {
          data[offset + MovementData.ROTATION] = val;
        },

        get velocity() {
          return data[offset + MovementData.VELOCITY];
        },
        set velocity(val: number) {
          data[offset + MovementData.VELOCITY] = val;
        },

        get acceleration() {
          return data[offset + MovementData.ACCELERATION];
        },
        set acceleration(val: number) {
          data[offset + MovementData.ACCELERATION] = val;
        },

        get deceleration() {
          return data[offset + MovementData.DECELERATION];
        },
        set deceleration(val: number) {
          data[offset + MovementData.DECELERATION] = val;
        },

        get edgeRatio() {
          return data[offset + MovementData.EDGE_RATIO];
        },
        set edgeRatio(val: number) {
          data[offset + MovementData.EDGE_RATIO] = val;
        },

        get movingStatus() {
          return data[offset + MovementData.MOVING_STATUS];
        },
        set movingStatus(val: number) {
          data[offset + MovementData.MOVING_STATUS] = val;
        },

        get currentEdge() {
          return data[offset + MovementData.CURRENT_EDGE];
        },
        set currentEdge(val: number) {
          data[offset + MovementData.CURRENT_EDGE] = val;
        },

        get nextEdge() {
          return data[offset + MovementData.NEXT_EDGE];
        },
        set nextEdge(val: number) {
          data[offset + MovementData.NEXT_EDGE] = val;
        },

        get nextEdgeState() {
          return data[offset + MovementData.NEXT_EDGE_STATE];
        },
        set nextEdgeState(val: number) {
          data[offset + MovementData.NEXT_EDGE_STATE] = val;
        },

        get offset() {
          return data[offset + MovementData.OFFSET];
        },
        set offset(val: number) {
          data[offset + MovementData.OFFSET] = val;
        },
      },

      sensor: {
        get presetIdx() {
          return data[offset + SensorData.PRESET_IDX];
        },
        set presetIdx(val: number) {
          data[offset + SensorData.PRESET_IDX] = val;
        },

        get hitZone() {
          return data[offset + SensorData.HIT_ZONE];
        },
        set hitZone(val: number) {
          data[offset + SensorData.HIT_ZONE] = val;
        },
      },

      logic: {
        get trafficState() {
          return data[offset + LogicData.TRAFFIC_STATE];
        },
        set trafficState(val: number) {
          data[offset + LogicData.TRAFFIC_STATE] = val;
        },

        get stopReason() {
          return data[offset + LogicData.STOP_REASON];
        },
        set stopReason(val: number) {
          data[offset + LogicData.STOP_REASON] = val;
        },

        get jobState() {
          return data[offset + LogicData.JOB_STATE];
        },
        set jobState(val: number) {
          data[offset + LogicData.JOB_STATE] = val;
        },
      }
    };
  }

  /**
   * Get position as object
   */
  getPosition(vehicleIndex: number): { x: number; y: number; z: number } {
    const offset = vehicleIndex * VEHICLE_DATA_SIZE;
    return {
      x: this.data[offset + MovementData.X],
      y: this.data[offset + MovementData.Y],
      z: this.data[offset + MovementData.Z],
    };
  }

  /**
   * Set position
   */
  setPosition(
    vehicleIndex: number,
    x: number,
    y: number,
    z: number
  ): void {
    const offset = vehicleIndex * VEHICLE_DATA_SIZE;
    this.data[offset + MovementData.X] = x;
    this.data[offset + MovementData.Y] = y;
    this.data[offset + MovementData.Z] = z;
  }

  /**
   * Get rotation
   */
  getRotation(vehicleIndex: number): number {
    const offset = vehicleIndex * VEHICLE_DATA_SIZE;
    return this.data[offset + MovementData.ROTATION];
  }

  /**
   * Set rotation
   */
  setRotation(vehicleIndex: number, rotation: number): void {
    const offset = vehicleIndex * VEHICLE_DATA_SIZE;
    this.data[offset + MovementData.ROTATION] = rotation;
  }

  /**
   * Get velocity
   */
  getVelocity(vehicleIndex: number): number {
    const offset = vehicleIndex * VEHICLE_DATA_SIZE;
    return this.data[offset + MovementData.VELOCITY];
  }

  /**
   * Set velocity
   */
  setVelocity(vehicleIndex: number, velocity: number): void {
    const offset = vehicleIndex * VEHICLE_DATA_SIZE;
    this.data[offset + MovementData.VELOCITY] = velocity;
  }

  /**
   * Get Float32Array (for direct access)
   */
  getData(): Float32Array {
    return this.data;
  }

  /**
   * Get max vehicles
   */
  getMaxVehicles(): number {
    return this.maxVehicles;
  }

  /**
   * Clear all data
   */
  clear(): void {
    this.data.fill(0);
  }

  /**
   * Clear all data (alias for clear)
   */
  clearAll(): void {
    this.clear();
  }

  /**
   * Clear specific vehicle data
   */
  clearVehicle(vehicleIndex: number): void {
    const offset = vehicleIndex * VEHICLE_DATA_SIZE;
    for (let i = 0; i < VEHICLE_DATA_SIZE; i++) {
      this.data[offset + i] = 0;
    }
  }

  /**
   * Get edge ratio (direct access, no getter overhead)
   */
  getEdgeRatio(vehicleIndex: number): number {
    return this.data[vehicleIndex * VEHICLE_DATA_SIZE + MovementData.EDGE_RATIO];
  }

  /**
   * Get moving status (direct access)
   */
  getMovingStatus(vehicleIndex: number): number {
    return this.data[vehicleIndex * VEHICLE_DATA_SIZE + MovementData.MOVING_STATUS];
  }

  /**
   * Set moving status (direct access)
   */
  setMovingStatus(vehicleIndex: number, status: number): void {
    this.data[vehicleIndex * VEHICLE_DATA_SIZE + MovementData.MOVING_STATUS] = status;
  }  
  
  /**
   * Get deceleration (direct access)
   */
  getDeceleration(vehicleIndex: number): number {
    return this.data[vehicleIndex * VEHICLE_DATA_SIZE + MovementData.DECELERATION];
  }

  /**
   * Set deceleration (direct access)
   */
  setDeceleration(vehicleIndex: number, deceleration: number): void {
    this.data[vehicleIndex * VEHICLE_DATA_SIZE + MovementData.DECELERATION] = deceleration;
  }

  // --- Logic State Accessors ---

  getTrafficState(vehicleIndex: number): number {
    return this.data[vehicleIndex * VEHICLE_DATA_SIZE + LogicData.TRAFFIC_STATE];
  }

  setTrafficState(vehicleIndex: number, val: number): void {
    this.data[vehicleIndex * VEHICLE_DATA_SIZE + LogicData.TRAFFIC_STATE] = val;
  }

  getStopReason(vehicleIndex: number): number {
    return this.data[vehicleIndex * VEHICLE_DATA_SIZE + LogicData.STOP_REASON];
  }

  setStopReason(vehicleIndex: number, val: number): void {
    this.data[vehicleIndex * VEHICLE_DATA_SIZE + LogicData.STOP_REASON] = val;
  }

  getJobState(vehicleIndex: number): number {
    return this.data[vehicleIndex * VEHICLE_DATA_SIZE + LogicData.JOB_STATE];
  }

  setJobState(vehicleIndex: number, val: number): void {
    this.data[vehicleIndex * VEHICLE_DATA_SIZE + LogicData.JOB_STATE] = val;
  }
}

// Singleton instance (2000 vehicles max)
export const vehicleDataArray = new VehicleDataArray(getMaxVehicles());

// Expose to window for debugging and external access
if (typeof globalThis !== 'undefined') {
  (globalThis as any).vehicleDataArray = vehicleDataArray;
}

export default VehicleDataArray;
