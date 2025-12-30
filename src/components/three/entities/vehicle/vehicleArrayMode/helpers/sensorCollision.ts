// Re-export constants and types from common
export {
  SENSOR_ZONE_COUNT,
  SENSOR_POINT_SIZE,
  SENSOR_DATA_SIZE,
  SensorPoint,
  type ISensorPointArray,
} from "@/common/vehicle/collision/sensorCollision";

import { sensorPointArray } from "@/store/vehicle/arrayMode/sensorPointArray";
import {
  checkSensorCollision as checkSensorCollisionBase,
  roughDistanceCheck as roughDistanceCheckBase,
} from "@/common/vehicle/collision/sensorCollision";

/**
 * Sensor collision check (SAT algorithm, Zero-GC)
 * Uses global sensorPointArray
 * @returns zone index (0=approach, 1=brake, 2=stop) or -1 if no collision
 */
export function checkSensorCollision(
  sensorVehIdx: number,
  targetVehIdx: number
): number {
  return checkSensorCollisionBase(sensorPointArray, sensorVehIdx, targetVehIdx);
}

/**
 * Rough distance check (quick filter before precise SAT check)
 * Uses global sensorPointArray
 */
export function roughDistanceCheck(
  vehIdx1: number,
  vehIdx2: number,
  threshold: number
): boolean {
  return roughDistanceCheckBase(sensorPointArray, vehIdx1, vehIdx2, threshold);
}
