// common/vehicle/logic/AutoMgr.ts
import {
  VEHICLE_DATA_SIZE,
  MovementData,
  TransferMode,
  LogicData
} from "@/common/vehicle/initialize/constants";
import { TransferMgr, VehicleCommand, IVehicleDataArray } from "./TransferMgr";
import { findShortestPath } from "./Dijkstra";
import { Edge } from "@/types/edge";
import { StationRawData } from "@/types/station";
import { devLog } from "@/logger/DevLogger";
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

export class AutoMgr {
  private stations: StationTarget[] = [];
  // Vehicle ID -> Current Destination info
  private readonly vehicleDestinations: Map<number, { stationName: string, edgeIndex: number }> = new Map();
  // Round-robin index for fair vehicle processing
  private nextVehicleIndex = 0;
  // Path finding count in current frame
  private pathFindCountThisFrame = 0;

  /**
   * Initializes available stations for routing.
   * Called once at startup.
   */
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


  /**
   * Main update loop for Auto Routing.
   * Checks if vehicles need new destinations and assigns them.
   * Uses round-robin and per-frame limit to prevent performance spikes.
   */
  update(
    mode: TransferMode,
    numVehicles: number,
    vehicleDataArray: IVehicleDataArray,
    edgeArray: Edge[],
    edgeNameToIndex: Map<string, number>,
    transferMgr: TransferMgr,
    lockMgr?: LockMgr
  ) {
    if (mode !== TransferMode.AUTO_ROUTE) return;
    if (numVehicles === 0) return;

    // Reset per-frame counter
    this.pathFindCountThisFrame = 0;

    // Process vehicles in round-robin fashion with limit
    const startIndex = this.nextVehicleIndex;

    for (let i = 0; i < numVehicles; i++) {
      // Check if we've hit the per-frame limit
      if (this.pathFindCountThisFrame >= MAX_PATH_FINDS_PER_FRAME) {
        break;
      }

      const vehId = (startIndex + i) % numVehicles;
      const didAssign = this.checkAndAssignRoute(
        vehId,
        vehicleDataArray,
        edgeArray,
        edgeNameToIndex,
        transferMgr,
        lockMgr
      );

      // Update next starting index for round-robin
      if (didAssign) {
        this.nextVehicleIndex = (vehId + 1) % numVehicles;
      }
    }
  }

  /**
   * Checks a specific vehicle and assigns a route if:
   * 1. It has no pending commands (idle or finished path).
   * 2. It is stopped or moving on the last edge.
   * @returns true if a route was assigned, false otherwise
   */
  private checkAndAssignRoute(
    vehId: number,
    vehicleDataArray: IVehicleDataArray,
    edgeArray: Edge[],
    edgeNameToIndex: Map<string, number>,
    transferMgr: TransferMgr,
    lockMgr?: LockMgr
  ): boolean {
    if (transferMgr.hasPendingCommands(vehId)) return false;

    const data = vehicleDataArray.getData();
    const ptr = vehId * VEHICLE_DATA_SIZE;
    const currentEdgeIdx = Math.trunc(data[ptr + MovementData.CURRENT_EDGE]);

    // Assign random destination
    return this.assignRandomDestination(vehId, currentEdgeIdx, vehicleDataArray, edgeArray, edgeNameToIndex, transferMgr, lockMgr);
  }

  /**
   * @returns true if a route was successfully assigned
   */
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
      // Pick random station
      const candidate = this.stations[Math.floor(Math.random() * this.stations.length)];

      // Skip if same as current edge (unless it's the only one)
      if (candidate.edgeIndex === currentEdgeIdx && this.stations.length > 1) {
        continue;
      }

      // Increment path find counter BEFORE calling findShortestPath
      this.pathFindCountThisFrame++;

      // Pathfinding
      const pathIndices = findShortestPath(currentEdgeIdx, candidate.edgeIndex, edgeArray);

