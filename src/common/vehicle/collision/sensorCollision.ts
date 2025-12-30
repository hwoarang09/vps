// common/vehicle/collision/sensorCollision.ts
// Shared sensor collision detection for vehicleArrayMode and shmSimulator

// Sensor constants
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

// Interface for sensor point array (works with both implementations)
export interface ISensorPointArray {
  getData(): Float32Array;
}

// Sensor rectangle: FL -> SL -> SR -> FR (counterclockwise)
const SENSOR_QUAD_IDX = [
  SensorPoint.FL_X,
  SensorPoint.SL_X,
  SensorPoint.SR_X,
  SensorPoint.FR_X,
] as const;

// Body rectangle: FL -> BL -> BR -> FR (counterclockwise)
const BODY_QUAD_IDX = [
  SensorPoint.FL_X,
  SensorPoint.BL_X,
  SensorPoint.BR_X,
  SensorPoint.FR_X,
] as const;

/**
 * Sensor collision check (SAT algorithm, Zero-GC)
 * @returns zone index (0=approach, 1=brake, 2=stop) or -1 if no collision
 */
export function checkSensorCollision(
  sensorPointArray: ISensorPointArray,
  sensorVehIdx: number,
  targetVehIdx: number
): number {
  const data = sensorPointArray.getData();
  const baseSensor = sensorVehIdx * SENSOR_DATA_SIZE;
  const baseTarget = targetVehIdx * SENSOR_DATA_SIZE;

  // check inner -> outer to prioritize strongest braking
  for (let zone = 2; zone >= 0; zone--) {
    const sensorBase = baseSensor + zone * SENSOR_POINT_SIZE;
    const targetBase = baseTarget + 0 * SENSOR_POINT_SIZE;

    if (
      satQuadCheck(data, sensorBase, targetBase, SENSOR_QUAD_IDX, BODY_QUAD_IDX) &&
      satQuadCheck(data, targetBase, sensorBase, BODY_QUAD_IDX, SENSOR_QUAD_IDX)
    ) {
      return zone;
    }
  }

  return -1;
}

function satQuadCheck(
  data: Float32Array,
  baseA: number,
  baseB: number,
  idxA: readonly number[],
  idxB: readonly number[]
): boolean {
  for (let i = 0; i < 4; i++) {
    const currIdx = idxA[i];
    const nextIdx = idxA[(i + 1) % 4];

    const p1x = data[baseA + currIdx];
    const p1y = data[baseA + currIdx + 1];
    const p2x = data[baseA + nextIdx];
    const p2y = data[baseA + nextIdx + 1];

    const axisX = -(p2y - p1y);
    const axisY = p2x - p1x;

    const axisLenSq = axisX * axisX + axisY * axisY;
    if (axisLenSq < 1e-10) continue;

    const { min: minA, max: maxA } = getProjectedRange(data, baseA, idxA, axisX, axisY);
    const { min: minB, max: maxB } = getProjectedRange(data, baseB, idxB, axisX, axisY);

    if (maxA < minB || maxB < minA) {
      return false;
    }
  }

  return true;
}

/**
 * Rough distance check (quick filter before precise SAT check)
 */
export function roughDistanceCheck(
  sensorPointArray: ISensorPointArray,
  vehIdx1: number,
  vehIdx2: number,
  threshold: number
): boolean {
  const data = sensorPointArray.getData();
  const base1 = vehIdx1 * SENSOR_DATA_SIZE + 0 * SENSOR_POINT_SIZE;
  const base2 = vehIdx2 * SENSOR_DATA_SIZE + 0 * SENSOR_POINT_SIZE;

  const dx = data[base1 + SensorPoint.FL_X] - data[base2 + SensorPoint.FL_X];
  const dy = data[base1 + SensorPoint.FL_Y] - data[base2 + SensorPoint.FL_Y];

  return dx * dx + dy * dy <= threshold * threshold;
}

const tempRange = { min: 0, max: 0 };

function getProjectedRange(
  data: Float32Array,
  base: number,
  indices: readonly number[],
  axisX: number,
  axisY: number
): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (let j = 0; j < 4; j++) {
    const px = data[base + indices[j]];
    const py = data[base + indices[j] + 1];
    const proj = px * axisX + py * axisY;
    if (proj < min) min = proj;
    if (proj > max) max = proj;
  }
  tempRange.min = min;
  tempRange.max = max;
  return tempRange;
}
