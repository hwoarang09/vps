// store/vehicle/arrayMode/sensorPointArray.ts
// 3-zone sensor geometry per vehicle (approach/brake/stop)

import { SensorPointArrayBase } from "@/common/vehicle/memory/SensorPointArrayBase";

// Re-export constants for compatibility
export {
  SENSOR_ZONE_COUNT,
  SENSOR_POINT_SIZE,
  SENSOR_DATA_SIZE,
  SensorPoint,
} from "@/common/vehicle/memory/SensorPointArrayBase";

/**
 * SensorPointArray - Single thread version (no SharedArrayBuffer)
 */
class SensorPointArray extends SensorPointArrayBase {
  constructor(maxVehicles: number) {
    super(maxVehicles);
  }
}

// Singleton - 필요시 maxVehicles 조정
export const sensorPointArray = new SensorPointArray(200000);
