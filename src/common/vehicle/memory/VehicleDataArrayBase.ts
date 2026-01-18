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
 * 메모리 영역 정보 (멀티 워커 지원용)
 * shmSimulator/types.ts의 MemoryRegion과 동일한 구조
 */
export interface VehicleMemoryRegion {
  /** SharedArrayBuffer 내 시작 오프셋 (bytes) */
  offset: number;
  /** 할당된 영역 크기 (bytes) */
  size: number;
  /** 이 영역에서 관리할 수 있는 최대 Vehicle 수 */
  maxVehicles: number;
}

/**
 * VehicleDataArrayBase - Base class for vehicle state data management
 * - Subclasses can override data initialization (e.g., SharedArrayBuffer support)
 * - Supports memory region restriction for multi-worker environments
 */
export class VehicleDataArrayBase {
  protected data!: Float32Array;
  protected maxVehicles: number;

  /** 메모리 영역 제한 정보 (멀티 워커 환경에서 사용) */
  protected memoryRegion: VehicleMemoryRegion | null = null;

  /**
   * @param maxVehicles - 최대 vehicle 수
   * @param skipAllocation - true이면 초기 배열 할당 스킵 (SharedBuffer 사용 시)
   */
  constructor(maxVehicles: number, skipAllocation: boolean = false) {
    this.maxVehicles = maxVehicles;
    if (!skipAllocation) {
      this.data = new Float32Array(maxVehicles * VEHICLE_DATA_SIZE);
    }
  }

  /**
   * Set buffer from SharedArrayBuffer (for Worker thread)
   * 하위호환: 전체 버퍼를 사용
   */
  setBuffer(buffer: SharedArrayBuffer): void {
    this.data = new Float32Array(buffer);
    this.maxVehicles = this.data.length / VEHICLE_DATA_SIZE;
    this.memoryRegion = null;
  }

  /**
   * Set buffer with memory region restriction (for Multi-Worker)
   * 특정 영역만 사용하도록 제한
   */
  setBufferWithRegion(buffer: SharedArrayBuffer, region: VehicleMemoryRegion): void {
    // Float32Array 뷰 생성 (특정 영역만)
    const floatLength = region.size / Float32Array.BYTES_PER_ELEMENT;

    this.data = new Float32Array(buffer, region.offset, floatLength);
    this.maxVehicles = region.maxVehicles;
    this.memoryRegion = region;
  }

  /**
   * 현재 메모리 영역 정보 반환
   */
  getMemoryRegion(): VehicleMemoryRegion | null {
    return this.memoryRegion;
  }

  /**
   * Vehicle ID가 유효 범위 내인지 확인 (디버그용)
   */
  isValidVehicleIndex(vehicleIndex: number): boolean {
    return vehicleIndex >= 0 && vehicleIndex < this.maxVehicles;
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
          return data[offset + MovementData.NEXT_EDGE_0];
        },
        set nextEdge(val: number) {
          data[offset + MovementData.NEXT_EDGE_0] = val;
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

  /**
   * Dispose memory region reference to allow garbage collection
   * Note: data (Float32Array view) is not nullified as it may reference SharedArrayBuffer
   */
  dispose(): void {
    this.memoryRegion = null;
  }
}
