// shmSimulator/MemoryLayoutManager.ts
// 멀티 워커 환경에서 SharedArrayBuffer 메모리 레이아웃을 계산하고 관리

import { VEHICLE_DATA_SIZE } from "@/common/vehicle/memory/VehicleDataArrayBase";
import { SENSOR_DATA_SIZE, SENSOR_ZONE_COUNT } from "@/common/vehicle/memory/SensorPointArrayBase";
import type { FabMemoryAssignment, FabRenderAssignment } from "./types";

/**
 * 렌더링용 Vehicle 데이터 크기 (x, y, z, rotation)
 */
export const VEHICLE_RENDER_SIZE = 4;

/**
 * Path buffer 상수
 * Layout: [pathLen, edge0, edge1, ..., edge98, edge99]
 * - pathLen: 경로 길이 (0 = no path)
 * - edge0~edge99: edge indices
 */
export const MAX_PATH_LENGTH = 100;

/**
 * 센서 렌더링용 GPU-friendly 레이아웃 상수
 *
 * 버퍼 레이아웃 (섹션별 연속 - set() 최적화 가능):
 *
 * 전체 버퍼를 7개 섹션으로 분리, 각 섹션은 numVehicles × 4 floats
 *
 * Section 0: zone0_startEnd - [Veh0_FL,FR | Veh1_FL,FR | ...]
 * Section 1: zone0_other    - [Veh0_SL,SR | Veh1_SL,SR | ...]
 * Section 2: zone1_startEnd - [Veh0_FL,FR | Veh1_FL,FR | ...]
 * Section 3: zone1_other    - [Veh0_SL,SR | Veh1_SL,SR | ...]
 * Section 4: zone2_startEnd - [Veh0_FL,FR | Veh1_FL,FR | ...]
 * Section 5: zone2_other    - [Veh0_SL,SR | Veh1_SL,SR | ...]
 * Section 6: body_other     - [Veh0_BL,BR | Veh1_BL,BR | ...]
 *
 * 총: 7 sections × numVehicles × 4 floats = 28 × numVehicles floats
 */
export const SENSOR_ATTR_SIZE = 4; // FL,FR or SL,SR or BL,BR (4 floats: x,y,x,y)
export const SENSOR_SECTION_COUNT = SENSOR_ZONE_COUNT * 2 + 1; // 3 zones × 2 (startEnd + other) + body_other = 7

/**
 * 렌더링용 Sensor 데이터 크기 (per vehicle)
 * 7 sections × 4 floats = 28 floats per vehicle
 */
export const SENSOR_RENDER_SIZE = SENSOR_SECTION_COUNT * SENSOR_ATTR_SIZE; // 28

/**
 * 센서 렌더 버퍼 섹션 인덱스
 */
export const SensorSection = {
  ZONE0_STARTEND: 0,
  ZONE0_OTHER: 1,
  ZONE1_STARTEND: 2,
  ZONE1_OTHER: 3,
  ZONE2_STARTEND: 4,
  ZONE2_OTHER: 5,
  BODY_OTHER: 6,
} as const;

/**
 * 센서 렌더 버퍼 오프셋 계산 (섹션별)
 * @param section - SensorSection 값
 * @param numVehicles - 총 vehicle 수
 * @returns 해당 섹션의 시작 오프셋 (floats 단위)
 */
export function getSensorSectionOffset(section: number, numVehicles: number): number {
  return section * numVehicles * SENSOR_ATTR_SIZE;
}

/**
 * zone별 startEnd/other 섹션 인덱스 계산
 */
export const SensorRenderOffset = {
  /** zone N의 startEnd 섹션 인덱스 */
  zoneStartEndSection: (zoneIndex: number) => zoneIndex * 2,
  /** zone N의 other 섹션 인덱스 */
  zoneOtherSection: (zoneIndex: number) => zoneIndex * 2 + 1,
  /** body other 섹션 인덱스 */
  bodyOtherSection: SensorSection.BODY_OTHER,
} as const;

