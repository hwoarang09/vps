// common/vehicle/helpers/sensorDebug.ts

import {
  SensorPoint,
  SENSOR_DATA_SIZE,
  SENSOR_POINT_SIZE,
  type ISensorPointArray,
} from "@/common/vehicle/collision/sensorCollision";

const DEBUG = false;

export function logSensorData(
  sensorPointArray: ISensorPointArray,
  vehIdx: number,
  label: string = "",
  zoneIndex: number = 0
) {
  // Rule A.1: Remove useless assignments - variables not used
  // Rule A.2: Remove empty block - DEBUG is always false
}

export function isSensorDataZero(
  sensorPointArray: ISensorPointArray,
  vehIdx: number,
  zoneIndex: number = 0
): boolean {
  const data = sensorPointArray.getData();
  const offset = vehIdx * SENSOR_DATA_SIZE + zoneIndex * SENSOR_POINT_SIZE;

  for (let i = 0; i < SENSOR_POINT_SIZE; i++) {
    if (data[offset + i] !== 0) return false;
  }
  return true;
}

export function logSensorSummary(
  sensorPointArray: ISensorPointArray,
  numVehicles: number
) {
  let zeroCount = 0;
  let nonZeroCount = 0;

  for (let i = 0; i < numVehicles; i++) {
    if (isSensorDataZero(sensorPointArray, i)) {
      zeroCount++;
    } else {
      nonZeroCount++;
    }
  }


  if (nonZeroCount > 0) {
    for (let i = 0; i < numVehicles; i++) {
      if (!isSensorDataZero(sensorPointArray, i)) {
        logSensorData(sensorPointArray, i, "First initialized");
        break;
      }
    }
  }
}