      if (pathIndices && pathIndices.length > 0) {
        devLog.veh(vehId).debug(`[pathBuff] DIJKSTRA from=${currentEdgeIdx} to=${candidate.edgeIndex} result=[${pathIndices.slice(0, 10).join(',')}${pathIndices.length > 10 ? '...' : ''}] len=${pathIndices.length}`);

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

  /**
   * 경로를 차량에 적용
   */
  private applyPathToVehicle(ctx: ApplyPathContext): void {
    const { vehId, pathIndices, candidate, vehicleDataArray, edgeArray, edgeNameToIndex, transferMgr, lockMgr } = ctx;
    // 경로 변경 전에 새 경로에 없는 락 취소
    if (lockMgr) {
      this.cancelObsoleteLocks(vehId, pathIndices, edgeArray, lockMgr);
    }

    const pathCommand = this.constructPathCommand(pathIndices, edgeArray);
    const command: VehicleCommand = { path: pathCommand };

    this.vehicleDestinations.set(vehId, { stationName: candidate.name, edgeIndex: candidate.edgeIndex });

    // Update Shared Memory for UI
    const ptr = vehId * VEHICLE_DATA_SIZE;
    const data = vehicleDataArray.getData();
    if (data) {
      data[ptr + LogicData.DESTINATION_EDGE] = candidate.edgeIndex;
      data[ptr + LogicData.PATH_REMAINING] = pathCommand.length;
    }

    transferMgr.assignCommand(vehId, command, vehicleDataArray, edgeArray, edgeNameToIndex);
  }

  /**
   * Dispose all internal data to allow garbage collection
   */
  dispose(): void {
    this.stations = [];
    this.vehicleDestinations.clear();
  }

  private constructPathCommand(pathIndices: number[], edgeArray: Edge[]): Array<{ edgeId: string; targetRatio?: number }> {
    const pathCommand: Array<{ edgeId: string; targetRatio?: number }> = [];

    // Construct command from path (start from 1 as 0 is current edge in the path array)
    // NOTE: pathIndices contains 1-based edge indices
    for (let i = 1; i < pathIndices.length; i++) {
      const idx = pathIndices[i];
      if (idx < 1) continue; // 1-based: 0 is invalid
      const edge = edgeArray[idx - 1]; // Convert to 0-based for array access
      if (!edge) continue;
      const isLast = (i === pathIndices.length - 1);

      pathCommand.push({
        edgeId: edge.edge_name,
        targetRatio: isLast ? 0.5 : undefined
      });
    }

    return pathCommand;
  }

  /**
   * 새 경로에 포함되지 않는 락을 찾아서 반환
   * @param vehId 차량 ID
   * @param newPathIndices 새 경로의 edge index 배열
   * @param edgeArray 전체 edge 배열
   * @param lockMgr LockMgr 인스턴스
   * @returns 취소해야 할 노드 이름 배열
   */
  findLocksToCancel(
    vehId: number,
    newPathIndices: number[],
    edgeArray: Edge[],
    lockMgr: LockMgr
  ): string[] {
    // 1. 현재 차량이 가진 락 목록 조회
    const currentLocks = lockMgr.getLocksForVehicle(vehId);
    if (currentLocks.length === 0) {
      return [];
    }

    // 2. 새 경로에 포함된 노드들 수집 (to_node 기준)
    // NOTE: edgeIdx is 1-based. 0 is invalid sentinel.
    const newPathNodes = new Set<string>();
    for (const edgeIdx of newPathIndices) {
      if (edgeIdx < 1) continue; // 1-based: 0 is invalid
      const edge = edgeArray[edgeIdx - 1]; // Convert to 0-based for array access
      if (edge) {
        newPathNodes.add(edge.to_node);
      }
    }

    // 3. 새 경로에 없는 락 찾기
    const locksToCancel: string[] = [];
    for (const lock of currentLocks) {
      if (!newPathNodes.has(lock.nodeName)) {
        locksToCancel.push(lock.nodeName);
        devLog.veh(vehId).debug(`[findLocksToCancel] node=${lock.nodeName} not in new path, will cancel (wasGranted=${lock.isGranted})`);
      }
    }

    return locksToCancel;
  }

  /**
   * 경로 변경 시 불필요한 락 취소
   */
  cancelObsoleteLocks(
    vehId: number,
    newPathIndices: number[],
    edgeArray: Edge[],
    lockMgr: LockMgr
  ): void {
    const locksToCancel = this.findLocksToCancel(vehId, newPathIndices, edgeArray, lockMgr);

    if (locksToCancel.length > 0) {
      devLog.veh(vehId).debug(`[cancelObsoleteLocks] cancelling ${locksToCancel.length} locks: [${locksToCancel.join(', ')}]`);
    }

    for (const nodeName of locksToCancel) {
      lockMgr.cancelLock(nodeName, vehId);
    }
  }
}
