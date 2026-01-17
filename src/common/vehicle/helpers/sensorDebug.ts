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
  const data = sensorPointArray.getData();
  const offset = vehIdx * SENSOR_DATA_SIZE + zoneIndex * SENSOR_POINT_SIZE;

  const fl = [data[offset + SensorPoint.FL_X], data[offset + SensorPoint.FL_Y]];
  const fr = [data[offset + SensorPoint.FR_X], data[offset + SensorPoint.FR_Y]];
  const bl = [data[offset + SensorPoint.BL_X], data[offset + SensorPoint.BL_Y]];
  const br = [data[offset + SensorPoint.BR_X], data[offset + SensorPoint.BR_Y]];
  const sl = [data[offset + SensorPoint.SL_X], data[offset + SensorPoint.SL_Y]];
  const sr = [data[offset + SensorPoint.SR_X], data[offset + SensorPoint.SR_Y]];

  if (DEBUG) {
  }
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
