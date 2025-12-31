// vehicleDataArray.ts
// Vehicle state storage using Float32Array (single thread)

import { getMaxVehicles } from "@/config/vehicleConfig";
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
 * VehicleDataArray - Single thread version (no SharedArrayBuffer)
 */
class VehicleDataArray extends VehicleDataArrayBase {
  constructor(maxVehicles: number = getMaxVehicles()) {
    super(maxVehicles);
  }
}

// Singleton instance
export const vehicleDataArray = new VehicleDataArray(getMaxVehicles());

// Expose to window for debugging and external access
if (typeof globalThis !== 'undefined') {
  (globalThis as any).vehicleDataArray = vehicleDataArray;
}

export default VehicleDataArray;
