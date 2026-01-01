// common/vehicle/memory/VehicleDataArrayBase.ts
// Base class for VehicleDataArray (shared between vehicleArrayMode and shmSimulator)

import {
  VEHICLE_DATA_SIZE,
  MovementData,
  SensorData,
  LogicData,
} from "@/common/vehicle/initialize/constants";

// Re-export constants for convenience
export {
  MovingStatus,
  TrafficState,
  StopReason,
  JobState,
  NextEdgeState,
  MovementData,
  SensorData,
  LogicData,
  VEHICLE_DATA_SIZE,
  HitZone,
} from "@/common/vehicle/initialize/constants";

/**
 * VehicleDataArrayBase - Base class for vehicle state data management
 * - Subclasses can override data initialization (e.g., SharedArrayBuffer support)
 */
export class VehicleDataArrayBase {
  protected data: Float32Array;
  protected readonly maxVehicles: number;

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
    return this.data[vehicleIndex * VEHICLE_DATA_SIZE + MovementData.MOVING_STATUS];
  }

  setMovingStatus(vehicleIndex: number, status: number): void {
    this.data[vehicleIndex * VEHICLE_DATA_SIZE + MovementData.MOVING_STATUS] = status;
  }

  getDeceleration(vehicleIndex: number): number {
    return this.data[vehicleIndex * VEHICLE_DATA_SIZE + MovementData.DECELERATION];
  }

  setDeceleration(vehicleIndex: number, deceleration: number): void {
    this.data[vehicleIndex * VEHICLE_DATA_SIZE + MovementData.DECELERATION] = deceleration;
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
