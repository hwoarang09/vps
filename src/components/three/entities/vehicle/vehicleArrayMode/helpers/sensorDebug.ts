// sensorDebug.ts - Debugging utilities for sensor geometry

import { sensorPointArray, SensorPoint, SENSOR_DATA_SIZE, SENSOR_POINT_SIZE } from "@/store/vehicle/arrayMode/sensorPointArray";
const DEBUG = false;

/**
 * Log sensor data for a specific vehicle
 */
export function logSensorData(vehIdx: number, label: string = "", zoneIndex: number = 0) {
  const data = sensorPointArray.getData();
  const offset = vehIdx * SENSOR_DATA_SIZE + zoneIndex * SENSOR_POINT_SIZE;

  const fl = [data[offset + SensorPoint.FL_X], data[offset + SensorPoint.FL_Y]];
  const fr = [data[offset + SensorPoint.FR_X], data[offset + SensorPoint.FR_Y]];
  const bl = [data[offset + SensorPoint.BL_X], data[offset + SensorPoint.BL_Y]];
  const br = [data[offset + SensorPoint.BR_X], data[offset + SensorPoint.BR_Y]];
  const sl = [data[offset + SensorPoint.SL_X], data[offset + SensorPoint.SL_Y]];
  const sr = [data[offset + SensorPoint.SR_X], data[offset + SensorPoint.SR_Y]];

  if (DEBUG) {
  console.log(`[SensorDebug] ${label} VEH${vehIdx}:`);
  console.log(`  FL: (${fl[0].toFixed(2)}, ${fl[1].toFixed(2)})`);
  console.log(`  FR: (${fr[0].toFixed(2)}, ${fr[1].toFixed(2)})`);
  console.log(`  BL: (${bl[0].toFixed(2)}, ${bl[1].toFixed(2)})`);
  console.log(`  BR: (${br[0].toFixed(2)}, ${br[1].toFixed(2)})`);
  console.log(`  SL: (${sl[0].toFixed(2)}, ${sl[1].toFixed(2)})`);
  console.log(`  SR: (${sr[0].toFixed(2)}, ${sr[1].toFixed(2)})`);
  }
}

/**
 * Check if sensor data is all zeros (not initialized)
 */
export function isSensorDataZero(vehIdx: number, zoneIndex: number = 0): boolean {
  const data = sensorPointArray.getData();
  const offset = vehIdx * SENSOR_DATA_SIZE + zoneIndex * SENSOR_POINT_SIZE;

  for (let i = 0; i < SENSOR_POINT_SIZE; i++) {
    if (data[offset + i] !== 0) return false;
  }
  return true;
}

/**
 * Log summary of sensor data status
 */
export function logSensorSummary(numVehicles: number) {
  let zeroCount = 0;
  let nonZeroCount = 0;

  for (let i = 0; i < numVehicles; i++) {
    if (isSensorDataZero(i)) {
      zeroCount++;
    } else {
      nonZeroCount++;
    }
  }

  console.log(`[SensorDebug] Summary: ${nonZeroCount} initialized, ${zeroCount} zero (total: ${numVehicles})`);
  
  if (nonZeroCount > 0) {
    // Log first non-zero vehicle
    for (let i = 0; i < numVehicles; i++) {
      if (!isSensorDataZero(i)) {
        logSensorData(i, "First initialized");
        break;
      }
    }
  }
}