/**
 * Fab별 메모리 설정
 */
export interface FabMemoryConfig {
  fabId: string;
  maxVehicles: number;
}

/**
 * 전체 메모리 레이아웃 정보 (Worker 영역만)
 */
export interface MemoryLayout {
  /** Vehicle 버퍼 전체 크기 (bytes) - Worker 영역만 */
  vehicleBufferSize: number;
  /** Sensor 버퍼 전체 크기 (bytes) - Worker 영역만 */
  sensorBufferSize: number;
  /** Path 버퍼 전체 크기 (bytes) - Worker 영역만 */
  pathBufferSize: number;
  /** Fab별 메모리 할당 정보 */
  fabAssignments: Map<string, FabMemoryAssignment>;
}

/**
 * 렌더 버퍼 레이아웃 정보 (actualVehicles 기준 연속)
 */
export interface RenderBufferLayout {
  /** Vehicle 렌더 버퍼 크기 (bytes) */
  vehicleRenderBufferSize: number;
  /** Sensor 렌더 버퍼 크기 (bytes) */
  sensorRenderBufferSize: number;
  /** 총 vehicle 수 */
  totalVehicles: number;
  /** Fab별 렌더 할당 정보 (연속 레이아웃) */
  fabRenderAssignments: FabRenderAssignment[];
}

/**
 * 워커별 Fab 분배 정보
 */
export interface WorkerAssignment {
  workerIndex: number;
  fabIds: string[];
  fabAssignments: FabMemoryAssignment[];
}

/**
 * MemoryLayoutManager
 * - Worker 영역 메모리 레이아웃 계산
 * - Fab별 메모리 영역 할당
 * - 워커별 Fab 분배
 * - 렌더 버퍼 (연속 레이아웃) 계산
 */
export class MemoryLayoutManager {
  /**
   * Worker 메모리 레이아웃 계산 (렌더 영역 제외)
   * 버퍼 구조: [ Worker 영역 (모든 fab) ]
   */
  calculateLayout(fabConfigs: FabMemoryConfig[]): MemoryLayout {
    let vehicleOffset = 0;
    let sensorOffset = 0;
    let pathOffset = 0;

    const fabAssignments = new Map<string, FabMemoryAssignment>();

    for (const fab of fabConfigs) {
      const vehicleSize = fab.maxVehicles * VEHICLE_DATA_SIZE * Float32Array.BYTES_PER_ELEMENT;
      const sensorSize = fab.maxVehicles * SENSOR_DATA_SIZE * Float32Array.BYTES_PER_ELEMENT;
      const pathSize = fab.maxVehicles * MAX_PATH_LENGTH * Int32Array.BYTES_PER_ELEMENT;

      const assignment: FabMemoryAssignment = {
        fabId: fab.fabId,
        vehicleRegion: {
          offset: vehicleOffset,
          size: vehicleSize,
          maxVehicles: fab.maxVehicles,
        },
        sensorRegion: {
          offset: sensorOffset,
          size: sensorSize,
          maxVehicles: fab.maxVehicles,
        },
        pathRegion: {
          offset: pathOffset,
          size: pathSize,
          maxVehicles: fab.maxVehicles,
        },
      };

      fabAssignments.set(fab.fabId, assignment);

      vehicleOffset += vehicleSize;
      sensorOffset += sensorSize;
      pathOffset += pathSize;
    }

    return {
      vehicleBufferSize: vehicleOffset,
      sensorBufferSize: sensorOffset,
      pathBufferSize: pathOffset,
      fabAssignments,
    };
  }

