// common/vehicle/collision/sensorPresets.ts
// Shared sensor presets for vehicleArrayMode and shmSimulator

export const SensorZoneKey = {
  APPROACH: "approach",
  BRAKE: "brake",
  STOP: "stop",
} as const;
export type SensorZoneKey = (typeof SensorZoneKey)[keyof typeof SensorZoneKey];

export interface SensorZone {
  leftAngle: number;
  rightAngle: number;
  leftLength: number;
  rightLength: number;
  dec: number;
}

export interface SensorPreset {
  zones: Record<SensorZoneKey, SensorZone>;
  leftAngle: number;
  rightAngle: number;
  leftLength: number;
  rightLength: number;
}

/** 기본 센서 프리셋 (fab별 커스텀 설정이 없을 때 사용) */
export const DEFAULT_SENSOR_PRESETS: SensorPreset[] = [
  // 0: STRAIGHT
  {
    zones: {
      approach: { leftAngle: 0, rightAngle: 0, leftLength: 4.5, rightLength: 4.5, dec: -3 },
      brake: { leftAngle: 0, rightAngle: 0, leftLength: 1.2, rightLength: 1.2, dec: -4 },
      stop: { leftAngle: 0, rightAngle: 0, leftLength: 0.3, rightLength: 0.3, dec: -Infinity },
    },
    leftAngle: 0,
    rightAngle: 0,
    leftLength: 2.5,
    rightLength: 2.5,
  },
  // 1: CURVE_LEFT
  {
    zones: {
      approach: { leftAngle: 65, rightAngle: -30, leftLength: 1, rightLength: 1, dec: -1 },
      brake: { leftAngle: 65, rightAngle: -30, leftLength: 0.4, rightLength: 0.4, dec: -3 },
      stop: { leftAngle: 65, rightAngle: -30, leftLength: 0.2, rightLength: 0.2, dec: -Infinity },
    },
    leftAngle: 65,
    rightAngle: -30,
    leftLength: 1,
    rightLength: 1,
  },
  // 2: CURVE_RIGHT
  {
    zones: {
      approach: { leftAngle: -30, rightAngle: -65, leftLength: 1, rightLength: 1, dec: -1 },
      brake: { leftAngle: -30, rightAngle: -65, leftLength: 0.4, rightLength: 0.4, dec: -3 },
      stop: { leftAngle: -30, rightAngle: -65, leftLength: 0.2, rightLength: 0.2, dec: -Infinity },
    },
    leftAngle: -30,
    rightAngle: -65,
    leftLength: 1,
    rightLength: 1,
  },
  // 3: U-TURN (180)
  {
    zones: {
      approach: { leftAngle: 55, rightAngle: -55, leftLength: 1, rightLength: 1, dec: -1 },
      brake: { leftAngle: 55, rightAngle: -55, leftLength: 0.5, rightLength: 0.5, dec: -3 },
      stop: { leftAngle: 55, rightAngle: -55, leftLength: 0.3, rightLength: 0.3, dec: -Infinity },
    },
    leftAngle: 55,
    rightAngle: -55,
    leftLength: 1,
    rightLength: 1,
  },
  // 4: MERGE
  {
    zones: {
      approach: { leftAngle: 25, rightAngle: -25, leftLength: 1.8, rightLength: 1.8, dec: -1 },
      brake: { leftAngle: 25, rightAngle: -25, leftLength: 1, rightLength: 1, dec: -3 },
      stop: { leftAngle: 25, rightAngle: -25, leftLength: 0.4, rightLength: 0.4, dec: -Infinity },
    },
    leftAngle: 25,
    rightAngle: -25,
    leftLength: 1.8,
    rightLength: 1.8,
  },
  // 5: BRANCH
  {
    zones: {
      approach: { leftAngle: 30, rightAngle: -30, leftLength: 1.8, rightLength: 1.8, dec: -1 },
      brake: { leftAngle: 30, rightAngle: -30, leftLength: 1, rightLength: 1, dec: -3 },
      stop: { leftAngle: 30, rightAngle: -30, leftLength: 0.4, rightLength: 0.4, dec: -Infinity },
    },
    leftAngle: 30,
    rightAngle: -30,
    leftLength: 1.8,
    rightLength: 1.8,
  },
];

export const PresetIndex = {
  STRAIGHT: 0,
  CURVE_LEFT: 1,
  CURVE_RIGHT: 2,
  U_TURN: 3,
  MERGE: 4,
  BRANCH: 5,
} as const;

export function getSensorZone(
  preset: SensorPreset,
  zone: SensorZoneKey = "approach"
): SensorZone {
  return preset.zones[zone];
}

/**
 * 센서 프리셋을 가져옵니다.
 * @param presetIdx 프리셋 인덱스 (0: STRAIGHT, 1: CURVE_LEFT, ...)
 * @param customPresets fab별 커스텀 프리셋 (없으면 기본 DEFAULT_SENSOR_PRESETS 사용)
 * @returns 해당 인덱스의 프리셋 (유효하지 않은 인덱스면 첫 번째 프리셋)
 */
export function getPreset(presetIdx: number, customPresets?: SensorPreset[]): SensorPreset {
  const presets = customPresets ?? DEFAULT_SENSOR_PRESETS;
  return presets[presetIdx] ?? presets[0];
}
