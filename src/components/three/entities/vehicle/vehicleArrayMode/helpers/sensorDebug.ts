// Wrapper using global sensorPointArray
import { sensorPointArray } from "@/store/vehicle/arrayMode/sensorPointArray";
import {
  logSensorData as logSensorDataBase,
  isSensorDataZero as isSensorDataZeroBase,
  logSensorSummary as logSensorSummaryBase,
} from "@/common/vehicle/helpers/sensorDebug";

export function logSensorData(vehIdx: number, label: string = "", zoneIndex: number = 0) {
  logSensorDataBase(sensorPointArray, vehIdx, label, zoneIndex);
}

export function isSensorDataZero(vehIdx: number, zoneIndex: number = 0): boolean {
  return isSensorDataZeroBase(sensorPointArray, vehIdx, zoneIndex);
}

export function logSensorSummary(numVehicles: number) {
  logSensorSummaryBase(sensorPointArray, numVehicles);
}
