// common/vehicle/helpers/updateVehicleTransform.ts

import {
  VEHICLE_DATA_SIZE,
  MovementData,
  SensorData,
} from "@/common/vehicle/initialize/constants";
import { updateSensorPoints, type SensorPointsConfig } from "./sensorPoints";
import type { ISensorPointArray } from "@/common/vehicle/collision/sensorCollision";

export interface IVehicleDataArray {
  getData(): Float32Array;
}

/**
 * Update vehicle position/rotation + sensor points
 */
export function updateVehicleTransform(
  vehicleDataArray: IVehicleDataArray,
  sensorPointArray: ISensorPointArray,
  vehIdx: number,
  x: number,
  y: number,
  rot: number,
  config: SensorPointsConfig
): void {
  const vData = vehicleDataArray.getData();
  const base = vehIdx * VEHICLE_DATA_SIZE;

  vData[base + MovementData.X] = x;
  vData[base + MovementData.Y] = y;
  vData[base + MovementData.ROTATION] = rot;

  const presetIdx = Math.trunc(vData[base + SensorData.PRESET_IDX]);

  updateSensorPoints(sensorPointArray, vehIdx, x, y, rot, presetIdx, config);
}

/**
 * Set sensor preset (called on edge entry)
 */
export function setSensorPreset(
  vehicleDataArray: IVehicleDataArray,
  vehIdx: number,
  presetIdx: number
): void {
  const vData = vehicleDataArray.getData();
  const base = vehIdx * VEHICLE_DATA_SIZE;
  vData[base + SensorData.PRESET_IDX] = presetIdx;
}

/**
 * Get sensor preset
 */
export function getSensorPreset(
  vehicleDataArray: IVehicleDataArray,
  vehIdx: number
): number {
  const vData = vehicleDataArray.getData();
  const base = vehIdx * VEHICLE_DATA_SIZE;
  return Math.trunc(vData[base + SensorData.PRESET_IDX]);
}
