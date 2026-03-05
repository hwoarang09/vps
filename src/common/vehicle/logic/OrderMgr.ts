// common/vehicle/logic/OrderMgr.ts
import {
  VEHICLE_DATA_SIZE,
  MovementData,
  MovingStatus,
  TransferMode,
  LogicData,
  JobState,
  OrderData,
} from "@/common/vehicle/initialize/constants";
import { TransferMgr, VehicleCommand, IVehicleDataArray } from "./TransferMgr";
import { findShortestPath } from "./Dijkstra";
import { Edge } from "@/types/edge";
import { StationRawData } from "@/types/station";
import { LockMgr } from "./LockMgr";

interface StationTarget {
  name: string;
  edgeIndex: number;
}

// Maximum number of path findings per frame to prevent spikes
const MAX_PATH_FINDS_PER_FRAME = 10;

/** applyPathToVehicle Context */
interface ApplyPathContext {
  vehId: number;
  pathIndices: number[];
  candidate: { name: string; edgeIndex: number };
  vehicleDataArray: IVehicleDataArray;
  edgeArray: Edge[];
  edgeNameToIndex: Map<string, number>;
  transferMgr: TransferMgr;
  lockMgr?: LockMgr;
}

/**
 * Path 발견 이벤트 콜백
 */
export type OnPathFoundCallback = (
  vehId: number,
  destEdge: number,
  pathLen: number
) => void;

/**
 * Order 완료 콜백
 */
export type OnOrderCompleteCallback = (
  vehId: number,
  orderId: number,
  simulationTime: number
) => void;

/**
 * 반송 명령 (pickup → dropoff)
 */
export interface TransportOrder {
  orderId: number;
  pickupEdgeIndex: number;     // 1-based
  pickupStationName: string;
  dropoffEdgeIndex: number;    // 1-based
  dropoffStationName: string;
  loadDurationSec: number;     // default 3
  unloadDurationSec: number;   // default 3
}

/**
 * 차량별 order 진행 상태
 */
interface VehicleOrderState {
  order: TransportOrder;
  timerStartTime: number;      // simulationTime when LOADING/UNLOADING started
  pendingOrder: boolean;       // CYCLE→MOVE_TO_LOAD 전환 대기중
}

export class OrderMgr {
  private stations: StationTarget[] = [];
  private readonly vehicleDestinations: Map<number, { stationName: string, edgeIndex: number }> = new Map();
  private nextVehicleIndex = 0;
  private pathFindCountThisFrame = 0;
  onPathFound?: OnPathFoundCallback;

  // === Order 관련 필드 ===
  private readonly activeOrders: Map<number, VehicleOrderState> = new Map();
  private orderModeEnabled = false;
  onOrderComplete?: OnOrderCompleteCallback;

  initStations(stationData: StationRawData[], edgeNameToIndex: Map<string, number>) {
    this.stations = [];

    for (const station of stationData) {
      if (station.nearest_edge) {
        const edgeIdx = edgeNameToIndex.get(station.nearest_edge);
        if (edgeIdx !== undefined) {
          this.stations.push({
            name: station.station_name,
            edgeIndex: edgeIdx
          });
        }
      }
    }
  }

  setOrderModeEnabled(enabled: boolean): void {
    this.orderModeEnabled = enabled;
  }

  getOrderModeEnabled(): boolean {
    return this.orderModeEnabled;
  }

  /**
   * Main update loop - 상태 머신 기반
   */
  update(
    mode: TransferMode,
    numVehicles: number,
    vehicleDataArray: IVehicleDataArray,
    edgeArray: Edge[],
    edgeNameToIndex: Map<string, number>,
    transferMgr: TransferMgr,
    simulationTime: number,
    lockMgr?: LockMgr
  ) {
    if (mode !== TransferMode.AUTO_ROUTE) return;
    if (numVehicles === 0) return;

    this.pathFindCountThisFrame = 0;
    const startIndex = this.nextVehicleIndex;
    const data = vehicleDataArray.getData();

    for (let i = 0; i < numVehicles; i++) {
      if (this.pathFindCountThisFrame >= MAX_PATH_FINDS_PER_FRAME) break;

      const vehId = (startIndex + i) % numVehicles;
      const ptr = vehId * VEHICLE_DATA_SIZE;
      const jobState = Math.trunc(data[ptr + LogicData.JOB_STATE]);

      const didProcess = this.processVehicleState(
        vehId, jobState, ptr, data,
        vehicleDataArray, edgeArray, edgeNameToIndex,
        transferMgr, simulationTime, lockMgr
      );

      if (didProcess) {
        this.nextVehicleIndex = (vehId + 1) % numVehicles;
      }
    }
  }

