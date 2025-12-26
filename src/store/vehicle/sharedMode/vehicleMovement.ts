import { getMaxVehicles } from "@/config/vehicleConfig";

// Vehicle status enum (only using 0, 1 for now)
export const VehicleStatus = {
  STOPPED: 0,
  MOVING: 1,
  // CHARGING: 2,  // Reserved for future use
  // ERROR: 3,     // Reserved for future use
} as const;

// Data structure layout
const MOVEMENT_SIZE = 7; // x, y, z, rotation, velocity, acceleration, edgeRatio
const STATUS_SIZE = 2; // status, currentEdge
const SENSOR_SIZE = 1; // sensor preset index
export const VEHICLE_DATA_SIZE = MOVEMENT_SIZE + STATUS_SIZE + SENSOR_SIZE; // 10

export const MovementData = {
  X: 0,
  Y: 1,
  Z: 2,
  ROTATION: 3,
  VELOCITY: 4,
  ACCELERATION: 5,
  EDGE_RATIO: 6, // Position on edge (0.0 ~ 1.0)
} as const;

export const StatusData = {
  STATUS: 7, // 0=STOPPED, 1=MOVING
  CURRENT_EDGE: 8, // Edge index
} as const;

export const SensorData = {
  PRESET_IDX: 9, // 0=STRAIGHT, 1=CURVE_LEFT, 2=CURVE_RIGHT, 3=MERGE, 4=BRANCH
} as const;

/**
 * VehicleSharedMovement - Manages shared memory for vehicle movement data
 * - Main thread and Worker can both access this memory
 * - No re-renders when data changes (direct memory access)
 */
class VehicleSharedMovement {
  private buffer: SharedArrayBuffer;
  private data: Float32Array;
  private maxVehicles: number;

  constructor(maxVehicles: number = getMaxVehicles()) {
    this.maxVehicles = maxVehicles;
    this.buffer = new SharedArrayBuffer(maxVehicles * VEHICLE_DATA_SIZE * 4);
    this.data = new Float32Array(this.buffer);
  }

  /**
   * Get vehicle data accessor (dict-like access)
   * Usage: vehicleSharedMovement.get(0).movement.x = 10;
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

        get edgeRatio() {
          return data[offset + MovementData.EDGE_RATIO];
        },
        set edgeRatio(val: number) {
          data[offset + MovementData.EDGE_RATIO] = val;
        },
      },

      status: {
        get status() {
          return data[offset + StatusData.STATUS];
        },
        set status(val: number) {
          data[offset + StatusData.STATUS] = val;
        },

        get currentEdge() {
          return data[offset + StatusData.CURRENT_EDGE];
        },
        set currentEdge(val: number) {
          data[offset + StatusData.CURRENT_EDGE] = val;
        },
      },

      sensor: {
        get presetIdx() {
          return data[offset + SensorData.PRESET_IDX];
        },
        set presetIdx(val: number) {
          data[offset + SensorData.PRESET_IDX] = val;
        },
      },
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
   * Get SharedArrayBuffer (for Worker transfer)
   */
  getBuffer(): SharedArrayBuffer {
    return this.buffer;
  }

  /**
   * Get max vehicles
   */
  getMaxVehicles(): number {
    return this.maxVehicles;
  }
}

// Singleton instance
export const vehicleSharedMovement = new VehicleSharedMovement(getMaxVehicles());

export default VehicleSharedMovement;

