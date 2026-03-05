// shmSimulator/managers/JobBatchMgr.ts
import {
  VEHICLE_DATA_SIZE,
  LogicData,
  JobState,
  MovementData,
} from "@/common/vehicle/initialize/constants";
import type { OrderMgr, TransportOrder } from "@/common/vehicle/logic/OrderMgr";
import type { TransferMgr, IVehicleDataArray } from "@/common/vehicle/logic/TransferMgr";
import type { LockMgr } from "@/common/vehicle/logic/LockMgr";
import type { Edge } from "@/types/edge";
import type { StationRawData } from "@/types/station";
import { findShortestPath } from "@/common/vehicle/logic/Dijkstra";

/**
 * 외부에서 들어오는 반송 명령
 */
export interface ExternalOrder {
  pickupStation: string;
  dropoffStation: string;
  loadDurationSec?: number;
  unloadDurationSec?: number;
}

const MAX_ASSIGNMENTS_PER_FRAME = 5;

export class JobBatchMgr {
  private orderQueue: ExternalOrder[] = [];
  private readonly stationMap: Map<string, number> = new Map(); // name → edgeIndex (1-based)
  private nextOrderId = 1;

  constructor(private readonly orderMgr: OrderMgr) {}

  /**
   * Station name → edge index 매핑 구축
   */
  initStations(stationData: StationRawData[], edgeNameToIndex: Map<string, number>): void {
    this.stationMap.clear();
    for (const station of stationData) {
      if (station.nearest_edge) {
        const edgeIdx = edgeNameToIndex.get(station.nearest_edge);
        if (edgeIdx !== undefined) {
          this.stationMap.set(station.station_name, edgeIdx);
        }
      }
    }
  }

  /**
   * 단일 order 추가
   * @returns orderId
   */
  addOrder(order: ExternalOrder): number {
    this.orderQueue.push(order);
    return this.nextOrderId; // will be assigned when dispatched
  }

  /**
   * 배치 추가
   */
  addOrders(orders: ExternalOrder[]): void {
    for (const order of orders) {
      this.orderQueue.push(order);
    }
  }

  /**
   * 매 프레임 호출: idle/cycle 차량에 order 배차
   */
  update(
    numVehicles: number,
    simulationTime: number,
    vehicleDataArray: IVehicleDataArray,
    edgeArray: Edge[],
    edgeNameToIndex: Map<string, number>,
    transferMgr: TransferMgr,
    lockMgr?: LockMgr
  ): void {
    if (this.orderQueue.length === 0) return;

    const data = vehicleDataArray.getData();

    // idle/cycle 차량 수집
    const availableVehicles: number[] = [];
    for (let vehId = 0; vehId < numVehicles; vehId++) {
      const ptr = vehId * VEHICLE_DATA_SIZE;
      const jobState = Math.trunc(data[ptr + LogicData.JOB_STATE]);
      if (jobState === JobState.IDLE || jobState === JobState.CYCLE) {
        // 이미 order가 할당된 차량은 제외
        if (!this.orderMgr.getActiveOrder(vehId)) {
          availableVehicles.push(vehId);
        }
      }
    }

    if (availableVehicles.length === 0) return;

    let assignCount = 0;
    while (this.orderQueue.length > 0 && assignCount < MAX_ASSIGNMENTS_PER_FRAME) {
      const extOrder = this.orderQueue[0];

      const pickupEdge = this.stationMap.get(extOrder.pickupStation);
      const dropoffEdge = this.stationMap.get(extOrder.dropoffStation);
      if (pickupEdge === undefined || dropoffEdge === undefined) {
        // 유효하지 않은 station → 스킵
        this.orderQueue.shift();
        continue;
      }

      // 가장 가까운 idle 차량 찾기 (hop count 기준)
      let bestVehId = -1;
      let bestHops = Infinity;

      for (const vehId of availableVehicles) {
        const ptr = vehId * VEHICLE_DATA_SIZE;
        const currentEdgeIdx = Math.trunc(data[ptr + MovementData.CURRENT_EDGE]);
        const path = findShortestPath(currentEdgeIdx, pickupEdge, edgeArray);
        if (path && path.length < bestHops) {
          bestHops = path.length;
          bestVehId = vehId;
        }
      }

      if (bestVehId < 0) break;

      const order: TransportOrder = {
        orderId: this.nextOrderId++,
        pickupEdgeIndex: pickupEdge,
        pickupStationName: extOrder.pickupStation,
        dropoffEdgeIndex: dropoffEdge,
        dropoffStationName: extOrder.dropoffStation,
        loadDurationSec: extOrder.loadDurationSec ?? 3,
        unloadDurationSec: extOrder.unloadDurationSec ?? 3,
      };

      const success = this.orderMgr.assignOrder(
        bestVehId, order, simulationTime,
        vehicleDataArray, edgeArray, edgeNameToIndex,
        transferMgr, lockMgr
      );

      if (success) {
        this.orderQueue.shift();
        // 배차된 차량을 available 목록에서 제거
        const idx = availableVehicles.indexOf(bestVehId);
        if (idx >= 0) availableVehicles.splice(idx, 1);
        assignCount++;
      } else {
        // 할당 실패 → 다음 프레임에 재시도
        break;
      }
    }
  }

  getQueueLength(): number {
    return this.orderQueue.length;
  }

  dispose(): void {
    this.orderQueue = [];
    this.stationMap.clear();
  }
}