  /**
   * 렌더 버퍼 레이아웃 계산 (actualVehicles 기준 연속)
   * Worker 초기화 후 actualVehicles가 결정되면 호출
   */
  calculateRenderLayout(fabVehicleCounts: Map<string, number>): RenderBufferLayout {
    let vehicleRenderOffset = 0;
    let sensorRenderOffset = 0;
    let totalVehicles = 0;

    const fabRenderAssignments: FabRenderAssignment[] = [];

    // fabId 순서대로 (Map 순회 순서 유지)
    for (const [fabId, actualVehicles] of fabVehicleCounts) {
      const vehicleSize = actualVehicles * VEHICLE_RENDER_SIZE * Float32Array.BYTES_PER_ELEMENT;
      const sensorSize = actualVehicles * SENSOR_RENDER_SIZE * Float32Array.BYTES_PER_ELEMENT;

      fabRenderAssignments.push({
        fabId,
        vehicleRenderOffset,
        sensorRenderOffset,
        actualVehicles,
      });

      vehicleRenderOffset += vehicleSize;
      sensorRenderOffset += sensorSize;
      totalVehicles += actualVehicles;
    }

    return {
      vehicleRenderBufferSize: vehicleRenderOffset,
      sensorRenderBufferSize: sensorRenderOffset,
      totalVehicles,
      fabRenderAssignments,
    };
  }

  /**
   * Fab들을 워커 수에 맞게 분배
   */
  distributeToWorkers(
    fabConfigs: FabMemoryConfig[],
    workerCount: number,
    layout: MemoryLayout
  ): WorkerAssignment[] {
    const actualWorkerCount = Math.min(workerCount, fabConfigs.length);
    const assignments: WorkerAssignment[] = [];

    const fabsPerWorker = Math.ceil(fabConfigs.length / actualWorkerCount);

    for (let i = 0; i < actualWorkerCount; i++) {
      const startIdx = i * fabsPerWorker;
      const endIdx = Math.min(startIdx + fabsPerWorker, fabConfigs.length);

      if (startIdx >= fabConfigs.length) continue;

      const assignedFabs = fabConfigs.slice(startIdx, endIdx);
      const fabIds = assignedFabs.map(f => f.fabId);
      const fabAssignments = fabIds
        .map(id => layout.fabAssignments.get(id))
        .filter((a): a is FabMemoryAssignment => a !== undefined);

      assignments.push({
        workerIndex: assignments.length,
        fabIds,
        fabAssignments,
      });
    }

    return assignments;
  }

  /**
   * Worker SharedArrayBuffer 생성
   */
  createWorkerBuffers(layout: MemoryLayout): {
    vehicleBuffer: SharedArrayBuffer;
    sensorBuffer: SharedArrayBuffer;
    pathBuffer: SharedArrayBuffer;
  } {
    return {
      vehicleBuffer: new SharedArrayBuffer(layout.vehicleBufferSize),
      sensorBuffer: new SharedArrayBuffer(layout.sensorBufferSize),
      pathBuffer: new SharedArrayBuffer(layout.pathBufferSize),
    };
  }

  /**
   * Render SharedArrayBuffer 생성 (연속 레이아웃)
   */
  createRenderBuffers(renderLayout: RenderBufferLayout): {
    vehicleRenderBuffer: SharedArrayBuffer;
    sensorRenderBuffer: SharedArrayBuffer;
  } {
    return {
      vehicleRenderBuffer: new SharedArrayBuffer(renderLayout.vehicleRenderBufferSize),
      sensorRenderBuffer: new SharedArrayBuffer(renderLayout.sensorRenderBufferSize),
    };
  }

  /**
   * 레이아웃 정보 출력 (디버그용)
   */
  printLayoutInfo(_layout: MemoryLayout): void {
    // Rule A.1 & A.2: Remove useless assignments and empty blocks
  }

  /**
   * 렌더 레이아웃 정보 출력 (디버그용)
   */
  printRenderLayoutInfo(_renderLayout: RenderBufferLayout): void {
    // Rule A.1 & A.2: Remove useless assignments and empty blocks
  }

  /**
   * 워커 분배 정보 출력 (디버그용)
   */
  printWorkerAssignments(_assignments: WorkerAssignment[]): void {
    // Rule A.1 & A.2: Remove useless assignments and empty blocks
  }
}
