// shmSimulator/MemoryLayoutManager.ts
// 멀티 워커 환경에서 SharedArrayBuffer 메모리 레이아웃을 계산하고 관리

import { VEHICLE_DATA_SIZE } from "@/common/vehicle/memory/VehicleDataArrayBase";
import { SENSOR_DATA_SIZE } from "@/common/vehicle/memory/SensorPointArrayBase";
import type { FabMemoryAssignment } from "./types";

/**
 * Fab별 메모리 설정
 */
export interface FabMemoryConfig {
  fabId: string;
  maxVehicles: number;
}

/**
 * 전체 메모리 레이아웃 정보
 */
export interface MemoryLayout {
  /** Vehicle 버퍼 전체 크기 (bytes) */
  vehicleBufferSize: number;
  /** Sensor 버퍼 전체 크기 (bytes) */
  sensorBufferSize: number;
  /** Fab별 메모리 할당 정보 */
  fabAssignments: Map<string, FabMemoryAssignment>;
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
 * - 전체 메모리 레이아웃 계산
 * - Fab별 메모리 영역 할당
 * - 워커별 Fab 분배
 */
export class MemoryLayoutManager {
  /**
   * 전체 메모리 레이아웃 계산
   * 각 Fab에 연속된 메모리 영역을 할당
   */
  calculateLayout(fabConfigs: FabMemoryConfig[]): MemoryLayout {
    let vehicleOffset = 0;
    let sensorOffset = 0;
    const fabAssignments = new Map<string, FabMemoryAssignment>();

    for (const fab of fabConfigs) {
      // Vehicle 데이터 영역 크기 계산 (floats * 4 bytes)
      const vehicleSize = fab.maxVehicles * VEHICLE_DATA_SIZE * Float32Array.BYTES_PER_ELEMENT;
      // Sensor 데이터 영역 크기 계산
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
   * Fab들을 워커 수에 맞게 분배
   * 가능한 균등하게 분배, 빈 워커는 생성하지 않음
   */
  distributeToWorkers(
    fabConfigs: FabMemoryConfig[],
    workerCount: number,
    layout: MemoryLayout
  ): WorkerAssignment[] {
    // 실제 필요한 워커 수 계산 (Fab 수보다 많으면 Fab 수로 제한)
    const actualWorkerCount = Math.min(workerCount, fabConfigs.length);
    const assignments: WorkerAssignment[] = [];

    // 균등 분배 계산
    const fabsPerWorker = Math.ceil(fabConfigs.length / actualWorkerCount);

    for (let i = 0; i < actualWorkerCount; i++) {
      const startIdx = i * fabsPerWorker;
      const endIdx = Math.min(startIdx + fabsPerWorker, fabConfigs.length);

      // 빈 assignment는 건너뜀
      if (startIdx >= fabConfigs.length) continue;

      const assignedFabs = fabConfigs.slice(startIdx, endIdx);
      const fabIds = assignedFabs.map(f => f.fabId);
      const fabAssignments = fabIds
        .map(id => layout.fabAssignments.get(id))
        .filter((a): a is FabMemoryAssignment => a !== undefined);

      assignments.push({
        workerIndex: assignments.length,  // 연속된 인덱스 사용
        fabIds,
        fabAssignments,
      });
    }

    return assignments;
  }

  /**
   * SharedArrayBuffer 생성 (Main Thread에서 호출)
   */
  createBuffers(layout: MemoryLayout): {
    vehicleBuffer: SharedArrayBuffer;
    sensorBuffer: SharedArrayBuffer;
  } {
    return {
      vehicleBuffer: new SharedArrayBuffer(layout.vehicleBufferSize),
      sensorBuffer: new SharedArrayBuffer(layout.sensorBufferSize),
    };
  }

  /**
   * 특정 Fab의 Vehicle 데이터 뷰 생성 (Main Thread 렌더링용)
   */
  createVehicleDataView(
    buffer: SharedArrayBuffer,
    assignment: FabMemoryAssignment
  ): Float32Array {
    const { offset, size } = assignment.vehicleRegion;
    const floatLength = size / Float32Array.BYTES_PER_ELEMENT;
    return new Float32Array(buffer, offset, floatLength);
  }

  /**
   * 특정 Fab의 Sensor 데이터 뷰 생성
   */
  createSensorDataView(
    buffer: SharedArrayBuffer,
    assignment: FabMemoryAssignment
  ): Float32Array {
    const { offset, size } = assignment.sensorRegion;
    const floatLength = size / Float32Array.BYTES_PER_ELEMENT;
    return new Float32Array(buffer, offset, floatLength);
  }

  /**
   * 레이아웃 정보 출력 (디버그용)
   */
  printLayoutInfo(layout: MemoryLayout): void {
    console.log("=== Memory Layout ===");
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
   * 워커 분배 정보 출력 (디버그용)
   */
  printWorkerAssignments(assignments: WorkerAssignment[]): void {
    console.log("=== Worker Assignments ===");
    for (const wa of assignments) {
      console.log(`Worker ${wa.workerIndex}: ${wa.fabIds.join(", ")}`);
    }
  }
}
