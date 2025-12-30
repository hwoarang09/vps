// Wrapper using global sensorPointArray
import { sensorPointArray } from "@/store/vehicle/arrayMode/sensorPointArray";
import { getBodyLength, getBodyWidth } from "@/config/vehicleConfig";
import { updateSensorPoints as updateSensorPointsBase } from "@/common/vehicle/helpers/sensorPoints";

export function updateSensorPoints(
  vehIdx: number,
  x: number,
  y: number,
  rot: number,
  presetIdx: number
): void {
  updateSensorPointsBase(sensorPointArray, vehIdx, x, y, rot, presetIdx, {
    bodyLength: getBodyLength(),
    bodyWidth: getBodyWidth(),
  });
}
