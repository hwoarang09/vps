// shmSimulator/types.ts
// Shared types for the SHM Simulator

import type { Edge } from "@/types/edge";
import type { Node } from "@/types";
import { TransferMode } from "@/common/vehicle/initialize/constants";
import { StationRawData } from "@/types/station";

// ============================================================================
// [0] MEMORY REGION (Multi-Worker Support)
// ============================================================================

/**
 * SharedArrayBuffer 내에서 할당된 메모리 영역 정보
 * 멀티 워커 환경에서 각 워커가 자신의 영역만 접근하도록 제한
 */
export interface MemoryRegion {
  /** SharedArrayBuffer 내 시작 오프셋 (bytes) */
  offset: number;
  /** 할당된 영역 크기 (bytes) */
  size: number;
  /** 이 영역에서 관리할 수 있는 최대 Vehicle 수 */
  maxVehicles: number;
}

/**
 * Fab별 메모리 할당 정보
 */
export interface FabMemoryAssignment {
  fabId: string;
  /** Vehicle 데이터 영역 */
  vehicleRegion: MemoryRegion;
  /** Sensor 데이터 영역 */
  sensorRegion: MemoryRegion;
}

// ============================================================================
// [1] SIMULATION CONFIG
// ============================================================================

export interface SimulationConfig {
  // Vehicle dimensions
  maxVehicles: number;
  bodyLength: number;
  bodyWidth: number;
  bodyHeight: number;
  sensorLength: number;
  sensorWidth: number;
  vehicleZOffset: number;

  // Movement parameters
  linearMaxSpeed: number;
  linearAcceleration: number;
  linearDeceleration: number;
  curveMaxSpeed: number;
  curveAcceleration: number;
  approachMinSpeed: number;
  brakeMinSpeed: number;

  // Spacing
  edgeMargin: number;
  vehicleSpacing: number;
  crossEdgeSafeDistance: number;

  // Simulation
  targetFps: number;
  maxDelta: number;
}

export interface VehicleInitConfig {
  acceleration: number;
  deceleration: number;
  maxSpeed: number;
}

// Default config factory
export function createDefaultConfig(): SimulationConfig {
  return {
    maxVehicles: 200000,
    bodyLength: 1.2,
    bodyWidth: 0.6,
    bodyHeight: 0.3,
    sensorLength: 0.6,
    sensorWidth: 0.5,
    vehicleZOffset: 3.8,
    linearMaxSpeed: 5,
    linearAcceleration: 3,
    linearDeceleration: 5,
    curveMaxSpeed: 1,
    curveAcceleration: 1,
    approachMinSpeed: 2,
    brakeMinSpeed: 1,
    edgeMargin: 0.5,
    vehicleSpacing: 0.6,
    crossEdgeSafeDistance: 1,
    targetFps: 60,
    maxDelta: 0.1,
  };
}

// ============================================================================
// [2] INIT PAYLOAD (Main -> Worker)
// ============================================================================

// 단일 Fab 초기화 데이터
export interface FabInitData {
  /** Unique identifier for the fab (e.g., "fab_A", "fab_B") */
  fabId: string;
  sharedBuffer: SharedArrayBuffer;
  sensorPointBuffer: SharedArrayBuffer;
  edges: Edge[];
  nodes: Node[];
  vehicleConfigs: VehicleInitConfig[];
  numVehicles: number;
  transferMode: TransferMode;
  stationData: StationRawData[];

  /**
   * 메모리 영역 할당 정보 (멀티 워커 환경에서 사용)
   * 없으면 전체 버퍼 사용 (하위호환)
   */
  memoryAssignment?: FabMemoryAssignment;
}

// 멀티 Fab 지원 Init Payload
export interface InitPayload {
  // 공통 설정
  config: SimulationConfig;
  // 여러 Fab 데이터
  fabs: FabInitData[];
}

// 레거시 호환용 (단일 fab) - deprecated
export interface LegacyInitPayload {
  sharedBuffer: SharedArrayBuffer;
  sensorPointBuffer: SharedArrayBuffer;
  edges: Edge[];
  nodes: Node[];
  config: SimulationConfig;
  vehicleConfigs: VehicleInitConfig[];
  numVehicles: number;
  transferMode: TransferMode;
  stationData: StationRawData[];
}

// ============================================================================
// [3] WORKER MESSAGES
// ============================================================================

// Main Thread -> Worker Messages
export type WorkerMessage =
  | { type: "INIT"; payload: InitPayload }
  | { type: "START" }
  | { type: "STOP" }
  | { type: "PAUSE" }
  | { type: "RESUME" }
  | { type: "DISPOSE" }
  | { type: "COMMAND"; /** Unique identifier for the fab */ fabId: string; payload: unknown }
  | { type: "SET_TRANSFER_MODE"; /** Unique identifier for the fab */ fabId: string; mode: TransferMode }
  // Fab 동적 관리
  | { type: "ADD_FAB"; fab: FabInitData; config: SimulationConfig }
  | { type: "REMOVE_FAB"; /** Unique identifier for the fab */ fabId: string };

// Worker -> Main Thread Messages
export type MainMessage =
  | { type: "READY" }
  | { type: "INITIALIZED"; /** Fab ID -> actual vehicle count */ fabVehicleCounts: Record<string, number> }
  | { type: "ERROR"; error: string }
  | { type: "STATS"; fps: number; vehicleCount: number }
  | { type: "PERF_STATS"; avgStepMs: number; minStepMs: number; maxStepMs: number }
  | { type: "FAB_ADDED"; /** Unique identifier for the fab */ fabId: string; actualNumVehicles: number }
  | { type: "FAB_REMOVED"; /** Unique identifier for the fab */ fabId: string };

// ============================================================================
// [4] TRANSFER MODE
// ============================================================================

// TransferMode is now imported from common
export { TransferMode } from "@/common/vehicle/initialize/constants";
// ============================================================================
// [5] RE-EXPORTS
// ============================================================================

export type { Edge } from "@/types/edge";
export type { Node } from "@/types";
export type { VehicleCommand } from "@/common/vehicle/logic/TransferMgr";
