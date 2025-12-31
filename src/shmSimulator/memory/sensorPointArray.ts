// shmSimulator/memory/sensorPointArray.ts
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
 * SensorPointArray - Worker thread version with SharedArrayBuffer support
 */
class SensorPointArray extends SensorPointArrayBase {
  constructor(maxVehicles: number) {
    super(maxVehicles);
  }

  /**
   * Set buffer from SharedArrayBuffer (for Worker thread)
   */
  setBuffer(buffer: SharedArrayBuffer): void {
    this.data = new Float32Array(buffer);
  }
}

export default SensorPointArray;
