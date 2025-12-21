// store/vehicle/arrayMode/sensorPresets.ts

export const SensorZoneKey = {
  APPROACH: "approach",
  BRAKE: "brake",
  STOP: "stop",
} as const;
export type SensorZoneKey = typeof SensorZoneKey[keyof typeof SensorZoneKey];

export interface SensorZone {
  leftAngle: number;   // degree
  rightAngle: number;  // degree
  leftLength: number;  // meters
  rightLength: number; // meters
  dec: number;         // deceleration command (m/s^2), negative = braking, -1 = full stop
}

export interface SensorPreset {
  zones: Record<SensorZoneKey, SensorZone>;
  /**
   * Legacy flat fields for compatibility (uses the "approach" zone values).
   * TODO: migrate callers to zone-aware access and remove these.
   */
  leftAngle: number;
  rightAngle: number;
  leftLength: number;
  rightLength: number;
}

export const SENSOR_PRESETS: SensorPreset[] = [
  // 0: 직진
  {
    zones: {
      approach: { leftAngle: 0, rightAngle: 0, leftLength: 2.5, rightLength: 2.5, dec: -1 },
      brake:    { leftAngle: 0, rightAngle: 0, leftLength: 1.5, rightLength: 1.5, dec: -3 },
      stop:     { leftAngle: 0, rightAngle: 0, leftLength: 0.5, rightLength: 0.5, dec: -Infinity }, // force stop
    },
    leftAngle: 0, rightAngle: 0, leftLength: 2.5, rightLength: 2.5,
  },
  // 1: 좌커브
  {
    zones: {
      approach: { leftAngle: 65, rightAngle: -30, leftLength: 1, rightLength: 1, dec: -1 },
      brake:    { leftAngle: 65, rightAngle: -30, leftLength: 0.4, rightLength: 0.4, dec: -3 },
      stop:     { leftAngle: 65, rightAngle: -30, leftLength: 0.2, rightLength: 0.2, dec: -Infinity },
    },
    leftAngle: 65, rightAngle: -30, leftLength: 1, rightLength: 1,
  },
  // 2: 우커브
  {
    zones: {
      approach: { leftAngle: -30, rightAngle: -65, leftLength: 1, rightLength: 1, dec: -1 },
      brake:    { leftAngle: -30, rightAngle: -65, leftLength: 0.4, rightLength: 0.4, dec: -3 },
      stop:     { leftAngle: -30, rightAngle: -65, leftLength: 0.2, rightLength: 0.2, dec: -Infinity },
    },
    leftAngle: -30, rightAngle: -65, leftLength: 1, rightLength: 1,
  },
  // 3: 180도
  {
    zones: {
      approach: { leftAngle: 55, rightAngle: -55, leftLength: 1, rightLength: 1, dec: -1 },
      brake:    { leftAngle: 55, rightAngle: -55, leftLength: 0.7, rightLength: 0.7, dec: -3 },
      stop:     { leftAngle: 55, rightAngle: -55, leftLength: 0.5, rightLength: 0.5, dec: -Infinity },
    },
    leftAngle: 55, rightAngle: -55, leftLength: 1, rightLength: 1,
  },  
  // 3: 합류
  {
    zones: {
      approach: { leftAngle: 25, rightAngle: -25, leftLength: 1.8, rightLength: 1.8, dec: -1 },
      brake:    { leftAngle: 25, rightAngle: -25, leftLength: 1, rightLength: 1, dec: -3 },
      stop:     { leftAngle: 25, rightAngle: -25, leftLength: 0.4, rightLength: 0.4, dec: -Infinity },
    },
    leftAngle: 25, rightAngle: -25, leftLength: 1.8, rightLength: 1.8,
  },
  // 4: 분기
  {
    zones: {
      approach: { leftAngle: 30, rightAngle: -30, leftLength: 1.8, rightLength: 1.8, dec: -1 },
      brake:    { leftAngle: 30, rightAngle: -30, leftLength: 1, rightLength: 1, dec: -3 },
      stop:     { leftAngle: 30, rightAngle: -30, leftLength: 0.4, rightLength: 0.4, dec: -Infinity },
    },
    leftAngle: 30, rightAngle: -30, leftLength: 1.8, rightLength: 1.8,
  },
];

export const PresetIndex = {
  STRAIGHT: 0, CURVE_LEFT: 1, CURVE_RIGHT: 2, MERGE: 3, BRANCH: 4,
} as const;

/**
 * Helper: get a specific zone from a preset (defaults to "approach")
 */
export function getSensorZone(
  preset: SensorPreset,
  zone: SensorZoneKey = "approach"
): SensorZone {
  return preset.zones[zone];
}
