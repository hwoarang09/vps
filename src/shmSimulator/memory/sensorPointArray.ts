// shmSimulator/memory/sensorPointArray.ts
// 3-zone sensor geometry per vehicle (approach/brake/stop)

export const SENSOR_ZONE_COUNT = 3;
export const SENSOR_POINT_SIZE = 12; // 6 points * (x,y)
export const SENSOR_DATA_SIZE = SENSOR_ZONE_COUNT * SENSOR_POINT_SIZE; // 36 floats per vehicle

export const SensorPoint = {
  FL_X: 0,
  FL_Y: 1,
  FR_X: 2,
  FR_Y: 3,
  BL_X: 4,
  BL_Y: 5,
  BR_X: 6,
  BR_Y: 7,
  SL_X: 8,
  SL_Y: 9,
  SR_X: 10,
  SR_Y: 11,
} as const;

class SensorPointArray {
  private data: Float32Array;
  private readonly maxVehicles: number;

  constructor(maxVehicles: number) {
    this.maxVehicles = maxVehicles;
    this.data = new Float32Array(maxVehicles * SENSOR_DATA_SIZE);
  }

  setBuffer(buffer: SharedArrayBuffer): void {
    this.data = new Float32Array(buffer);
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

export default SensorPointArray;
