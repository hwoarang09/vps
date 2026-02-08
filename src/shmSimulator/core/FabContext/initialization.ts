// FabContext/initialization.ts
// Fab 초기화 로직

import type { Edge } from "@/types/edge";
import type { Node } from "@/types/node";
import type { EngineStore } from "../EngineStore";
import { initializeVehicles, InitializationResult } from "../initializeVehicles";
import { devLog } from "@/logger";
import { MAX_CHECKPOINTS_PER_VEHICLE } from "@/common/vehicle/initialize/constants";
import {
  VEHICLE_RENDER_SIZE,
  SENSOR_ATTR_SIZE,
  SensorSection,
} from "../../MemoryLayoutManager";
import type { VehicleDataArrayBase } from "@/common/vehicle/memory/VehicleDataArrayBase";
import type { SensorPointArrayBase } from "@/common/vehicle/memory/SensorPointArrayBase";
import type { LockMgr } from "@/common/vehicle/logic/LockMgr";
import type { TransferMgr } from "@/common/vehicle/logic/TransferMgr";
import type { FabInitParams, SensorSectionOffsets } from "./types";
import type { StationRawData } from "@/types/station";

/**
 * Fab 초기화 (메모리, 맵 데이터, 차량 초기화)
 *
 * 동작:
 * 1. Worker 버퍼 설정 (vehicle, sensor, path, checkpoint)
 * 2. 맵 데이터 설정 (edges, nodes)
 * 3. 차량 초기화 (initializeVehicles)
 * 4. 매니저 초기화 (lockMgr, dispatchMgr, autoMgr)
 */
export function initializeFab(
  params: FabInitParams,
  store: EngineStore,
  sensorPointArray: SensorPointArrayBase,
  vehicleDataArray: VehicleDataArrayBase,
  lockMgr: LockMgr,
  transferMgr: TransferMgr,
  dispatchMgr: { setVehicleDataArray: (v: VehicleDataArrayBase) => void; setEdgeData: (e: Edge[], m: Map<string, number>) => void; setLockMgr: (l: LockMgr) => void },
  autoMgr: { initStations: (s: StationRawData[], m: Map<string, number>) => void },
  edgeNameToIndexMap: Map<string, number>,
  nodeNameToIndexMap: Map<string, number>
): {
  edges: Edge[];
  nodes: Node[];
  edgeNameToIndex: Map<string, number>;
  actualNumVehicles: number;
  checkpointArray: Float32Array | null;
} {
  let checkpointArray: Float32Array | null = null;

  // Worker 버퍼 설정 (계산용)
  if (params.memoryAssignment) {
    const { vehicleRegion, sensorRegion, pathRegion, checkpointRegion } = params.memoryAssignment;
    store.setSharedBufferWithRegion(params.sharedBuffer, vehicleRegion);
    sensorPointArray.setBufferWithRegion(params.sensorPointBuffer, sensorRegion);

    // Path buffer 설정
    const pathBufferView = new Int32Array(
      params.pathBuffer,
      pathRegion.offset,
      pathRegion.size / Int32Array.BYTES_PER_ELEMENT
    );
    transferMgr.setPathBufferFromAutoMgr(pathBufferView);

    // Checkpoint buffer 설정
    checkpointArray = new Float32Array(
      params.checkpointBuffer,
      checkpointRegion.offset,
      checkpointRegion.size / Float32Array.BYTES_PER_ELEMENT
    );
    transferMgr.setCheckpointBuffer(checkpointArray);

    // Checkpoint 배열 초기화 (메타 정보)
    checkpointArray[0] = MAX_CHECKPOINTS_PER_VEHICLE;

  } else {
    store.setSharedBuffer(params.sharedBuffer);
    sensorPointArray.setBuffer(params.sensorPointBuffer);

    // Path buffer 설정 (전체 버퍼)
    const pathBufferView = new Int32Array(params.pathBuffer);
    transferMgr.setPathBufferFromAutoMgr(pathBufferView);

    // Checkpoint buffer 설정 (전체 버퍼)
    checkpointArray = new Float32Array(params.checkpointBuffer);
    transferMgr.setCheckpointBuffer(checkpointArray);

    // Checkpoint 배열 초기화 (메타 정보)
    checkpointArray[0] = MAX_CHECKPOINTS_PER_VEHICLE;
  }

  store.setTransferMode(params.transferMode);

  // 맵 데이터 설정
  let edges: Edge[] = [];
  let nodes: Node[] = [];

  if (params.sharedMapRef) {
    edges = params.sharedMapRef.edges;
    nodes = params.sharedMapRef.nodes;
    // edgeNameToIndex 복사
    for (const [name, idx] of params.sharedMapRef.edgeNameToIndex) {
      edgeNameToIndexMap.set(name, idx);
    }
    // nodeNameToIndex 복사
    for (const [name, idx] of params.sharedMapRef.nodeNameToIndex) {
      nodeNameToIndexMap.set(name, idx);
    }
    // fabOffset은 FabContext 클래스에서 직접 사용
  } else {
    edges = params.edges ?? [];
    nodes = params.nodes ?? [];
    // NOTE: Index starts from 1 (1-based). 0 is reserved as invalid/sentinel value.
    edgeNameToIndexMap.clear();
    for (let idx = 0; idx < edges.length; idx++) {
      edgeNameToIndexMap.set(edges[idx].edge_name, idx + 1); // 1-based
    }
    nodeNameToIndexMap.clear();
    for (let idx = 0; idx < nodes.length; idx++) {
      nodeNameToIndexMap.set(nodes[idx].node_name, idx + 1); // 1-based
    }
  }

  // Fab별 config 적용 로그
  devLog.info(`[FabContext:${params.fabId}] Lock policy: grantStrategy=${params.config.lockGrantStrategy}`);

  // 차량 초기화
  const result: InitializationResult = initializeVehicles({
    edges,
    nodes,
    numVehicles: params.numVehicles,
    vehicleConfigs: params.vehicleConfigs,
    store,
    lockMgr,
    sensorPointArray,
    config: params.config,
    transferMode: params.transferMode,
  });

  const actualNumVehicles = result.actualNumVehicles;

  // 매니저 초기화
  dispatchMgr.setVehicleDataArray(vehicleDataArray);
  dispatchMgr.setEdgeData(edges, result.edgeNameToIndex);
  dispatchMgr.setLockMgr(lockMgr);

  // LockMgr 초기화 (vehicleDataArray, nodes, edges, checkpoint 배열 참조 저장)
  lockMgr.init(
    vehicleDataArray.getData(),
    nodes,
    edges,
    checkpointArray,
    transferMgr.getPathBufferFromAutoMgr()
  );

  // Station 데이터 초기화
  const stationData = params.sharedMapRef?.stations ?? params.stationData;
  if (stationData) {
    autoMgr.initStations(stationData, result.edgeNameToIndex);
  }

  return {
    edges,
    nodes,
    edgeNameToIndex: result.edgeNameToIndex,
    actualNumVehicles,
    checkpointArray,
  };
}

