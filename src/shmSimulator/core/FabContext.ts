// shmSimulator/core/FabContext.ts
// Fab 단위로 모든 매니저와 메모리를 묶어서 관리하는 클래스

import { VehicleDataArrayBase, MovementData, VEHICLE_DATA_SIZE } from "@/common/vehicle/memory/VehicleDataArrayBase";
import { SensorPointArrayBase, SENSOR_DATA_SIZE, SENSOR_POINT_SIZE, SensorPoint } from "@/common/vehicle/memory/SensorPointArrayBase";
import { EdgeVehicleQueue } from "@/common/vehicle/memory/EdgeVehicleQueue";
import { LockMgr } from "@/common/vehicle/logic/LockMgr";
import { TransferMgr, VehicleLoop } from "@/common/vehicle/logic/TransferMgr";
import { AutoMgr } from "@/common/vehicle/logic/AutoMgr";
import { DispatchMgr } from "@/shmSimulator/managers/DispatchMgr";
import { RoutingMgr } from "@/shmSimulator/managers/RoutingMgr";
import { EngineStore } from "./EngineStore";
import { initializeVehicles, InitializationResult } from "./initializeVehicles";
import { checkCollisions, CollisionCheckContext } from "@/common/vehicle/collision/collisionCheck";
import { updateMovement, MovementUpdateContext } from "@/common/vehicle/movement/movementUpdate";
import { EdgeTransitTracker, devLog } from "@/logger";
import {
  VEHICLE_RENDER_SIZE,
  SENSOR_ATTR_SIZE,
  SensorSection,
} from "../MemoryLayoutManager";
import type { Edge } from "@/types/edge";
import type { Node } from "@/types";
import type { SimulationConfig, TransferMode, VehicleInitConfig, FabMemoryAssignment, SharedMapRef, FabRenderOffset, UnusualMoveData } from "../types";
import type { StationRawData } from "@/types/station";

export interface FabInitParams {
  fabId: string;
  sharedBuffer: SharedArrayBuffer;
  sensorPointBuffer: SharedArrayBuffer;
  pathBuffer: SharedArrayBuffer;
  edges?: Edge[];
  nodes?: Node[];
  stationData?: StationRawData[];
  sharedMapRef?: SharedMapRef;
  fabOffset?: FabRenderOffset;
  config: SimulationConfig;
  vehicleConfigs: VehicleInitConfig[];
  numVehicles: number;
  transferMode: TransferMode;
  memoryAssignment?: FabMemoryAssignment;
}

export class FabContext {
  public readonly fabId: string;

  // === Internal Store ===
  private readonly store: EngineStore;

  // === Memory (Worker 계산용) ===
  private readonly vehicleDataArray: VehicleDataArrayBase;
  private readonly sensorPointArray: SensorPointArrayBase;
  private readonly edgeVehicleQueue: EdgeVehicleQueue;

  // === Render Data (별도 버퍼, 연속 레이아웃) ===
  private vehicleRenderData: Float32Array | null = null;
  private sensorRenderData: Float32Array | null = null;
  private totalVehicles: number = 0;
  private vehicleStartIndex: number = 0;

  // === Cached Sensor Section Offsets (매 프레임 재계산 방지) ===
  private sectionOffsets: {
    sectionSize: number;
    fabOffsetValue: number;
    zone0StartEndBase: number;
    zone0OtherBase: number;
    zone1StartEndBase: number;
    zone1OtherBase: number;
    zone2StartEndBase: number;
    zone2OtherBase: number;
    bodyOtherBase: number;
  } | null = null;

  // === Map Data ===
  private edges: Edge[] = [];
  private nodes: Node[] = [];
  private edgeNameToIndex: Map<string, number> = new Map();
  private readonly nodeNameToIndex: Map<string, number> = new Map();

  // === Fab Render Offset ===
  private fabOffset: FabRenderOffset = { x: 0, y: 0 };

  // === Logic Managers ===
  private readonly lockMgr: LockMgr;
  private readonly transferMgr: TransferMgr;
  private readonly dispatchMgr: DispatchMgr;
  public readonly routingMgr: RoutingMgr;
  private readonly autoMgr: AutoMgr;

  // === Runtime ===
  private readonly vehicleLoopMap: Map<number, VehicleLoop> = new Map();
  private readonly config: SimulationConfig;
  private actualNumVehicles: number = 0;