  /**
   * 차량 상태 머신 처리
   */
  private processVehicleState(
    vehId: number,
    jobState: number,
    ptr: number,
    data: Float32Array,
    vehicleDataArray: IVehicleDataArray,
    edgeArray: Edge[],
    edgeNameToIndex: Map<string, number>,
    transferMgr: TransferMgr,
    simulationTime: number,
    lockMgr?: LockMgr
  ): boolean {
    switch (jobState) {
      case JobState.IDLE:
        return this.handleIdle(vehId, ptr, data, vehicleDataArray, edgeArray, edgeNameToIndex, transferMgr, simulationTime, lockMgr);
      case JobState.CYCLE:
        return this.handleCycle(vehId, ptr, data, vehicleDataArray, edgeArray, edgeNameToIndex, transferMgr, simulationTime, lockMgr);
      case JobState.MOVE_TO_LOAD:
        return this.handleMoveToLoad(vehId, ptr, data, transferMgr, simulationTime);
      case JobState.LOADING:
        return this.handleLoading(vehId, ptr, data, vehicleDataArray, edgeArray, edgeNameToIndex, transferMgr, simulationTime, lockMgr);
      case JobState.MOVE_TO_UNLOAD:
        return this.handleMoveToUnload(vehId, ptr, data, transferMgr, simulationTime);
      case JobState.UNLOADING:
        return this.handleUnloading(vehId, ptr, data, simulationTime);
      default:
        return false;
    }
  }

  private handleIdle(
    vehId: number, ptr: number, data: Float32Array,
    vehicleDataArray: IVehicleDataArray, edgeArray: Edge[],
    edgeNameToIndex: Map<string, number>, transferMgr: TransferMgr,
    simulationTime: number, lockMgr?: LockMgr
  ): boolean {
    if (transferMgr.hasPendingCommands(vehId)) return false;

    const orderState = this.activeOrders.get(vehId);
    if (orderState) {
      // IDLE에서 order가 있으면 즉시 pickup으로 이동
      return this.startMoveToPickup(vehId, ptr, data, orderState, vehicleDataArray, edgeArray, edgeNameToIndex, transferMgr, simulationTime, lockMgr);
    }

    if (this.orderModeEnabled) {
      // order 모드에서는 JobBatchMgr가 order를 할당해줄 때까지 CYCLE로 전환
      const currentEdgeIdx = Math.trunc(data[ptr + MovementData.CURRENT_EDGE]);
      const assigned = this.assignRandomDestination(vehId, currentEdgeIdx, vehicleDataArray, edgeArray, edgeNameToIndex, transferMgr, lockMgr);
      if (assigned) {
        data[ptr + LogicData.JOB_STATE] = JobState.CYCLE;
      }
      return assigned;
    }

    // 기존 AUTO_ROUTE 호환: 랜덤 목적지 할당 후 CYCLE로 전환
    const currentEdgeIdx = Math.trunc(data[ptr + MovementData.CURRENT_EDGE]);
    const assigned = this.assignRandomDestination(vehId, currentEdgeIdx, vehicleDataArray, edgeArray, edgeNameToIndex, transferMgr, lockMgr);
    if (assigned) {
      data[ptr + LogicData.JOB_STATE] = JobState.CYCLE;
    }
    return assigned;
  }

