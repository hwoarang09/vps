// shmSimulator/helpers/statusApplier.ts

import {
  MovementData,
  MovingStatus,
  StopReason,
  LogicData,
} from "../memory/vehicleDataArray";

/**
 * Apply vehicle status change and return collision/resume statistics
 */
export function applyVehicleStatus(
  data: Float32Array,
  vehiclePtr: number,
  canProceed: boolean
): { collisions: number; resumes: number } {
  const currentStatus = data[vehiclePtr + MovementData.MOVING_STATUS];

  if (canProceed) {
    if (currentStatus === MovingStatus.STOPPED) {
      const stopReason = data[vehiclePtr + LogicData.STOP_REASON];

      if ((stopReason & StopReason.E_STOP) !== 0) {
        return { collisions: 0, resumes: 0 };
      }

      data[vehiclePtr + MovementData.MOVING_STATUS] = MovingStatus.MOVING;
      return { collisions: 0, resumes: 1 };
    }
  } else if (!canProceed) {
    if (currentStatus === MovingStatus.MOVING) {
      data[vehiclePtr + MovementData.MOVING_STATUS] = MovingStatus.STOPPED;
      return { collisions: 1, resumes: 0 };
    }
  }
  return { collisions: 0, resumes: 0 };
}