  // === Edge Transit Logging ===
  private edgeTransitTracker: EdgeTransitTracker | null = null;

  // === Collision & Curve Brake Check Timers ===
  private readonly collisionCheckTimers: Map<number, number> = new Map();
  private readonly curveBrakeCheckTimers: Map<number, number> = new Map();

  constructor(params: FabInitParams) {
    this.fabId = params.fabId;
    this.config = params.config;

    const edgeCount = params.sharedMapRef?.edges.length ?? params.edges?.length ?? 0;
    const maxEdges = Math.max(edgeCount * 2, 1000);
    this.store = new EngineStore(this.config.maxVehicles, maxEdges, true);
    this.vehicleDataArray = this.store.getVehicleDataArray();
    this.sensorPointArray = new SensorPointArrayBase(this.config.maxVehicles, true);
    this.edgeVehicleQueue = this.store.getEdgeVehicleQueue();

    this.lockMgr = new LockMgr();
    this.transferMgr = new TransferMgr();
    this.dispatchMgr = new DispatchMgr(this.transferMgr);
    this.routingMgr = new RoutingMgr(this.dispatchMgr);
    this.autoMgr = new AutoMgr();

    this.init(params);
  }

  private init(params: FabInitParams): void {

    // Worker 버퍼 설정 (계산용)
    if (params.memoryAssignment) {
      const { vehicleRegion, sensorRegion, pathRegion } = params.memoryAssignment;
      this.store.setSharedBufferWithRegion(params.sharedBuffer, vehicleRegion);
      this.sensorPointArray.setBufferWithRegion(params.sensorPointBuffer, sensorRegion);

      // Path buffer 설정
      const pathBufferView = new Int32Array(
        params.pathBuffer,
        pathRegion.offset,
        pathRegion.size / Int32Array.BYTES_PER_ELEMENT
      );
      this.transferMgr.setPathBufferFromAutoMgr(pathBufferView);

    } else {
      this.store.setSharedBuffer(params.sharedBuffer);
      this.sensorPointArray.setBuffer(params.sensorPointBuffer);

      // Path buffer 설정 (전체 버퍼)
      const pathBufferView = new Int32Array(params.pathBuffer);
      this.transferMgr.setPathBufferFromAutoMgr(pathBufferView);

    }

    this.store.setTransferMode(params.transferMode);

    // 맵 데이터 설정
    if (params.sharedMapRef) {
      this.edges = params.sharedMapRef.edges;
      this.nodes = params.sharedMapRef.nodes;
      this.edgeNameToIndex = params.sharedMapRef.edgeNameToIndex;
      for (const [name, idx] of params.sharedMapRef.nodeNameToIndex) {
        this.nodeNameToIndex.set(name, idx);
      }
      this.fabOffset = params.fabOffset ?? { x: 0, y: 0 };
    } else {
      this.edges = params.edges ?? [];
      this.nodes = params.nodes ?? [];
      // NOTE: Index starts from 1 (1-based). 0 is reserved as invalid/sentinel value.
      this.edgeNameToIndex.clear();
      for (let idx = 0; idx < this.edges.length; idx++) {
        this.edgeNameToIndex.set(this.edges[idx].edge_name, idx + 1); // 1-based
      }
      this.nodeNameToIndex.clear();
      for (let idx = 0; idx < this.nodes.length; idx++) {
        this.nodeNameToIndex.set(this.nodes[idx].node_name, idx + 1); // 1-based
      }
    }


    // lockMgr 초기화는 initializeVehicles 후에 수행 (vehicleDataArray 필요)

    // Fab별 config 적용 로그
    devLog.info(`[FabContext:${this.fabId}] Lock policy: grantStrategy=${this.config.lockGrantStrategy}`);

    const result: InitializationResult = initializeVehicles({
      edges: this.edges,
      nodes: this.nodes,
      numVehicles: params.numVehicles,
      vehicleConfigs: params.vehicleConfigs,
      store: this.store,
      lockMgr: this.lockMgr,
      sensorPointArray: this.sensorPointArray,
      config: this.config,
      transferMode: params.transferMode,
    });

    this.edgeNameToIndex = result.edgeNameToIndex;
    this.actualNumVehicles = result.actualNumVehicles;

    this.dispatchMgr.setVehicleDataArray(this.vehicleDataArray);
    this.dispatchMgr.setEdgeData(this.edges, this.edgeNameToIndex);
    this.dispatchMgr.setLockMgr(this.lockMgr);

    // LockMgr 초기화 (vehicleDataArray, nodes, edges 참조 저장)
    this.lockMgr.init(this.vehicleDataArray.getData(), this.nodes, this.edges);

    this.buildVehicleLoopMap();

    const stationData = params.sharedMapRef?.stations ?? params.stationData;
    if (stationData) {
      this.autoMgr.initStations(stationData, this.edgeNameToIndex);
    }

    // 렌더 버퍼는 나중에 SET_RENDER_BUFFER로 설정됨
  }