  private handleCycle(
    vehId: number, ptr: number, data: Float32Array,
    vehicleDataArray: IVehicleDataArray, edgeArray: Edge[],
    edgeNameToIndex: Map<string, number>, transferMgr: TransferMgr,
    simulationTime: number, lockMgr?: LockMgr
  ): boolean {
    const orderState = this.activeOrders.get(vehId);

    if (orderState && orderState.pendingOrder) {
      // order 대기중: NEXT_EDGE 소진 확인
      if (this.isVehicleArrived(vehId, data, ptr, transferMgr)) {
        return this.startMoveToPickup(vehId, ptr, data, orderState, vehicleDataArray, edgeArray, edgeNameToIndex, transferMgr, simulationTime, lockMgr);
      }
      return false;
    }

    // CYCLE 목적지 도착 → 새 랜덤 목적지
    if (this.isVehicleArrived(vehId, data, ptr, transferMgr)) {
      const currentEdgeIdx = Math.trunc(data[ptr + MovementData.CURRENT_EDGE]);
      return this.assignRandomDestination(vehId, currentEdgeIdx, vehicleDataArray, edgeArray, edgeNameToIndex, transferMgr, lockMgr);
    }

    return false;
  }

  private handleMoveToLoad(
    vehId: number, ptr: number, data: Float32Array,
    transferMgr: TransferMgr, simulationTime: number
  ): boolean {
    const orderState = this.activeOrders.get(vehId);
    if (!orderState) return false;

    if (this.isVehicleArrived(vehId, data, ptr, transferMgr)) {
      // pickup 도착
      data[ptr + OrderData.PICKUP_ARRIVE_TS] = simulationTime;
      data[ptr + OrderData.PICKUP_START_TS] = simulationTime;
      data[ptr + LogicData.JOB_STATE] = JobState.LOADING;
      orderState.timerStartTime = simulationTime;
      return true;
    }
    return false;
  }

  private handleLoading(
    vehId: number, ptr: number, data: Float32Array,
    vehicleDataArray: IVehicleDataArray, edgeArray: Edge[],
    edgeNameToIndex: Map<string, number>, transferMgr: TransferMgr,
    simulationTime: number, lockMgr?: LockMgr
  ): boolean {
    const orderState = this.activeOrders.get(vehId);
    if (!orderState) return false;

    if (simulationTime - orderState.timerStartTime >= orderState.order.loadDurationSec) {
      data[ptr + OrderData.PICKUP_DONE_TS] = simulationTime;

      // dropoff으로 경로 할당
      const currentEdgeIdx = Math.trunc(data[ptr + MovementData.CURRENT_EDGE]);
      const pathIndices = findShortestPath(currentEdgeIdx, orderState.order.dropoffEdgeIndex, edgeArray);

      if (pathIndices && pathIndices.length > 0) {
        this.pathFindCountThisFrame++;
        this.applyPathToVehicle({
          vehId,
          pathIndices,
          candidate: { name: orderState.order.dropoffStationName, edgeIndex: orderState.order.dropoffEdgeIndex },
          vehicleDataArray, edgeArray, edgeNameToIndex, transferMgr, lockMgr,
        });

        data[ptr + LogicData.JOB_STATE] = JobState.MOVE_TO_UNLOAD;
        data[ptr + OrderData.MOVE_TO_DROP_TS] = simulationTime;
        return true;
      }
    }
    return false;
  }

  private handleMoveToUnload(
    vehId: number, ptr: number, data: Float32Array,
    transferMgr: TransferMgr, simulationTime: number
  ): boolean {
    const orderState = this.activeOrders.get(vehId);
    if (!orderState) return false;

    if (this.isVehicleArrived(vehId, data, ptr, transferMgr)) {
      data[ptr + OrderData.DROP_ARRIVE_TS] = simulationTime;
      data[ptr + OrderData.DROP_START_TS] = simulationTime;
      data[ptr + LogicData.JOB_STATE] = JobState.UNLOADING;
      orderState.timerStartTime = simulationTime;
      return true;
    }
    return false;
  }

  private handleUnloading(
    vehId: number, ptr: number, data: Float32Array,
    simulationTime: number
  ): boolean {
    const orderState = this.activeOrders.get(vehId);
    if (!orderState) return false;

    if (simulationTime - orderState.timerStartTime >= orderState.order.unloadDurationSec) {
      data[ptr + OrderData.DROP_DONE_TS] = simulationTime;
      this.onOrderComplete?.(vehId, orderState.order.orderId, simulationTime);
      this.activeOrders.delete(vehId);
      this.vehicleDestinations.delete(vehId);
      data[ptr + LogicData.JOB_STATE] = JobState.IDLE;
      return true;
    }
    return false;
  }

