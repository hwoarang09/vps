// common/vehicle/initialize/constants.ts
// Shared constants for vehicle data array structure

// Vehicle status enum (Moving State)
export const MovingStatus = {
  STOPPED: 0,
  MOVING: 1,
  PAUSED: 2,
} as const;

// Next Edge State for TransferMgr
export const NextEdgeState = {
  EMPTY: 0,
  PENDING: 1,
  READY: 2,
} as const;

// Sensor preset indices
export const PresetIndex = {
  STRAIGHT: 0,
  CURVE_LEFT: 1,
  CURVE_RIGHT: 2,
  MERGE: 3,
  BRANCH: 4,
} as const;

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
  OFFSET: _mPtr++,
} as const;
const MOVEMENT_SIZE = _mPtr;

let _sPtr = MOVEMENT_SIZE;
export const SensorData = {
  PRESET_IDX: _sPtr++,
  HIT_ZONE: _sPtr++,
  COLLISION_TARGET: _sPtr++,
} as const;

export const VEHICLE_DATA_SIZE = _sPtr + 3; // +3 for LogicData (TRAFFIC_STATE, STOP_REASON, JOB_STATE)
