// shmSimulator/types.ts
// Shared types for the SHM Simulator

import type { Edge } from "@/types/edge";
import type { Node } from "@/types";
import { TransferMode } from "@/common/vehicle/initialize/constants";
import { StationRawData } from "@/types/station";
import type { GrantStrategy } from "@/config/simulationConfig";
import { DeadlockZoneStrategy } from "@/config/simulationConfig";
import type { SensorPreset } from "@/common/vehicle/collision/sensorPresets";

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
 * Fab별 메모리 할당 정보 (Worker 계산 영역만)
 * 렌더 영역은 별도 버퍼로 분리됨 (FabRenderAssignment 참조)
 */
export interface FabMemoryAssignment {
  fabId: string;
  /** Vehicle 데이터 영역 (Worker 계산용) */
  vehicleRegion: MemoryRegion;
  /** Sensor 데이터 영역 (Worker 계산용) */
  sensorRegion: MemoryRegion;
  /** Path 데이터 영역 (Worker 계산용) */
  pathRegion: MemoryRegion;
}

/**
 * 공유 맵 참조 (메모리 최적화용)
 * 모든 Fab이 동일한 맵 데이터를 참조하여 복제 없이 사용
 * "평행우주" 개념 - 같은 맵에서 시뮬레이션하지만 fab간 충돌 없음
 */
export interface SharedMapRef {
  /** 원본 edges (renderingPoints 제외, 시뮬레이션용) */
  edges: Edge[];
  /** 원본 nodes */
  nodes: Node[];
  /** edge 이름 -> index 룩업 (공유) */
  edgeNameToIndex: Map<string, number>;
  /** node 이름 -> index 룩업 (공유) */
  nodeNameToIndex: Map<string, number>;
  /** 원본 stations */
  stations: StationRawData[];
}

/**
 * Fab별 렌더링 offset (출력 시 적용)
 */
export interface FabRenderOffset {
  /** X 방향 offset */
  x: number;
  /** Y 방향 offset */
  y: number;
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

  // Lock parameters
  /** 직선에서 합류할 때 Lock 대기 거리 (toNode 앞 거리) */
  lockWaitDistanceFromMergingStr: number;
  /** 직선에서 합류할 때 Lock 요청 거리 (toNode 앞 거리) */
  lockRequestDistanceFromMergingStr: number;
  /** 곡선에서 합류할 때 Lock 대기 거리 (fromNode 앞 거리) */
  lockWaitDistanceFromMergingCurve: number;
  /** 곡선에서 합류할 때 Lock 요청 거리 (fromNode 앞 거리) */
  lockRequestDistanceFromMergingCurve: number;
  /** Lock 승인 전략 */
  lockGrantStrategy: GrantStrategy;
  /** 데드락 유발 존 전용 정책 */
  lockDeadlockZoneStrategy: DeadlockZoneStrategy;

  // Simulation
  targetFps: number;
  maxDelta: number;

  // Check intervals (optional)
  /** 충돌 체크 주기 (ms) - 차량별로 이 주기마다 충돌 검사 수행 */
  collisionCheckInterval?: number;
  /** 곡선 사전 감속 체크 주기 (ms) - 차량별로 이 주기마다 곡선 사전 감속 검사 수행 */
  curvePreBrakeCheckInterval?: number;

  // Log settings
  /** DevLogger 활성화 여부 (개발용 텍스트 로그) */
  devLogEnabled?: boolean;
  /** EdgeTransitTracker 활성화 여부 (edge 통과 바이너리 로그) */
  edgeTransitLogEnabled?: boolean;

  // Sensor presets (fab별 오버라이드 가능)
  /** fab별 커스텀 센서 프리셋 (없으면 기본 DEFAULT_SENSOR_PRESETS 사용) */
  customSensorPresets?: SensorPreset[];
}

export interface VehicleInitConfig {
  acceleration: number;
  deceleration: number;
  maxSpeed: number;
}

// Default config factory
export function createDefaultConfig(): SimulationConfig {
  // Try to use loaded config, fallback to hardcoded defaults
  // This is imported at build time, so it's safe to use dynamic import
  // Note: In worker context, we should pass config from main thread instead
  return {
    maxVehicles: 200000,
    bodyLength: 1.2,
    bodyWidth: 0.6,
    bodyHeight: 0.3,
    vehicleZOffset: 3.8,
    linearMaxSpeed: 5,
    linearAcceleration: 2,
    linearDeceleration: -3,
    curveMaxSpeed: 1,
    curveAcceleration: 1,
    approachMinSpeed: 2,
    brakeMinSpeed: 1.2,
    edgeMargin: 0.5,
    vehicleSpacing: 0.6,
    crossEdgeSafeDistance: 1,
    lockWaitDistanceFromMergingStr: 1.89,
    lockRequestDistanceFromMergingStr: 5.1,
    lockWaitDistanceFromMergingCurve: 1.89,
    lockRequestDistanceFromMergingCurve: 5.1,
    lockGrantStrategy: 'FIFO',
    lockDeadlockZoneStrategy: DeadlockZoneStrategy.BRANCH_FIFO,
    targetFps: 60,
    maxDelta: 0.1,
  };
}

// ============================================================================
// [2] INIT PAYLOAD (Main -> Worker)
// ============================================================================

/**
 * Fab offset 정보 (멀티 Fab 모드용)
 */
export interface FabOffsetInfo {
  fabIndex: number;
  col: number;
  row: number;
}

/**
 * 공유 맵 데이터 (멀티 Fab 모드에서 원본 데이터를 한 번만 전송)
 */
