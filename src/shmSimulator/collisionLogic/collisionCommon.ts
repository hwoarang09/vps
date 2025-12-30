// shmSimulator/collisionLogic/collisionCommon.ts

import {
  MovementData,
  SensorData,
  MovingStatus,
  HitZone,
} from "../memory/vehicleDataArray";
import { SENSOR_PRESETS } from "../memory/sensorPresets";
import type { SimulationConfig } from "../types";

export function getCollisionCheckParams(
  vehicleArrayData: Float32Array,
  ptr: number,
  config: SimulationConfig
) {
  const approachMinSpeed = config.approachMinSpeed;
  const brakeMinSpeed = config.brakeMinSpeed;
  const vehicleLength = config.bodyLength;
  const velocity = vehicleArrayData[ptr + MovementData.VELOCITY];

  const presetIdx = Math.trunc(vehicleArrayData[ptr + SensorData.PRESET_IDX]);
  const preset = SENSOR_PRESETS[presetIdx] ?? SENSOR_PRESETS[0];

  return { approachMinSpeed, brakeMinSpeed, vehicleLength, velocity, preset };
}

export function determineLinearHitZone(
  distance: number,
  stopDist: number,
  brakeDist: number,
  approachDist: number
): number {
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

export function applyCollisionZoneLogic(
  hitZone: number,
  data: Float32Array,
  ptrBack: number,
  targetVehId: number = -1,
  config?: { approachMinSpeed: number; brakeMinSpeed: number }
) {
  const approachMinSpeed = config?.approachMinSpeed ?? 2;
  const brakeMinSpeed = config?.brakeMinSpeed ?? 1;
  data[ptrBack + SensorData.HIT_ZONE] = hitZone;

  if (hitZone === HitZone.NONE) {
    data[ptrBack + SensorData.COLLISION_TARGET] = -1;
    data[ptrBack + MovementData.DECELERATION] = 0;
    if (data[ptrBack + MovementData.MOVING_STATUS] === MovingStatus.STOPPED) {
      data[ptrBack + MovementData.MOVING_STATUS] = MovingStatus.MOVING;
    }
    return;
  }

  data[ptrBack + SensorData.COLLISION_TARGET] = targetVehId;

  const velocity = data[ptrBack + MovementData.VELOCITY];
  const presetIdx = Math.trunc(data[ptrBack + SensorData.PRESET_IDX]);
  const preset = SENSOR_PRESETS[presetIdx] ?? SENSOR_PRESETS[0];

  if (hitZone === HitZone.STOP) {
    data[ptrBack + MovementData.MOVING_STATUS] = MovingStatus.STOPPED;
    data[ptrBack + MovementData.VELOCITY] = 0;
    data[ptrBack + MovementData.DECELERATION] = 0;
    return;
  }

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

export function calculateLinearDistance(
  axis: "x" | "y",
  data: Float32Array,
  ptrFront: number,
  ptrBack: number
): number {
  if (axis === "x") {
    const xFront = data[ptrFront + MovementData.X];
    const xBack = data[ptrBack + MovementData.X];
    return Math.abs(xFront - xBack);
  } else {
    const yFront = data[ptrFront + MovementData.Y];
    const yBack = data[ptrBack + MovementData.Y];
    return Math.abs(yFront - yBack);
  }
}

export function calculateEuclideanDistance(
  data: Float32Array,
  ptrA: number,
  ptrB: number
): number {
  const xA = data[ptrA + MovementData.X];
  const yA = data[ptrA + MovementData.Y];
  const xB = data[ptrB + MovementData.X];
  const yB = data[ptrB + MovementData.Y];
  return Math.sqrt(Math.pow(xA - xB, 2) + Math.pow(yA - yB, 2));
}
