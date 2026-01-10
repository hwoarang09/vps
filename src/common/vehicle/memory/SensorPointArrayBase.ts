// common/vehicle/memory/SensorPointArrayBase.ts
// Base class for SensorPointArray (shared between vehicleArrayMode and shmSimulator)

export const SENSOR_ZONE_COUNT = 3;
export const SENSOR_POINT_SIZE = 12; // 6 points * (x,y)
export const SENSOR_DATA_SIZE = SENSOR_ZONE_COUNT * SENSOR_POINT_SIZE; // 36 floats per vehicle

export const SensorPoint = {
  FL_X: 0,
  FL_Y: 1,   // Front Left
  FR_X: 2,
  FR_Y: 3,   // Front Right
  BL_X: 4,
  BL_Y: 5,   // Back Left
  BR_X: 6,
  BR_Y: 7,   // Back Right
  SL_X: 8,
  SL_Y: 9,   // Sensor Left tip
  SR_X: 10,
  SR_Y: 11,  // Sensor Right tip
} as const;

/**
 * 메모리 영역 정보 (멀티 워커 지원용)
 */
export interface SensorMemoryRegion {
  /** SharedArrayBuffer 내 시작 오프셋 (bytes) */
  offset: number;
  /** 할당된 영역 크기 (bytes) */
  size: number;
  /** 이 영역에서 관리할 수 있는 최대 Vehicle 수 */
  maxVehicles: number;
}

/**
 * SensorPointArrayBase - Base class for sensor point data management
 * - Subclasses can override data initialization (e.g., SharedArrayBuffer support)
 * - Supports memory region restriction for multi-worker environments
 */
export class SensorPointArrayBase {
  protected data!: Float32Array;
  protected maxVehicles: number;

  /** 메모리 영역 제한 정보 (멀티 워커 환경에서 사용) */
  protected memoryRegion: SensorMemoryRegion | null = null;

  /**
   * @param maxVehicles - 최대 vehicle 수
   * @param skipAllocation - true이면 초기 배열 할당 스킵 (SharedBuffer 사용 시)
   */
  constructor(maxVehicles: number, skipAllocation: boolean = false) {
    this.maxVehicles = maxVehicles;
    if (!skipAllocation) {
      this.data = new Float32Array(maxVehicles * SENSOR_DATA_SIZE);
    }
  }

  /**
   * Set buffer from SharedArrayBuffer (for Worker thread)
   * 하위호환: 전체 버퍼를 사용
   */
  setBuffer(buffer: SharedArrayBuffer): void {
    this.data = new Float32Array(buffer);
    this.maxVehicles = this.data.length / SENSOR_DATA_SIZE;
    this.memoryRegion = null;
  }

  /**
   * Set buffer with memory region restriction (for Multi-Worker)
   * 특정 영역만 사용하도록 제한
   */
  setBufferWithRegion(buffer: SharedArrayBuffer, region: SensorMemoryRegion): void {
    const floatLength = region.size / Float32Array.BYTES_PER_ELEMENT;

    this.data = new Float32Array(buffer, region.offset, floatLength);
    this.maxVehicles = region.maxVehicles;
    this.memoryRegion = region;
  }

  /**
   * 현재 메모리 영역 정보 반환
   */
  getMemoryRegion(): SensorMemoryRegion | null {
    return this.memoryRegion;
  }

  getData(): Float32Array {
    return this.data;
  }

  getOffset(vehIdx: number): number {
    return vehIdx * SENSOR_DATA_SIZE;
  }

  getZoneOffset(vehIdx: number, zoneIndex: number): number {
    return vehIdx * SENSOR_DATA_SIZE + zoneIndex * SENSOR_POINT_SIZE;
  }

  getPoints(
    vehIdx: number,
    zoneIndex: number = 0
  ): {
    fl: [number, number];
    fr: [number, number];
    bl: [number, number];
    br: [number, number];
    sl: [number, number];
    sr: [number, number];
  } {
    const offset = this.getZoneOffset(vehIdx, zoneIndex);
    return {
      fl: [this.data[offset + SensorPoint.FL_X], this.data[offset + SensorPoint.FL_Y]],
      fr: [this.data[offset + SensorPoint.FR_X], this.data[offset + SensorPoint.FR_Y]],
      bl: [this.data[offset + SensorPoint.BL_X], this.data[offset + SensorPoint.BL_Y]],
      br: [this.data[offset + SensorPoint.BR_X], this.data[offset + SensorPoint.BR_Y]],
      sl: [this.data[offset + SensorPoint.SL_X], this.data[offset + SensorPoint.SL_Y]],
      sr: [this.data[offset + SensorPoint.SR_X], this.data[offset + SensorPoint.SR_Y]],
    };
  }

  reset(): void {
    this.data.fill(0);
  }
}
