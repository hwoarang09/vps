// shmSimulator/memory/vehicleDataArray.ts
// Vehicle state storage using Float32Array (Worker thread compatible)

// Vehicle status enum (Moving State)
export const MovingStatus = {
  STOPPED: 0,
  MOVING: 1,
  PAUSED: 2,
} as const;

// Traffic Regulation State (Intersection/Merge control)
export const TrafficState = {
  FREE: 0, // Normal driving
  WAITING: 1, // Waiting for lock (Must Stop)
  ACQUIRED: 2, // Lock acquired (Can Enter)
} as const;

// Stop Reason Bitmask (Why are we stopped?)
export const StopReason = {
  NONE: 0,
  OBS_LIDAR: 1,
  OBS_CAMERA: 1 << 1,
  E_STOP: 1 << 2,
  WAITING_FOR_LOCK: 1 << 3,
  LOCKED: 1 << 3,
  DESTINATION_REACHED: 1 << 4,
  PATH_BLOCKED: 1 << 5,
  LOAD_ON: 1 << 6,
  LOAD_OFF: 1 << 7,
  NOT_INITIALIZED: 1 << 8,
  INDIVIDUAL_CONTROL: 1 << 9,
  SENSORED: 1 << 10,
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
  MOVING_STATUS: _mPtr++,
  CURRENT_EDGE: _mPtr++,
  NEXT_EDGE: _mPtr++,
  NEXT_EDGE_STATE: _mPtr++,
  OFFSET: _mPtr++,
} as const;
const MOVEMENT_SIZE = _mPtr;

let _sPtr = MOVEMENT_SIZE;
export const SensorData = {
  PRESET_IDX: _sPtr++,
  HIT_ZONE: _sPtr++,
  COLLISION_TARGET: _sPtr++,
} as const;
const SENSOR_SIZE = _sPtr - MOVEMENT_SIZE;

let _lPtr = _sPtr;
export const LogicData = {
  TRAFFIC_STATE: _lPtr++,
  STOP_REASON: _lPtr++,
  JOB_STATE: _lPtr++,
} as const;
const LOGIC_SIZE = _lPtr - _sPtr;

export const VEHICLE_DATA_SIZE = _lPtr;

export const HitZone = {
  NONE: -1,
  APPROACH: 0,
  BRAKE: 1,
  STOP: 2,
} as const;

/**
 * VehicleDataArray - Manages array-based vehicle state data
 * - Supports SharedArrayBuffer for Worker thread communication
 * - Direct memory access via Float32Array
 */
class VehicleDataArray {
  private data: Float32Array;
  private readonly maxVehicles: number;

  constructor(maxVehicles: number) {
    this.maxVehicles = maxVehicles;
    this.data = new Float32Array(maxVehicles * VEHICLE_DATA_SIZE);
  }

  /**
   * Set buffer from SharedArrayBuffer (for Worker thread)
   */
  setBuffer(buffer: SharedArrayBuffer): void {
    this.data = new Float32Array(buffer);
  }

  /**
   * Get vehicle data accessor (dict-like access)
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

        get collisionTarget() {
          return data[offset + SensorData.COLLISION_TARGET];
        },
        set collisionTarget(val: number) {
          data[offset + SensorData.COLLISION_TARGET] = val;
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
      },
    };
  }

  getPosition(vehicleIndex: number): { x: number; y: number; z: number } {
    const offset = vehicleIndex * VEHICLE_DATA_SIZE;
    return {
      x: this.data[offset + MovementData.X],
      y: this.data[offset + MovementData.Y],
      z: this.data[offset + MovementData.Z],
    };
  }

  setPosition(vehicleIndex: number, x: number, y: number, z: number): void {
    const offset = vehicleIndex * VEHICLE_DATA_SIZE;
    this.data[offset + MovementData.X] = x;
    this.data[offset + MovementData.Y] = y;
    this.data[offset + MovementData.Z] = z;
  }

  getRotation(vehicleIndex: number): number {
    const offset = vehicleIndex * VEHICLE_DATA_SIZE;
    return this.data[offset + MovementData.ROTATION];
  }

  setRotation(vehicleIndex: number, rotation: number): void {
    const offset = vehicleIndex * VEHICLE_DATA_SIZE;
    this.data[offset + MovementData.ROTATION] = rotation;
  }

  getVelocity(vehicleIndex: number): number {
    const offset = vehicleIndex * VEHICLE_DATA_SIZE;
    return this.data[offset + MovementData.VELOCITY];
  }

  setVelocity(vehicleIndex: number, velocity: number): void {
    const offset = vehicleIndex * VEHICLE_DATA_SIZE;
    this.data[offset + MovementData.VELOCITY] = velocity;
  }

  getData(): Float32Array {
    return this.data;
  }

  getMaxVehicles(): number {
    return this.maxVehicles;
  }

  clear(): void {
    this.data.fill(0);
  }

  clearAll(): void {
    this.clear();
  }

  clearVehicle(vehicleIndex: number): void {
    const offset = vehicleIndex * VEHICLE_DATA_SIZE;
    for (let i = 0; i < VEHICLE_DATA_SIZE; i++) {
      this.data[offset + i] = 0;
    }
  }

  getEdgeRatio(vehicleIndex: number): number {
    return this.data[vehicleIndex * VEHICLE_DATA_SIZE + MovementData.EDGE_RATIO];
  }

  getMovingStatus(vehicleIndex: number): number {
    return this.data[
      vehicleIndex * VEHICLE_DATA_SIZE + MovementData.MOVING_STATUS
    ];
  }

  setMovingStatus(vehicleIndex: number, status: number): void {
    this.data[vehicleIndex * VEHICLE_DATA_SIZE + MovementData.MOVING_STATUS] =
      status;
  }

  getDeceleration(vehicleIndex: number): number {
    return this.data[
      vehicleIndex * VEHICLE_DATA_SIZE + MovementData.DECELERATION
    ];
  }

  setDeceleration(vehicleIndex: number, deceleration: number): void {
    this.data[vehicleIndex * VEHICLE_DATA_SIZE + MovementData.DECELERATION] =
      deceleration;
  }

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

export default VehicleDataArray;
