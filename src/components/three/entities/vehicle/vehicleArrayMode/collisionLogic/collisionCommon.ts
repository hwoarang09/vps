import { MovementData, SensorData, MovingStatus, HitZone } from "@/store/vehicle/arrayMode/vehicleDataArray";
import { SENSOR_PRESETS } from "@/store/vehicle/arrayMode/sensorPresets";
import { getApproachMinSpeed, getBrakeMinSpeed } from "@/config/movementConfig";
import { getBodyLength } from "@/config/vehicleConfig";

/**
 * Extract basic collision check parameters for a specific vehicle.
 */
export function getCollisionCheckParams(vehicleArrayData: Float32Array, ptr: number) {
  // Constants
  const approachMinSpeed = getApproachMinSpeed();
  const brakeMinSpeed = getBrakeMinSpeed();
  const vehicleLength = getBodyLength(); 
  const velocity = vehicleArrayData[ptr + MovementData.VELOCITY];

  // Sensor
  const presetIdx = Math.trunc(vehicleArrayData[ptr + SensorData.PRESET_IDX]);
  const preset = SENSOR_PRESETS[presetIdx] ?? SENSOR_PRESETS[0];

  return { approachMinSpeed, brakeMinSpeed, vehicleLength, velocity, preset };
}

/**
 * Determine the HitZone based on distance and preset thresholds.
 */
export function determineLinearHitZone(distance: number, stopDist: number, brakeDist: number, approachDist: number): number {
  if (distance <= stopDist) {
    return HitZone.STOP;
  }
  if (distance <= brakeDist) {
    return HitZone.BRAKE;
  }
  if (distance <= approachDist) {
    return HitZone.APPROACH;
  }
  return HitZone.NONE;
}

/**
 * Apply the logic (Velocity/Deceleration/Status) based on the determined HitZone.
 */
export function applyCollisionZoneLogic(
  hitZone: number,
  data: Float32Array,
  ptrBack: number,
  targetVehId: number = -1
) {
  // Always update Hit Zone
  data[ptrBack + SensorData.HIT_ZONE] = hitZone;

  if (hitZone === HitZone.NONE) {
    data[ptrBack + SensorData.COLLISION_TARGET] = -1; // Reset target
    data[ptrBack + MovementData.DECELERATION] = 0;
    if (data[ptrBack + MovementData.MOVING_STATUS] === MovingStatus.STOPPED) {
      data[ptrBack + MovementData.MOVING_STATUS] = MovingStatus.MOVING;
    }
    return;
  }

  // Set Collision Target
  data[ptrBack + SensorData.COLLISION_TARGET] = targetVehId;

  // Fetch Data internally
  const velocity = data[ptrBack + MovementData.VELOCITY];
  const presetIdx = Math.trunc(data[ptrBack + SensorData.PRESET_IDX]);
  const preset = SENSOR_PRESETS[presetIdx] ?? SENSOR_PRESETS[0];

  // Configs
  const approachMinSpeed = getApproachMinSpeed();
  const brakeMinSpeed = getBrakeMinSpeed();

  if (hitZone === HitZone.STOP) {
    data[ptrBack + MovementData.MOVING_STATUS] = MovingStatus.STOPPED;
    data[ptrBack + MovementData.VELOCITY] = 0;
    data[ptrBack + MovementData.DECELERATION] = 0;
    return;
  }

  // Brake or Approach
  const isBrake = hitZone === HitZone.BRAKE;
  const minSpeed = isBrake ? brakeMinSpeed : approachMinSpeed;
  const decValue = isBrake ? preset.zones.brake.dec : preset.zones.approach.dec;

  if (velocity > minSpeed) {
    data[ptrBack + MovementData.DECELERATION] = decValue;
  } else {
    data[ptrBack + MovementData.DECELERATION] = 0;
  }

  if (data[ptrBack + MovementData.MOVING_STATUS] === MovingStatus.STOPPED) {
    data[ptrBack + MovementData.MOVING_STATUS] = MovingStatus.MOVING;
  }
}

/**
 * Calculate simple 1D distance based on edge axis.
 * Useful for vehicles on the SAME linear edge.
 */
export function calculateLinearDistance(axis: 'x' | 'y', data: Float32Array, ptrFront: number, ptrBack: number): number {
  if (axis === 'x') {
    const xFront = data[ptrFront + MovementData.X];
    const xBack = data[ptrBack + MovementData.X];
    return Math.abs(xFront - xBack);
  } else {
    const yFront = data[ptrFront + MovementData.Y];
    const yBack = data[ptrBack + MovementData.Y];
    return Math.abs(yFront - yBack);
  }
}

/**
 * Calculate Euclidean distance between two vehicles.
 * Useful for vehicles on different edges.
 */
export function calculateEuclideanDistance(data: Float32Array, ptrA: number, ptrB: number): number {
  const xA = data[ptrA + MovementData.X];
  const yA = data[ptrA + MovementData.Y];
  const xB = data[ptrB + MovementData.X];
  const yB = data[ptrB + MovementData.Y];
  return Math.sqrt(Math.pow(xA - xB, 2) + Math.pow(yA - yB, 2));
}
