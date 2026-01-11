// common/vehicle/helpers/sensorPoints.ts

import {
  SENSOR_DATA_SIZE,
  SENSOR_POINT_SIZE,
  SensorPoint,
  type ISensorPointArray,
} from "@/common/vehicle/collision/sensorCollision";
import { SENSOR_PRESETS, getSensorZone } from "@/common/vehicle/collision/sensorPresets";

const DEG2RAD = Math.PI / 180;

// Zero-GC: 모듈 레벨 상수 배열 (매 호출마다 배열 생성 방지)
const ZONE_KEYS = ["approach", "brake", "stop"] as const;

export interface SensorPointsConfig {
  bodyLength: number;
  bodyWidth: number;
}

export function updateSensorPoints(
  sensorPointArray: ISensorPointArray,
  vehIdx: number,
  x: number,
  y: number,
  rot: number,
  presetIdx: number,
  config: SensorPointsConfig
): void {
  const d = sensorPointArray.getData();
  const base = vehIdx * SENSOR_DATA_SIZE;
  const preset = SENSOR_PRESETS[presetIdx] ?? SENSOR_PRESETS[0];

  const HALF_L = config.bodyLength / 2;
  const HALF_W = config.bodyWidth / 2;

  const rotRad = rot * DEG2RAD;
  const cos = Math.cos(rotRad),
    sin = Math.sin(rotRad);

  const fx = x + HALF_L * cos,
    fy = y + HALF_L * sin;
  const bx = x - HALF_L * cos,
    by = y - HALF_L * sin;

  // Zero-GC: ZONE_KEYS 모듈 레벨 상수 사용
  for (let zoneIndex = 0; zoneIndex < ZONE_KEYS.length; zoneIndex++) {
    const zoneKey = ZONE_KEYS[zoneIndex];
    const zone = getSensorZone(preset, zoneKey);
    const widthScale = 1;
    const wx = HALF_W * widthScale * sin;
    const wy = HALF_W * widthScale * cos;

    const o = base + zoneIndex * SENSOR_POINT_SIZE;

    d[o + SensorPoint.FL_X] = fx - wx;
    d[o + SensorPoint.FL_Y] = fy + wy;
    d[o + SensorPoint.FR_X] = fx + wx;
    d[o + SensorPoint.FR_Y] = fy - wy;
    d[o + SensorPoint.BL_X] = bx - wx;
    d[o + SensorPoint.BL_Y] = by + wy;
    d[o + SensorPoint.BR_X] = bx + wx;
    d[o + SensorPoint.BR_Y] = by - wy;

    const leftAngleRad = zone.leftAngle * DEG2RAD;
    const rightAngleRad = zone.rightAngle * DEG2RAD;

    const leftLocalX = zone.leftLength * Math.cos(leftAngleRad);
    const leftLocalY = zone.leftLength * Math.sin(leftAngleRad);
    const rightLocalX = zone.rightLength * Math.cos(rightAngleRad);
    const rightLocalY = zone.rightLength * Math.sin(rightAngleRad);

    const leftWorldX = leftLocalX * cos - leftLocalY * sin;
    const leftWorldY = leftLocalX * sin + leftLocalY * cos;
    const rightWorldX = rightLocalX * cos - rightLocalY * sin;
    const rightWorldY = rightLocalX * sin + rightLocalY * cos;

    d[o + SensorPoint.SL_X] = d[o + SensorPoint.FL_X] + leftWorldX;
    d[o + SensorPoint.SL_Y] = d[o + SensorPoint.FL_Y] + leftWorldY;
    d[o + SensorPoint.SR_X] = d[o + SensorPoint.FR_X] + rightWorldX;
    d[o + SensorPoint.SR_Y] = d[o + SensorPoint.FR_Y] + rightWorldY;
  }
}
