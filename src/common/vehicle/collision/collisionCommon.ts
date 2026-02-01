// common/vehicle/collision/collisionCommon.ts
// Shared collision logic for vehicleArrayMode and shmSimulator

import {
  MovementData,
  SensorData,
  MovingStatus,
  HitZone,
} from "@/common/vehicle/initialize/constants";
import { getPreset, type SensorPreset } from "./sensorPresets";

export interface CollisionConfig {
  approachMinSpeed: number;
  brakeMinSpeed: number;
  bodyLength: number;
  /** 충돌 체크 주기 (ms) - 차량별로 이 주기마다 충돌 검사 수행 */
  collisionCheckInterval?: number;
  /** fab별 커스텀 센서 프리셋 (없으면 기본 DEFAULT_SENSOR_PRESETS 사용) */
  customSensorPresets?: SensorPreset[];
}

export function getCollisionCheckParams(
  vehicleArrayData: Float32Array,
  ptr: number,
  config: CollisionConfig
) {
  const approachMinSpeed = config.approachMinSpeed;
  const brakeMinSpeed = config.brakeMinSpeed;
  const vehicleLength = config.bodyLength;
  const velocity = vehicleArrayData[ptr + MovementData.VELOCITY];

  const presetIdx = Math.trunc(vehicleArrayData[ptr + SensorData.PRESET_IDX]);
  const preset = getPreset(presetIdx, config.customSensorPresets);

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
  config?: { approachMinSpeed: number; brakeMinSpeed: number; customSensorPresets?: SensorPreset[] }
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
  const preset = getPreset(presetIdx, config?.customSensorPresets);

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
  return Math.hypot(xA - xB, yA - yB);
}

/**
 * 차량별 충돌 체크 타이머 확인
 * @returns true면 충돌 체크 수행, false면 스킵 (이전 HIT_ZONE 유지)
 */
export function shouldCheckCollision(
  vehId: number,
  delta: number | undefined,
  collisionCheckTimers: Map<number, number> | undefined,
  checkInterval: number | undefined
): boolean {
  // 타이머가 없으면 항상 체크
  if (!collisionCheckTimers || delta === undefined || checkInterval === undefined) {
    return true;
  }

  // -1이면 항상 체크
  if (checkInterval === -1) {
    return true;
  }

  const elapsed = (collisionCheckTimers.get(vehId) ?? 0) + delta * 1000; // delta는 초 단위, ms로 변환

  // 아직 interval이 지나지 않았으면 체크 스킵
  if (elapsed < checkInterval) {
    collisionCheckTimers.set(vehId, elapsed);
    return false;
  }

  // interval 지났으면 타이머 리셋하고 체크 수행
  collisionCheckTimers.set(vehId, 0);
  return true;
}
