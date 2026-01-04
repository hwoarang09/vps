// common/vehicle/initialize/constants.ts
// Shared constants for vehicle data array structure

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
  WAITING_FOR_LOCK: 1 << 3,
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
} as const;
export type TransferMode = typeof TransferMode[keyof typeof TransferMode];

// --- ID Generator for Auto-Offsets ---
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
  NEXT_EDGE: _mPtr++,
  NEXT_EDGE_STATE: _mPtr++,
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
} as const;

export const VEHICLE_DATA_SIZE = _lPtr;

export const HitZone = {
  NONE: -1,
  APPROACH: 0,
  BRAKE: 1,
  STOP: 2,
} as const;
