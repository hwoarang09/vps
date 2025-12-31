// shmSimulator/memory/vehicleDataArray.ts
// Vehicle state storage using Float32Array (Worker thread compatible)

import { VehicleDataArrayBase } from "@/common/vehicle/memory/VehicleDataArrayBase";

// Re-export constants for compatibility
export {
  MovingStatus,
  TrafficState,
  StopReason,
  JobState,
  NextEdgeState,
  MovementData,
  SensorData,
  LogicData,
  VEHICLE_DATA_SIZE,
  HitZone,
} from "@/common/vehicle/memory/VehicleDataArrayBase";

/**
 * VehicleDataArray - Worker thread version with SharedArrayBuffer support
 */
class VehicleDataArray extends VehicleDataArrayBase {
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

export default VehicleDataArray;
