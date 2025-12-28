// shmSimulator/helpers/updateVehicleTransform.ts

import VehicleDataArray, {
  VEHICLE_DATA_SIZE,
  MovementData,
  SensorData,
} from "../memory/vehicleDataArray";
import SensorPointArray from "../memory/sensorPointArray";
import { updateSensorPoints } from "./sensorPoints";
import type { SimulationConfig } from "../types";

/**
 * Update vehicle position/rotation + sensor points
 */
export function updateVehicleTransform(
  vehicleDataArray: VehicleDataArray,
  sensorPointArray: SensorPointArray,
  vehIdx: number,
  x: number,
  y: number,
  rot: number,
  config: SimulationConfig
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
  vehicleDataArray: VehicleDataArray,
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
  vehicleDataArray: VehicleDataArray,
  vehIdx: number
): number {
  const vData = vehicleDataArray.getData();
  const base = vehIdx * VEHICLE_DATA_SIZE;
  return Math.trunc(vData[base + SensorData.PRESET_IDX]);
}
