// Wrapper using global vehicleDataArray and sensorPointArray
import { vehicleDataArray } from "@/store/vehicle/arrayMode/vehicleDataArray";
import { sensorPointArray } from "@/store/vehicle/arrayMode/sensorPointArray";
import { getBodyLength, getBodyWidth } from "@/config/vehicleConfig";
import {
  updateVehicleTransform as updateVehicleTransformBase,
  setSensorPreset as setSensorPresetBase,
  getSensorPreset as getSensorPresetBase,
} from "@/common/vehicle/helpers/updateVehicleTransform";

export function updateVehicleTransform(
  vehIdx: number,
  x: number,
  y: number,
  rot: number
): void {
  updateVehicleTransformBase(vehicleDataArray, sensorPointArray, vehIdx, x, y, rot, {
    bodyLength: getBodyLength(),
    bodyWidth: getBodyWidth(),
  });
}

export function setSensorPreset(vehIdx: number, presetIdx: number): void {
  setSensorPresetBase(vehicleDataArray, vehIdx, presetIdx);
}

export function getSensorPreset(vehIdx: number): number {
  return getSensorPresetBase(vehicleDataArray, vehIdx);
}