  /**
   * Set render buffer (연속 레이아웃)
   * Main Thread에서 SET_RENDER_BUFFER 메시지로 호출됨
   *
   * @param vehicleRenderBuffer - 전체 vehicle 렌더 버퍼
   * @param sensorRenderBuffer - 전체 sensor 렌더 버퍼
   * @param vehicleRenderOffset - vehicle 버퍼 내 이 Fab의 시작 오프셋 (bytes)
   * @param actualVehicles - 이 Fab의 vehicle 수
   * @param totalVehicles - 전체 vehicle 수 (모든 Fab 합산)
   * @param vehicleStartIndex - 전체에서 이 Fab의 첫 vehicle 인덱스
   */
  setRenderBuffer(
    vehicleRenderBuffer: SharedArrayBuffer,
    sensorRenderBuffer: SharedArrayBuffer,
    vehicleRenderOffset: number,
    actualVehicles: number,
    totalVehicles: number,
    vehicleStartIndex: number
  ): void {
    const vehicleRenderLength = actualVehicles * VEHICLE_RENDER_SIZE;

    this.vehicleRenderData = new Float32Array(vehicleRenderBuffer, vehicleRenderOffset, vehicleRenderLength);
    // 센서 버퍼는 전체를 참조 (섹션별 연속 레이아웃이므로)
    this.sensorRenderData = new Float32Array(sensorRenderBuffer);
    this.totalVehicles = totalVehicles;
    this.vehicleStartIndex = vehicleStartIndex;

    // 센서 섹션 오프셋 사전 계산 (매 프레임 재계산 방지)
    this.calculateSectionOffsets();


    // 초기 데이터를 렌더 버퍼에 복사
    this.writeToRenderRegion();
  }