  /**
   * pickup 경로 할당 + JOB_STATE 전환
   */
  private startMoveToPickup(
    vehId: number, ptr: number, data: Float32Array,
    orderState: VehicleOrderState,
    vehicleDataArray: IVehicleDataArray, edgeArray: Edge[],
    edgeNameToIndex: Map<string, number>, transferMgr: TransferMgr,
    simulationTime: number, lockMgr?: LockMgr
  ): boolean {
    const currentEdgeIdx = Math.trunc(data[ptr + MovementData.CURRENT_EDGE]);
    const pathIndices = findShortestPath(currentEdgeIdx, orderState.order.pickupEdgeIndex, edgeArray);

    if (pathIndices && pathIndices.length > 0) {
      this.pathFindCountThisFrame++;
      this.applyPathToVehicle({
        vehId,
        pathIndices,
        candidate: { name: orderState.order.pickupStationName, edgeIndex: orderState.order.pickupEdgeIndex },
        vehicleDataArray, edgeArray, edgeNameToIndex, transferMgr, lockMgr,
      });

      data[ptr + LogicData.JOB_STATE] = JobState.MOVE_TO_LOAD;
      data[ptr + OrderData.MOVE_TO_PICKUP_TS] = simulationTime;
      orderState.pendingOrder = false;
      return true;
    }
    return false;
  }

  /**
   * JobBatchMgr가 호출: 차량에 order 할당
   */
  assignOrder(
    vehId: number,
    order: TransportOrder,
    simulationTime: number,
    vehicleDataArray: IVehicleDataArray,
    edgeArray: Edge[],
    edgeNameToIndex: Map<string, number>,
    transferMgr: TransferMgr,
    lockMgr?: LockMgr
  ): boolean {
    const data = vehicleDataArray.getData();
    const ptr = vehId * VEHICLE_DATA_SIZE;
    const jobState = Math.trunc(data[ptr + LogicData.JOB_STATE]);

    // OrderData 타임스탬프 초기화
    data[ptr + OrderData.ORDER_ID] = order.orderId;
    data[ptr + OrderData.ORDER_DEST_EDGE] = order.dropoffEdgeIndex;
    data[ptr + OrderData.MOVE_TO_PICKUP_TS] = 0;
    data[ptr + OrderData.PICKUP_ARRIVE_TS] = 0;
    data[ptr + OrderData.PICKUP_START_TS] = 0;
    data[ptr + OrderData.PICKUP_DONE_TS] = 0;
    data[ptr + OrderData.MOVE_TO_DROP_TS] = 0;
    data[ptr + OrderData.DROP_ARRIVE_TS] = 0;
    data[ptr + OrderData.DROP_START_TS] = 0;
    data[ptr + OrderData.DROP_DONE_TS] = 0;

    const orderState: VehicleOrderState = {
      order,
      timerStartTime: 0,
      pendingOrder: false,
    };

    if (jobState === JobState.IDLE) {
      // 즉시 pickup 경로 할당
      this.activeOrders.set(vehId, orderState);
      return this.startMoveToPickup(vehId, ptr, data, orderState, vehicleDataArray, edgeArray, edgeNameToIndex, transferMgr, simulationTime, lockMgr);
    }

    if (jobState === JobState.CYCLE) {
      // pathBuffer 클리어, NEXT_EDGE는 자연 소진
      transferMgr.clearVehiclePath(vehId);
      orderState.pendingOrder = true;
      this.activeOrders.set(vehId, orderState);
      return true;
    }

    return false;
  }

  getActiveOrder(vehId: number): VehicleOrderState | undefined {
    return this.activeOrders.get(vehId);
  }

  /**
   * 차량이 도착(정지 + 명령 없음)했는지 확인
   */
  private isVehicleArrived(vehId: number, data: Float32Array, ptr: number, transferMgr: TransferMgr): boolean {
    return data[ptr + MovementData.MOVING_STATUS] === MovingStatus.STOPPED
      && !transferMgr.hasPendingCommands(vehId);
  }

  // === 기존 메서드 (유지) ===

