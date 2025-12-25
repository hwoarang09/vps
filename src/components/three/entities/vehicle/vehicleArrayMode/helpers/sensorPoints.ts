// vehicleArrayMode/helpers/sensorPoints.ts

import { sensorPointArray, SENSOR_DATA_SIZE, SENSOR_POINT_SIZE, SensorPoint } from "@/store/vehicle/arrayMode/sensorPointArray";
import { SENSOR_PRESETS, getSensorZone } from "@/store/vehicle/arrayMode/sensorPresets";
import { getBodyLength, getBodyWidth } from "@/config/vehicleConfig";

const DEG2RAD = Math.PI / 180;

export function updateSensorPoints(vehIdx: number, x: number, y: number, rot: number, presetIdx: number): void {
  const d = sensorPointArray.getData();
  const base = vehIdx * SENSOR_DATA_SIZE;
  const preset = SENSOR_PRESETS[presetIdx] ?? SENSOR_PRESETS[0];

  // Get body dimensions from config
  const HALF_L = getBodyLength() / 2;
  const HALF_W = getBodyWidth() / 2;

  // rot is in DEGREES, convert to radians
  const rotRad = rot * DEG2RAD;
  const cos = Math.cos(rotRad), sin = Math.sin(rotRad);

  const fx = x + HALF_L * cos, fy = y + HALF_L * sin;
  const bx = x - HALF_L * cos, by = y - HALF_L * sin;

  // 3 zones: approach(outer, yellow), brake(middle, orange), stop(inner, red)
  const zones = ["approach", "brake", "stop"] as const;
  for (let zoneIndex = 0; zoneIndex < zones.length; zoneIndex++) {
    const zoneKey = zones[zoneIndex];
    const zone = getSensorZone(preset, zoneKey);
    const widthScale = 1; 
    const wx = HALF_W * widthScale * sin;
    const wy = HALF_W * widthScale * cos;

    const o = base + zoneIndex * SENSOR_POINT_SIZE;

    // 1. Body corners (scaled width toward center for inner zones)
    d[o + SensorPoint.FL_X] = fx - wx; d[o + SensorPoint.FL_Y] = fy + wy;
    d[o + SensorPoint.FR_X] = fx + wx; d[o + SensorPoint.FR_Y] = fy - wy;
    d[o + SensorPoint.BL_X] = bx - wx; d[o + SensorPoint.BL_Y] = by + wy;
    d[o + SensorPoint.BR_X] = bx + wx; d[o + SensorPoint.BR_Y] = by - wy;

    // 2. Sensor tips (local -> world)
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