/**
 * Render buffer 설정 (연속 레이아웃)
 * Main Thread에서 SET_RENDER_BUFFER 메시지로 호출됨
 *
 * @param vehicleRenderBuffer - 전체 vehicle 렌더 버퍼
 * @param sensorRenderBuffer - 전체 sensor 렌더 버퍼
 * @param vehicleRenderOffset - vehicle 버퍼 내 이 Fab의 시작 오프셋 (bytes)
 * @param actualVehicles - 이 Fab의 vehicle 수
 * @param totalVehicles - 전체 vehicle 수 (모든 Fab 합산)
 * @param vehicleStartIndex - 전체에서 이 Fab의 첫 vehicle 인덱스
 */
export function setupRenderBuffer(
  vehicleRenderBuffer: SharedArrayBuffer,
  sensorRenderBuffer: SharedArrayBuffer,
  vehicleRenderOffset: number,
  actualVehicles: number,
  totalVehicles: number,
  vehicleStartIndex: number
): {
  vehicleRenderData: Float32Array;
  sensorRenderData: Float32Array;
  sectionOffsets: SensorSectionOffsets;
} {
  const vehicleRenderLength = actualVehicles * VEHICLE_RENDER_SIZE;
  const vehicleRenderData = new Float32Array(vehicleRenderBuffer, vehicleRenderOffset, vehicleRenderLength);
  // 센서 버퍼는 전체를 참조 (섹션별 연속 레이아웃이므로)
  const sensorRenderData = new Float32Array(sensorRenderBuffer);

  // 센서 섹션 오프셋 사전 계산 (매 프레임 재계산 방지)
  const sectionOffsets = calculateSectionOffsets(totalVehicles, vehicleStartIndex);

  return { vehicleRenderData, sensorRenderData, sectionOffsets };
}

/**
 * 센서 섹션 오프셋 사전 계산 (매 프레임 재계산 방지)
 * setupRenderBuffer()에서 한 번만 호출됨
 */
export function calculateSectionOffsets(
  totalVehicles: number,
  vehicleStartIndex: number
): SensorSectionOffsets {
  const sectionSize = totalVehicles * SENSOR_ATTR_SIZE;
  const fabOffsetValue = vehicleStartIndex * SENSOR_ATTR_SIZE;

  return {
    sectionSize,
    fabOffsetValue,
    zone0StartEndBase: SensorSection.ZONE0_STARTEND * sectionSize + fabOffsetValue,
    zone0OtherBase: SensorSection.ZONE0_OTHER * sectionSize + fabOffsetValue,
    zone1StartEndBase: SensorSection.ZONE1_STARTEND * sectionSize + fabOffsetValue,
    zone1OtherBase: SensorSection.ZONE1_OTHER * sectionSize + fabOffsetValue,
    zone2StartEndBase: SensorSection.ZONE2_STARTEND * sectionSize + fabOffsetValue,
    zone2OtherBase: SensorSection.ZONE2_OTHER * sectionSize + fabOffsetValue,
    bodyOtherBase: SensorSection.BODY_OTHER * sectionSize + fabOffsetValue,
  };
}