  assignRandomDestination(
    vehId: number,
    currentEdgeIdx: number,
    vehicleDataArray: IVehicleDataArray,
    edgeArray: Edge[],
    edgeNameToIndex: Map<string, number>,
    transferMgr: TransferMgr,
    lockMgr?: LockMgr
  ): boolean {
    if (this.stations.length === 0) {
      return false;
    }

    const MAX_ATTEMPTS = 5;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const candidate = this.stations[Math.floor(Math.random() * this.stations.length)];

      if (candidate.edgeIndex === currentEdgeIdx && this.stations.length > 1) {
        continue;
      }

      this.pathFindCountThisFrame++;

      const pathIndices = findShortestPath(currentEdgeIdx, candidate.edgeIndex, edgeArray);

      if (pathIndices && pathIndices.length > 0) {
        this.applyPathToVehicle({
          vehId,
          pathIndices,
          candidate,
          vehicleDataArray,
          edgeArray,
          edgeNameToIndex,
          transferMgr,
          lockMgr,
        });
        return true;
      }
    }

    return false;
  }

  getDestinationInfo(vehId: number) {
    return this.vehicleDestinations.get(vehId);
  }

  private applyPathToVehicle(ctx: ApplyPathContext): void {
    const { vehId, pathIndices, candidate, vehicleDataArray, edgeArray, edgeNameToIndex, transferMgr, lockMgr } = ctx;
    if (lockMgr) {
      this.cancelObsoleteLocks(vehId, pathIndices, edgeArray, lockMgr);
    }

    const pathCommand = this.constructPathCommand(pathIndices, edgeArray);
    const command: VehicleCommand = { path: pathCommand };

    this.vehicleDestinations.set(vehId, { stationName: candidate.name, edgeIndex: candidate.edgeIndex });

    this.onPathFound?.(vehId, candidate.edgeIndex, pathIndices.length);

    const ptr = vehId * VEHICLE_DATA_SIZE;
    const data = vehicleDataArray.getData();
    if (data) {
      data[ptr + LogicData.DESTINATION_EDGE] = candidate.edgeIndex;
      data[ptr + LogicData.PATH_REMAINING] = pathCommand.length;
    }

    transferMgr.assignCommand(vehId, command, vehicleDataArray, edgeArray, edgeNameToIndex, lockMgr);
  }

  dispose(): void {
    this.stations = [];
    this.vehicleDestinations.clear();
    this.activeOrders.clear();
  }

  private constructPathCommand(pathIndices: number[], edgeArray: Edge[]): Array<{ edgeId: string; targetRatio?: number }> {
    const pathCommand: Array<{ edgeId: string; targetRatio?: number }> = [];

    for (let i = 1; i < pathIndices.length; i++) {
      const idx = pathIndices[i];
      if (idx < 1) continue;
      const edge = edgeArray[idx - 1];
      if (!edge) continue;
      const isLast = (i === pathIndices.length - 1);

      pathCommand.push({
        edgeId: edge.edge_name,
        targetRatio: isLast ? 0.5 : undefined
      });
    }

    return pathCommand;
  }

  findLocksToCancel(
    vehId: number,
    newPathIndices: number[],
    edgeArray: Edge[],
    lockMgr: LockMgr
  ): string[] {
    const currentLocks = lockMgr.getLocksForVehicle(vehId);
    if (currentLocks.length === 0) {
      return [];
    }

    const newPathNodes = new Set<string>();
    for (const edgeIdx of newPathIndices) {
      if (edgeIdx < 1) continue;
      const edge = edgeArray[edgeIdx - 1];
      if (edge) {
        newPathNodes.add(edge.to_node);
      }
    }

    const locksToCancel: string[] = [];
    for (const lock of currentLocks) {
      if (!newPathNodes.has(lock.nodeName)) {
        locksToCancel.push(lock.nodeName);
      }
    }

    return locksToCancel;
  }

  cancelObsoleteLocks(
    vehId: number,
    newPathIndices: number[],
    edgeArray: Edge[],
    lockMgr: LockMgr
  ): void {
    const locksToCancel = this.findLocksToCancel(vehId, newPathIndices, edgeArray, lockMgr);

    for (const nodeName of locksToCancel) {
      lockMgr.cancelLock(nodeName, vehId);
    }
  }
}