  /**
   * 센서 섹션 오프셋 사전 계산 (매 프레임 재계산 방지)
   * setRenderBuffer()에서 한 번만 호출됨
   */
  private calculateSectionOffsets(): void {
    const sectionSize = this.totalVehicles * SENSOR_ATTR_SIZE;
    const fabOffsetValue = this.vehicleStartIndex * SENSOR_ATTR_SIZE;

    this.sectionOffsets = {
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

  private buildVehicleLoopMap(): void {
    this.vehicleLoopMap.clear();

    for (let i = 0; i < this.actualNumVehicles; i++) {
      const currentEdgeIndex = this.store.getVehicleCurrentEdge(i);
      if (currentEdgeIndex < 1) continue; // 1-based: 0 is invalid
      const currentEdge = this.edges[currentEdgeIndex - 1]; // Convert to 0-based for array access
      if (!currentEdge) continue;

      const sequence: string[] = [currentEdge.edge_name];
      let edge = currentEdge;

      for (let j = 0; j < 100; j++) {
        if (!edge.nextEdgeIndices?.length) break;
        const nextIdx = edge.nextEdgeIndices[0];
        if (nextIdx < 1) break; // 1-based: 0 is invalid

        const nextEdge = this.edges[nextIdx - 1]; // Convert to 0-based for array access
        if (!nextEdge || nextEdge.edge_name === currentEdge.edge_name) break;

        sequence.push(nextEdge.edge_name);
        edge = nextEdge;
      }

      this.vehicleLoopMap.set(i, { edgeSequence: sequence });
    }
  }

  handleCommand(command: unknown): void {
    this.routingMgr.receiveMessage(command);
  }

  /**
   * Logger Worker와 연결된 MessagePort 설정
   * 이후 edge transit 로그가 자동으로 전송됨
   */
  setLoggerPort(port: MessagePort, workerId: number = 0): void {
    // config에서 edgeTransitLogEnabled가 false면 로거 생성 안 함
    if (this.config.edgeTransitLogEnabled === false) {
      return;
    }
    // fabId에서 숫자 추출 시도 (예: "fab_0" -> 0)
    let fabIdNum = 0;
    const match = /\d+/.exec(this.fabId);
    if (match) {
      fabIdNum = Number.parseInt(match[0], 10) % 256;
    }

    this.edgeTransitTracker = new EdgeTransitTracker({
      workerId: workerId % 256,
      fabId: fabIdNum,
    });
    this.edgeTransitTracker.setLoggerPort(port);

    // 초기 진입 시간 기록 (모든 차량이 현재 edge에 이미 있음)
    // 초기화 시점의 시뮬레이션 시간은 0
    for (let i = 0; i < this.actualNumVehicles; i++) {
      const edgeIndex = this.store.getVehicleCurrentEdge(i);
      this.edgeTransitTracker.onEdgeEnter(i, edgeIndex, 0);
    }
  }

  step(clampedDelta: number, simulationTime: number = 0): void {
    // 1. Collision Check (충돌 감지 → 멈출지 결정)
    const collisionCtx: CollisionCheckContext = {
      vehicleArrayData: this.vehicleDataArray.getData(),
      edgeArray: this.edges,
      edgeVehicleQueue: this.edgeVehicleQueue,
      sensorPointArray: this.sensorPointArray,
      config: this.config,
      delta: clampedDelta,
      collisionCheckTimers: this.collisionCheckTimers,
    };
    checkCollisions(collisionCtx);

    // 2. Lock 처리 (합류점에서 멈출지 결정)
    this.lockMgr.updateAll(this.actualNumVehicles, 'FIFO');

    // 3. Movement Update (1,2에서 멈추지 않은 차량만 이동)
    const tracker = this.edgeTransitTracker;
    const edges = this.edges;
    const fabId = this.fabId;

    const movementCtx: MovementUpdateContext = {
      vehicleDataArray: this.vehicleDataArray,
      sensorPointArray: this.sensorPointArray,
      edgeArray: edges,
      actualNumVehicles: this.actualNumVehicles,
      vehicleLoopMap: this.vehicleLoopMap,
      edgeNameToIndex: this.edgeNameToIndex,
      store: {
        moveVehicleToEdge: this.store.moveVehicleToEdge.bind(this.store),
        transferMode: this.store.transferMode,
      },
      lockMgr: this.lockMgr,
      transferMgr: this.transferMgr,
      clampedDelta,
      config: this.config,
      simulationTime,
      onEdgeTransit: tracker
        ? (vehId, fromEdgeIndex, toEdgeIndex, timestamp) => {
            // 이전 edge 통과 로그 (fromEdgeIndex is 1-based)
            const fromEdge = fromEdgeIndex >= 1 ? edges[fromEdgeIndex - 1] : undefined;
            if (fromEdge) {
              tracker.onEdgeExit(vehId, fromEdgeIndex, timestamp, fromEdge);
            }
            // 새 edge 진입 기록
            tracker.onEdgeEnter(vehId, toEdgeIndex, timestamp);
          }
        : undefined,
      onUnusualMove: (event) => {
        // Worker에서 Main Thread로 UnusualMove 이벤트 전송
        const data: UnusualMoveData = {
          vehicleIndex: event.vehicleIndex,
          fabId,
          prevEdge: {
            name: event.prevEdgeName,
            toNode: event.prevEdgeToNode,
          },
          nextEdge: {
            name: event.nextEdgeName,
            fromNode: event.nextEdgeFromNode,
          },
          position: { x: event.posX, y: event.posY },
          timestamp: simulationTime,
        };
        globalThis.postMessage({ type: "UNUSUAL_MOVE", data });
      },
      curveBrakeCheckTimers: this.curveBrakeCheckTimers,
    };
    updateMovement(movementCtx);

    // 4. Auto Routing (edge 전환 후 새 경로 필요한 차량 처리)
    this.autoMgr.update(
      this.store.transferMode,
      this.actualNumVehicles,
      this.vehicleDataArray,
      this.edges,
      this.edgeNameToIndex,
      this.transferMgr,
      this.lockMgr
    );

    // 5. Write to Render Buffer (렌더링 데이터)
    this.writeToRenderRegion();
  }

  /**
   * Write vehicle and sensor data to render buffer with fab offset applied
   *
   * 센서 렌더 버퍼 레이아웃 (섹션별 연속 - set() 최적화 가능):
   *
   * Section 0: zone0_startEnd - [Veh0_FL,FR | Veh1_FL,FR | ... | VehN_FL,FR]
   * Section 1: zone0_other    - [Veh0_SL,SR | Veh1_SL,SR | ... | VehN_SL,SR]
   * Section 2: zone1_startEnd - [...]
   * Section 3: zone1_other    - [...]
   * Section 4: zone2_startEnd - [...]
   * Section 5: zone2_other    - [...]
   * Section 6: body_other     - [Veh0_BL,BR | Veh1_BL,BR | ... | VehN_BL,BR]
   *
   * 총: 7 sections × totalVehicles × 4 floats
   *
   * 멀티 Fab 환경에서 각 Fab은 전체 버퍼에서 자기 vehicle 위치에 복사
   */
  private writeToRenderRegion(): void {
    if (!this.vehicleRenderData || !this.sensorRenderData) {
      return;
    }

    const offsetX = this.fabOffset.x;
    const offsetY = this.fabOffset.y;
    const numVeh = this.actualNumVehicles;

    // === Vehicle Render Data ===
    const workerVehicleData = this.vehicleDataArray.getData();
    for (let i = 0; i < numVeh; i++) {
      const workerPtr = i * VEHICLE_DATA_SIZE;
      const renderPtr = i * VEHICLE_RENDER_SIZE;

      this.vehicleRenderData[renderPtr + 0] = workerVehicleData[workerPtr + MovementData.X] + offsetX;
      this.vehicleRenderData[renderPtr + 1] = workerVehicleData[workerPtr + MovementData.Y] + offsetY;
      this.vehicleRenderData[renderPtr + 2] = workerVehicleData[workerPtr + MovementData.Z];
      this.vehicleRenderData[renderPtr + 3] = workerVehicleData[workerPtr + MovementData.ROTATION];
    }

    // === Sensor Render Data (섹션별 연속 레이아웃) ===
    const workerSensorData = this.sensorPointArray.getData();

    // 사전 계산된 섹션 오프셋 사용 (매 프레임 재계산 방지)
    if (!this.sectionOffsets) return; // Early exit if not initialized
    const {
      zone0StartEndBase,
      zone0OtherBase,
      zone1StartEndBase,
      zone1OtherBase,
      zone2StartEndBase,
      zone2OtherBase,
      bodyOtherBase,
    } = this.sectionOffsets;

    for (let i = 0; i < numVeh; i++) {
      const vehPtr = i * SENSOR_ATTR_SIZE; // 4 floats per vehicle in each section

      // Zone 0
      const zone0Src = i * SENSOR_DATA_SIZE + 0 * SENSOR_POINT_SIZE;
      // startEnd: FL, FR
      this.sensorRenderData[zone0StartEndBase + vehPtr + 0] = workerSensorData[zone0Src + SensorPoint.FL_X] + offsetX;
      this.sensorRenderData[zone0StartEndBase + vehPtr + 1] = workerSensorData[zone0Src + SensorPoint.FL_Y] + offsetY;
      this.sensorRenderData[zone0StartEndBase + vehPtr + 2] = workerSensorData[zone0Src + SensorPoint.FR_X] + offsetX;
      this.sensorRenderData[zone0StartEndBase + vehPtr + 3] = workerSensorData[zone0Src + SensorPoint.FR_Y] + offsetY;
      // other: SL, SR
      this.sensorRenderData[zone0OtherBase + vehPtr + 0] = workerSensorData[zone0Src + SensorPoint.SL_X] + offsetX;
      this.sensorRenderData[zone0OtherBase + vehPtr + 1] = workerSensorData[zone0Src + SensorPoint.SL_Y] + offsetY;
      this.sensorRenderData[zone0OtherBase + vehPtr + 2] = workerSensorData[zone0Src + SensorPoint.SR_X] + offsetX;
      this.sensorRenderData[zone0OtherBase + vehPtr + 3] = workerSensorData[zone0Src + SensorPoint.SR_Y] + offsetY;

      // Zone 1
      const zone1Src = i * SENSOR_DATA_SIZE + 1 * SENSOR_POINT_SIZE;
      this.sensorRenderData[zone1StartEndBase + vehPtr + 0] = workerSensorData[zone1Src + SensorPoint.FL_X] + offsetX;
      this.sensorRenderData[zone1StartEndBase + vehPtr + 1] = workerSensorData[zone1Src + SensorPoint.FL_Y] + offsetY;
      this.sensorRenderData[zone1StartEndBase + vehPtr + 2] = workerSensorData[zone1Src + SensorPoint.FR_X] + offsetX;
      this.sensorRenderData[zone1StartEndBase + vehPtr + 3] = workerSensorData[zone1Src + SensorPoint.FR_Y] + offsetY;
      this.sensorRenderData[zone1OtherBase + vehPtr + 0] = workerSensorData[zone1Src + SensorPoint.SL_X] + offsetX;
      this.sensorRenderData[zone1OtherBase + vehPtr + 1] = workerSensorData[zone1Src + SensorPoint.SL_Y] + offsetY;
      this.sensorRenderData[zone1OtherBase + vehPtr + 2] = workerSensorData[zone1Src + SensorPoint.SR_X] + offsetX;
      this.sensorRenderData[zone1OtherBase + vehPtr + 3] = workerSensorData[zone1Src + SensorPoint.SR_Y] + offsetY;

      // Zone 2
      const zone2Src = i * SENSOR_DATA_SIZE + 2 * SENSOR_POINT_SIZE;
      this.sensorRenderData[zone2StartEndBase + vehPtr + 0] = workerSensorData[zone2Src + SensorPoint.FL_X] + offsetX;
      this.sensorRenderData[zone2StartEndBase + vehPtr + 1] = workerSensorData[zone2Src + SensorPoint.FL_Y] + offsetY;
      this.sensorRenderData[zone2StartEndBase + vehPtr + 2] = workerSensorData[zone2Src + SensorPoint.FR_X] + offsetX;
      this.sensorRenderData[zone2StartEndBase + vehPtr + 3] = workerSensorData[zone2Src + SensorPoint.FR_Y] + offsetY;
      this.sensorRenderData[zone2OtherBase + vehPtr + 0] = workerSensorData[zone2Src + SensorPoint.SL_X] + offsetX;
      this.sensorRenderData[zone2OtherBase + vehPtr + 1] = workerSensorData[zone2Src + SensorPoint.SL_Y] + offsetY;
      this.sensorRenderData[zone2OtherBase + vehPtr + 2] = workerSensorData[zone2Src + SensorPoint.SR_X] + offsetX;
      this.sensorRenderData[zone2OtherBase + vehPtr + 3] = workerSensorData[zone2Src + SensorPoint.SR_Y] + offsetY;

      // Body other: BL, BR from zone0
      this.sensorRenderData[bodyOtherBase + vehPtr + 0] = workerSensorData[zone0Src + SensorPoint.BL_X] + offsetX;
      this.sensorRenderData[bodyOtherBase + vehPtr + 1] = workerSensorData[zone0Src + SensorPoint.BL_Y] + offsetY;
      this.sensorRenderData[bodyOtherBase + vehPtr + 2] = workerSensorData[zone0Src + SensorPoint.BR_X] + offsetX;
      this.sensorRenderData[bodyOtherBase + vehPtr + 3] = workerSensorData[zone0Src + SensorPoint.BR_Y] + offsetY;
    }
  }

  dispose(): void {
    // Edge transit tracker 정리
    if (this.edgeTransitTracker) {
      this.edgeTransitTracker.dispose();
      this.edgeTransitTracker = null;
    }

    this.store.dispose();
    this.sensorPointArray.dispose();

    this.vehicleRenderData = null;
    this.sensorRenderData = null;

    this.lockMgr.reset();
    this.transferMgr.clearQueue();
    this.dispatchMgr.dispose();
    this.autoMgr.dispose();

    this.edges = [];
    this.nodes = [];
    this.edgeNameToIndex.clear();
    this.nodeNameToIndex.clear();
    this.vehicleLoopMap.clear();

    this.fabOffset = { x: 0, y: 0 };
    this.actualNumVehicles = 0;

  }

  getActualNumVehicles(): number {
    return this.actualNumVehicles;
  }

  getVehicleData(): Float32Array {
    return this.vehicleDataArray.getData();
  }

  getLockTableData(): import("../types").LockTableData {
    // TODO: 새 락 시스템 구현 후 업데이트
    return {
      strategy: this.lockMgr.getGrantStrategy(),
      nodes: {},
    };
  }
}
