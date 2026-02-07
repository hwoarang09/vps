// common/vehicle/initialize/constants.ts
// Shared constants for vehicle data array structure

/**
 * Vehicle Data Array Memory Layout (30 fields × 4 bytes = 120 bytes per vehicle)
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
 * | NEXT_EDGE_0~4      | Float32 | 10~14  | Movement   | Next edge IDs (5 slots)               |
 * | NEXT_EDGE_STATE    | Float32 | 15     | Movement   | NextEdgeState enum (0=EMPTY, 1=...)   |
 * | TARGET_RATIO       | Float32 | 16     | Movement   | Target ratio for smooth transition    |
 * | OFFSET             | Float32 | 17     | Movement   | Lane offset                           |
 * | PRESET_IDX         | Float32 | 18     | Sensor     | PresetIndex enum (0=STRAIGHT, 1=...)  |
 * | HIT_ZONE           | Float32 | 19     | Sensor     | HitZone enum (-1=NONE, 0=APPROACH...) |
 * | COLLISION_TARGET   | Float32 | 20     | Sensor     | Target vehicle ID for collision       |
 * | TRAFFIC_STATE      | Float32 | 21     | Logic      | TrafficState enum (0=FREE, 1=...)     |
 * | STOP_REASON        | Float32 | 22     | Logic      | StopReason bitmask                    |
 * | JOB_STATE          | Float32 | 23     | Logic      | JobState enum (0=INITIALIZING, 1=...) |
 * | DESTINATION_EDGE   | Float32 | 24     | Logic      | Target edge ID for routing            |
 * | PATH_REMAINING     | Float32 | 25     | Logic      | Remaining path length (meters)        |
 * | CHECKPOINT_HEAD    | Float32 | 26     | Logic      | Next checkpoint index in array        |
 * | CURRENT_CP_EDGE    | Float32 | 27     | Logic      | Current checkpoint edge (1-based)     |
 * | CURRENT_CP_RATIO   | Float32 | 28     | Logic      | Current checkpoint ratio (0.0~1.0)    |
 * | CURRENT_CP_FLAGS   | Float32 | 29     | Logic      | Current checkpoint flags (mutable)    |
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
  IDLE: 1 << 11,
} as const;

// Checkpoint Flags Bitmask (for unified checkpoint system)
export const CheckpointFlags = {
  NONE: 0,
  LOCK_REQUEST: 1 << 0,  // 0x01 - Request lock at merge point
  LOCK_WAIT: 1 << 1,     // 0x02 - Wait for lock grant
  LOCK_RELEASE: 1 << 2,  // 0x04 - Release lock after passing merge
  MOVE_PREPARE: 1 << 3,  // 0x08 - Prepare next edge (curves)
  MOVE_SLOW: 1 << 4,     // 0x10 - Deceleration zone
} as const;

// Checkpoint structure (stored separately from VehicleDataArray)
export interface Checkpoint {
  edge: number;   // Edge ID (1-based)
  ratio: number;  // Progress on edge (0.0 ~ 1.0)
  flags: number;  // CheckpointFlags bitmask
}

// ============================================================================
// Checkpoint Array Constants
// ============================================================================

/**
 * Checkpoint 배열 상수
 * - MAX_CHECKPOINTS_PER_VEHICLE: Vehicle당 최대 checkpoint 수
 * - CHECKPOINT_FIELDS: checkpoint당 필드 수 (edge, ratio, flags)
 * - CHECKPOINT_SECTION_SIZE: vehicle 1대가 차지하는 크기 (count + checkpoints)
 */
export const MAX_CHECKPOINTS_PER_VEHICLE = 100;
export const CHECKPOINT_FIELDS = 3;  // edge, ratio, flags
export const CHECKPOINT_SECTION_SIZE = 1 + MAX_CHECKPOINTS_PER_VEHICLE * CHECKPOINT_FIELDS; // 151

/**
 * Checkpoint 배열 레이아웃 (1-based, Float32Array)
 *
 * [0]: MAX_CHECKPOINTS_PER_VEHICLE (meta)
 *
 * [1 + vehicleId * CHECKPOINT_SECTION_SIZE]: Vehicle N section
 *   - [offset + 0]: count (실제 checkpoint 개수)
 *   - [offset + 1]: checkpoint 0 - edge
 *   - [offset + 2]: checkpoint 0 - ratio
 *   - [offset + 3]: checkpoint 0 - flags
 *   - [offset + 4]: checkpoint 1 - edge
 *   - ...
 */

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
  CHECKPOINT_HEAD: _lPtr++,     // Next checkpoint index in checkpoint array
  CURRENT_CP_EDGE: _lPtr++,     // Current checkpoint edge (1-based, 0 = none)
  CURRENT_CP_RATIO: _lPtr++,    // Current checkpoint ratio (0.0 ~ 1.0)
  CURRENT_CP_FLAGS: _lPtr++,    // Current checkpoint flags (mutable, 0 = done)
} as const;

export const VEHICLE_DATA_SIZE = _lPtr;