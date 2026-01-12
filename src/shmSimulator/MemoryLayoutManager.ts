// shmSimulator/MemoryLayoutManager.ts
// 멀티 워커 환경에서 SharedArrayBuffer 메모리 레이아웃을 계산하고 관리

import { VEHICLE_DATA_SIZE } from "@/common/vehicle/memory/VehicleDataArrayBase";
import { SENSOR_DATA_SIZE } from "@/common/vehicle/memory/SensorPointArrayBase";
import type { FabMemoryAssignment, FabRenderAssignment } from "./types";

/**
 * 렌더링용 Vehicle 데이터 크기 (x, y, z, rotation)
 */
export const VEHICLE_RENDER_SIZE = 4;

/**
 * 렌더링용 Sensor 데이터 크기 (전체 센서 포인트 - x,y에 offset 적용)
 */
export const SENSOR_RENDER_SIZE = SENSOR_DATA_SIZE;

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

    const fabAssignments = new Map<string, FabMemoryAssignment>();

    for (const fab of fabConfigs) {
      const vehicleSize = fab.maxVehicles * VEHICLE_DATA_SIZE * Float32Array.BYTES_PER_ELEMENT;
      const sensorSize = fab.maxVehicles * SENSOR_DATA_SIZE * Float32Array.BYTES_PER_ELEMENT;

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
      };

      fabAssignments.set(fab.fabId, assignment);

      vehicleOffset += vehicleSize;
      sensorOffset += sensorSize;
    }

    return {
      vehicleBufferSize: vehicleOffset,
      sensorBufferSize: sensorOffset,
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
  } {
    return {
      vehicleBuffer: new SharedArrayBuffer(layout.vehicleBufferSize),
      sensorBuffer: new SharedArrayBuffer(layout.sensorBufferSize),
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
  printLayoutInfo(layout: MemoryLayout): void {
    console.log("=== Worker Memory Layout ===");
    console.log(`Vehicle Buffer: ${(layout.vehicleBufferSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Sensor Buffer: ${(layout.sensorBufferSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Total: ${((layout.vehicleBufferSize + layout.sensorBufferSize) / 1024 / 1024).toFixed(2)} MB`);
    console.log("");

    for (const [fabId, assignment] of layout.fabAssignments) {
      console.log(`[${fabId}]`);
      console.log(`  Vehicle: offset=${assignment.vehicleRegion.offset}, size=${assignment.vehicleRegion.size}, maxVeh=${assignment.vehicleRegion.maxVehicles}`);
      console.log(`  Sensor:  offset=${assignment.sensorRegion.offset}, size=${assignment.sensorRegion.size}`);
    }
  }

  /**
   * 렌더 레이아웃 정보 출력 (디버그용)
   */
  printRenderLayoutInfo(renderLayout: RenderBufferLayout): void {
    console.log("=== Render Buffer Layout (Continuous) ===");
    console.log(`Vehicle Render: ${(renderLayout.vehicleRenderBufferSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Sensor Render: ${(renderLayout.sensorRenderBufferSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Total Vehicles: ${renderLayout.totalVehicles}`);
    console.log("");

    for (const fab of renderLayout.fabRenderAssignments) {
      console.log(`[${fab.fabId}] actualVeh=${fab.actualVehicles}, vehOffset=${fab.vehicleRenderOffset}, sensorOffset=${fab.sensorRenderOffset}`);
    }
  }

  /**
   * 워커 분배 정보 출력 (디버그용)
   */
  printWorkerAssignments(assignments: WorkerAssignment[]): void {
    console.log("=== Worker Assignments ===");
    for (const wa of assignments) {
      console.log(`Worker ${wa.workerIndex}: ${wa.fabIds.join(", ")}`);
    }
  }
}