export interface SharedMapData {
  /** 원본 edges (fab 복제 전) */
  originalEdges: Edge[];
  /** 원본 nodes (fab 복제 전) */
  originalNodes: Node[];
  /** 원본 stations (fab 복제 전) */
  originalStations: StationRawData[];
  /** Grid 가로 개수 */
  gridX: number;
  /** Grid 세로 개수 */
  gridY: number;
}

// 단일 Fab 초기화 데이터
export interface FabInitData {
  /** Unique identifier for the fab (e.g., "fab_A", "fab_B") */
  fabId: string;
  sharedBuffer: SharedArrayBuffer;
  sensorPointBuffer: SharedArrayBuffer;
  pathBuffer: SharedArrayBuffer;

  /**
   * Fab별 edges (단일 Fab 모드에서 사용)
   * 멀티 Fab 모드에서는 sharedMapData + fabOffset 사용
   */
  edges?: Edge[];
  /**
   * Fab별 nodes (단일 Fab 모드에서 사용)
   * 멀티 Fab 모드에서는 sharedMapData + fabOffset 사용
   */
  nodes?: Node[];
  /**
   * Fab별 station data (단일 Fab 모드에서 사용)
   * 멀티 Fab 모드에서는 sharedMapData + fabOffset 사용
   */
  stationData?: StationRawData[];

  /**
   * Fab offset 정보 (멀티 Fab 모드에서 사용)
   * sharedMapData와 함께 사용하여 fab별 데이터 계산
   */
  fabOffset?: FabOffsetInfo;

  vehicleConfigs: VehicleInitConfig[];
  numVehicles: number;
  transferMode: TransferMode;

  /**
   * 메모리 영역 할당 정보 (멀티 워커 환경에서 사용)
   * 없으면 전체 버퍼 사용 (하위호환)
   */
  memoryAssignment?: FabMemoryAssignment;

  /**
   * Fab별 SimulationConfig 오버라이드
   * 없으면 전역 설정 사용, 있으면 전역 설정에 병합
   */
  config?: Partial<SimulationConfig>;
}

// 멀티 Fab 지원 Init Payload
export interface InitPayload {
  // 공통 설정
  config: SimulationConfig;
  // 여러 Fab 데이터
  fabs: FabInitData[];
  /**
   * 공유 맵 데이터 (멀티 Fab 모드에서만 사용)
   * 원본 맵 데이터를 한 번만 전송하여 메모리 절약
   */
  sharedMapData?: SharedMapData;
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

/**
 * Fab별 렌더 버퍼 할당 정보 (연속 레이아웃)
 */
export interface FabRenderAssignment {
  fabId: string;
  /** Vehicle 렌더 버퍼 내 시작 offset (bytes) */
  vehicleRenderOffset: number;
  /** Sensor 렌더 버퍼 내 시작 offset (bytes) */
  sensorRenderOffset: number;
  /** 이 fab의 실제 vehicle 수 */
  actualVehicles: number;
}

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
  // 렌더 버퍼 설정 (초기화 후 한 번만)
  | { type: "SET_RENDER_BUFFER"; vehicleRenderBuffer: SharedArrayBuffer; sensorRenderBuffer: SharedArrayBuffer; fabAssignments: FabRenderAssignment[]; totalVehicles: number }
  // Fab 동적 관리
  | { type: "ADD_FAB"; fab: FabInitData; config: SimulationConfig }
  | { type: "REMOVE_FAB"; /** Unique identifier for the fab */ fabId: string }
  // Logger 설정
  | { type: "SET_LOGGER_PORT"; port: MessagePort; workerId: number }
  // Lock 정보 요청
  | { type: "GET_LOCK_TABLE"; fabId: string; requestId: string };

// Worker -> Main Thread Messages
export type MainMessage =
  | { type: "READY" }
  | { type: "INITIALIZED"; /** Fab ID -> actual vehicle count */ fabVehicleCounts: Record<string, number> }
  | { type: "DISPOSED" }
  | { type: "ERROR"; error: string }
  | { type: "STATS"; fps: number; vehicleCount: number }
  | {
      type: "PERF_STATS";
      // Basic stats (backward compatibility)
      avgStepMs: number;
      minStepMs: number;
      maxStepMs: number;
      // Extended stats (GC spike detection)
      variance: number;        // Variance (ms²)
      stdDev: number;          // Standard deviation (ms)
      cv: number;              // Coefficient of variation (stdDev / mean)
      p50: number;             // Median (50th percentile)
      p95: number;             // 95th percentile
      p99: number;             // 99th percentile
      sampleCount: number;     // Number of samples
      // Dijkstra stats
      dijkstra?: {
        count: number;
        avgTimeMs: number;
        minTimeMs: number;
        maxTimeMs: number;
      };
      // Fab vehicle counts
      fabVehicleCounts: Record<string, number>;
    }
  | { type: "FAB_ADDED"; /** Unique identifier for the fab */ fabId: string; actualNumVehicles: number }
  | { type: "FAB_REMOVED"; /** Unique identifier for the fab */ fabId: string }
  | { type: "LOCK_TABLE"; fabId: string; requestId: string; data: LockTableData };

// Lock 테이블 데이터 (직렬화 가능한 형태)
export interface LockNodeData {
  name: string;
  requests: { vehId: number; edgeName: string; requestTime: number }[];
  granted: { edge: string; veh: number }[];
  edgeQueueSizes: Record<string, number>;
}

export interface LockTableData {
  strategy: GrantStrategy;
  nodes: Record<string, LockNodeData>;
}

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
export type { GrantStrategy } from "@/config/simulationConfig";
