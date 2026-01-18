// common/vehicle/initialize/constants.ts
// Shared constants for vehicle data array structure

/**
 * Vehicle Data Array Memory Layout (22 fields × 4 bytes = 88 bytes per vehicle)
 *
 * | Field              | Type    | Offset | Section    | Description                           |
 * |--------------------|---------|--------|------------|---------------------------------------|
 * | X                  | Float32 | 0      | Movement   | World X position                      |
 * | Y                  | Float32 | 1      | Movement   | World Y position                      |
 * | Z                  | Float32 | 2      | Movement   | World Z position                      |
 * | ROTATION           | Float32 | 3      | Movement   | Y-axis rotation (radians)             |
 * | VELOCITY           | Float32 | 4      | Movement   | Current velocity (m/s)                |
 * | ACCELERATION       | Float32 | 5      | Movement   | Acceleration rate (m/s²)              |
 * | DECELERATION       | Float32 | 6      | Movement   | Deceleration rate (m/s²)              |
 * | EDGE_RATIO         | Float32 | 7      | Movement   | Progress on current edge (0.0~1.0)    |
 * | MOVING_STATUS      | Float32 | 8      | Movement   | MovingStatus enum (0=STOPPED, 1=...)  |
 * | CURRENT_EDGE       | Float32 | 9      | Movement   | Current edge ID                       |
 * | NEXT_EDGE          | Float32 | 10     | Movement   | Next edge ID                          |
 * | NEXT_EDGE_STATE    | Float32 | 11     | Movement   | NextEdgeState enum (0=EMPTY, 1=...)   |
 * | TARGET_RATIO       | Float32 | 12     | Movement   | Target ratio for smooth transition    |
 * | OFFSET             | Float32 | 13     | Movement   | Lane offset                           |
 * | PRESET_IDX         | Float32 | 14     | Sensor     | PresetIndex enum (0=STRAIGHT, 1=...)  |
 * | HIT_ZONE           | Float32 | 15     | Sensor     | HitZone enum (-1=NONE, 0=APPROACH...) |
 * | COLLISION_TARGET   | Float32 | 16     | Sensor     | Target vehicle ID for collision       |
 * | TRAFFIC_STATE      | Float32 | 17     | Logic      | TrafficState enum (0=FREE, 1=...)     |
 * | STOP_REASON        | Float32 | 18     | Logic      | StopReason bitmask                    |
 * | JOB_STATE          | Float32 | 19     | Logic      | JobState enum (0=INITIALIZING, 1=...) |
 * | DESTINATION_EDGE   | Float32 | 20     | Logic      | Target edge ID for routing            |
 * | PATH_REMAINING     | Float32 | 21     | Logic      | Remaining path length (meters)        |
 */

// ============================================================================
// Enum Constants
// ============================================================================

export const HitZone = {
  NONE: -1,
  APPROACH: 0,
  BRAKE: 1,
  STOP: 2,
} as const;

// Vehicle status enum (Moving State)
export const MovingStatus = {
  STOPPED: 0,
  MOVING: 1,
  PAUSED: 2,
} as const;

// Traffic Regulation State (Intersection/Merge control)
export const TrafficState = {
  FREE: 0,
  WAITING: 1,
  ACQUIRED: 2,
} as const;

// High-level Mission Job State
export const JobState = {
  INITIALIZING: 0,
  IDLE: 1,
  MOVE_TO_LOAD: 2,
  LOADING: 3,
  MOVE_TO_UNLOAD: 4,
  UNLOADING: 5,
  ERROR: 6,
} as const;

// Stop Reason Bitmask
export const StopReason = {
  NONE: 0,
  OBS_LIDAR: 1,
  OBS_CAMERA: 1 << 1,
  E_STOP: 1 << 2,
  LOCKED: 1 << 3,
  DESTINATION_REACHED: 1 << 4,
  PATH_BLOCKED: 1 << 5,
  LOAD_ON: 1 << 6,
  LOAD_OFF: 1 << 7,
  NOT_INITIALIZED: 1 << 8,
  INDIVIDUAL_CONTROL: 1 << 9,
  SENSORED: 1 << 10,
} as const;

// Next Edge State for TransferMgr
export const NextEdgeState = {
  EMPTY: 0,
  PENDING: 1,
  READY: 2,
} as const;

// Sensor preset indices (synced with sensorPresets.ts)
export const PresetIndex = {
  STRAIGHT: 0,
  CURVE_LEFT: 1,
  CURVE_RIGHT: 2,
  U_TURN: 3,
  MERGE: 4,
  BRANCH: 5,
} as const;

// Transition Control Mode
export const TransferMode = {
  LOOP: "LOOP",
  RANDOM: "RANDOM",
  MQTT_CONTROL: "MQTT_CONTROL",
  AUTO_ROUTE: "AUTO_ROUTE",
} as const;
export type TransferMode = typeof TransferMode[keyof typeof TransferMode];

// ============================================================================
// Memory Layout - Auto-generated Offsets
// ============================================================================

/** Next Edge 배열 크기 (5개) */
export const NEXT_EDGE_COUNT = 5;

let _mPtr = 0;
export const MovementData = {
  X: _mPtr++,
  Y: _mPtr++,
  Z: _mPtr++,
  ROTATION: _mPtr++,
  VELOCITY: _mPtr++,
  ACCELERATION: _mPtr++,
  DECELERATION: _mPtr++,
  EDGE_RATIO: _mPtr++,
  MOVING_STATUS: _mPtr++,
  CURRENT_EDGE: _mPtr++,
  // Next Edge 배열 (5개) - 경로 탐색용
  NEXT_EDGE_0: _mPtr++,
  NEXT_EDGE_1: _mPtr++,
  NEXT_EDGE_2: _mPtr++,
  NEXT_EDGE_3: _mPtr++,
  NEXT_EDGE_4: _mPtr++,
  NEXT_EDGE_STATE: _mPtr++,  // NEXT_EDGE_0의 준비 상태
  TARGET_RATIO: _mPtr++,
  OFFSET: _mPtr++,
} as const;
const MOVEMENT_SIZE = _mPtr;

let _sPtr = MOVEMENT_SIZE;
export const SensorData = {
  PRESET_IDX: _sPtr++,
  HIT_ZONE: _sPtr++,
  COLLISION_TARGET: _sPtr++,
} as const;

let _lPtr = _sPtr;
export const LogicData = {
  TRAFFIC_STATE: _lPtr++,
  STOP_REASON: _lPtr++,
  JOB_STATE: _lPtr++,
  DESTINATION_EDGE: _lPtr++,
  PATH_REMAINING: _lPtr++,
} as const;

export const VEHICLE_DATA_SIZE = _lPtr;