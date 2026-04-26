// common/vehicle/logic/AutoMgr.ts
import {
  VEHICLE_DATA_SIZE,
  MovementData,
  TransferMode,
  LogicData,
  JobState,
  OrderData,
  MovingStatus,
  NextEdgeState,
} from "@/common/vehicle/initialize/constants";
import { TransferMgr, VehicleCommand, IVehicleDataArray, VehicleBayLoop } from "./TransferMgr";
import { findShortestPath, type RoutingContext } from "./Dijkstra";
import { Edge } from "@/types/edge";
import { StationRawData } from "@/types/station";
import { LockMgr } from "./LockMgr";

interface StationTarget {
  name: string;
  edgeIndex: number;
  ratio: number;
}

// Maximum number of path findings per frame to prevent spikes
const MAX_PATH_FINDS_PER_FRAME = 10;

/** applyPathToVehicle Context */
interface ApplyPathContext {
  vehId: number;
  pathIndices: number[];
  candidate: StationTarget;
  vehicleDataArray: IVehicleDataArray;
  edgeArray: Edge[];
  edgeNameToIndex: Map<string, number>;
  transferMgr: TransferMgr;
  lockMgr?: LockMgr;
}

/**
 * Path 발견 이벤트 콜백
 * @param vehId - Vehicle ID
 * @param destEdge - 목적지 edge index
 * @param pathLen - 경로 길이
 */
export type OnPathFoundCallback = (
  vehId: number,
  destEdge: number,
  pathLen: number
) => void;

/** AutoMgr.update() context */
export interface AutoMgrUpdateContext {
  mode: TransferMode;
  numVehicles: number;
  vehicleDataArray: IVehicleDataArray;
  edgeArray: Edge[];
  edgeNameToIndex: Map<string, number>;
  transferMgr: TransferMgr;
  lockMgr?: LockMgr;
  vehicleBayLoopMap?: Map<number, VehicleBayLoop>;
  // Transfer control (Phase 2)
  transferEnabled: boolean;
  transferRateMode: 'utilization' | 'throughput';
  transferUtilizationPercent: number;
  transferThroughputPerHour: number;
  dt: number;
  simulationTime: number;
}

export class AutoMgr {
  private stations: StationTarget[] = [];
  // Vehicle ID -> Current Destination info
  private readonly vehicleDestinations: Map<number, StationTarget> = new Map();
  // Round-robin index for fair vehicle processing
  private nextVehicleIndex = 0;
  // Path finding count in current frame
  private pathFindCountThisFrame = 0;

  // --- Transfer control (Phase 2) ---
  private readonly transferringVehicles: Set<number> = new Set();
  private throughputCredit = 0;
  private nextOrderId = 1;
  /** 할당량 가득 찼을 때 쿨다운 (초) — 5초 내 재시도 방지 */
  private transferCheckCooldown = 0;
  // vehId → dwell 종료 시각 (ms, Date.now() 기준)
  private readonly dwellTimers: Map<number, number> = new Map();
  // vehId → LOADING 완료 후 이동할 dest station
  private readonly pendingDestStation: Map<number, StationTarget> = new Map();
  // vehId → pickup station (for detecting station edge entry during MOVE_TO_LOAD)
  private readonly pendingSrcStation: Map<number, StationTarget> = new Map();
  // vehId → actual dest station (preserved across preloadLoopPath which overwrites vehicleDestinations)
  private readonly actualDestStation: Map<number, StationTarget> = new Map();
  /** pickup/dropoff 대기 시간 (ms). 기본 7초. */
  dwellMs = 7000;
  /** Path 발견 콜백 (SimLogger 연결용) */
  onPathFound?: OnPathFoundCallback;
  /** Per-fab routing context for BPR cost */
  routingContext?: RoutingContext;

  /**
   * Reroute interval (edges).
   *  0 = reroute only at destination (default)
   *  1 = every edge transition
   *  N = every N edge transitions
   */
  rerouteInterval = 0;

  // Per-vehicle: last known CURRENT_EDGE (for detecting edge transitions)
  private readonly lastEdge: Map<number, number> = new Map();
  // Per-vehicle: edge transitions since last reroute
  private readonly edgesSinceReroute: Map<number, number> = new Map();
  // Path change tracking (oscillation measurement)
  private readonly lastPath: Map<number, number[]> = new Map();
  private readonly pathChangeCount: Map<number, number> = new Map();
  // Order completion stats (throughput + lead time)
  private orderStats = { completed: 0, leadTimes: [] as number[], resetSimTime: 0 };

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
            edgeIndex: edgeIdx,
            ratio: parseFloat(station.nearest_edge_distance) || 0.5
          });
        }
      }
    }
  }


  /**
   * Main update loop for Auto Routing.
   * Flow: transfer completion check → LOOP assign → transfer assign
   */
  update(ctx: AutoMgrUpdateContext) {
    const {
      mode, numVehicles, vehicleDataArray, edgeArray, edgeNameToIndex,
      transferMgr, lockMgr, vehicleBayLoopMap,
      transferEnabled, simulationTime,
    } = ctx;
    if (mode !== TransferMode.AUTO_ROUTE && mode !== TransferMode.LOOP) return;
    if (numVehicles === 0) return;

    // Reset per-frame counter
    this.pathFindCountThisFrame = 0;

    // === 0. Transfer state machine (매 프레임 tick 기반) ===
    const data = vehicleDataArray.getData();
    const now = Date.now();
    for (const vehId of this.transferringVehicles) {
      const ptr = vehId * VEHICLE_DATA_SIZE;
      const jobState = data[ptr + LogicData.JOB_STATE];
      const isStopped = data[ptr + MovementData.MOVING_STATUS] === MovingStatus.STOPPED;

      const currentEdgeIdx = Math.trunc(data[ptr + MovementData.CURRENT_EDGE]);

      // --- MOVE_TO_LOAD: pre-load dest path when entering src station edge ---
      if (jobState === JobState.MOVE_TO_LOAD) {
        const srcStation = this.pendingSrcStation.get(vehId);
        if (srcStation && currentEdgeIdx === srcStation.edgeIndex) {
          // On station edge — pre-load dest path for merge lock acquisition
          const destStation = this.pendingDestStation.get(vehId);
          if (destStation) {
            // Save actual dest station before preloadNextPath overwrites vehicleDestinations
            this.actualDestStation.set(vehId, destStation);
            this.preloadNextPath(
              vehId, srcStation, destStation,
              vehicleDataArray, edgeArray, edgeNameToIndex, transferMgr, lockMgr
            );
          }
          // Stop at station
          data[ptr + MovementData.TARGET_RATIO] = srcStation.ratio;
          this.pendingSrcStation.delete(vehId);
        } else if (!srcStation && isStopped) {
          // Pre-load done, vehicle stopped at src → start LOADING
          data[ptr + LogicData.JOB_STATE] = JobState.LOADING;
          data[ptr + OrderData.PICKUP_ARRIVE_TS] = simulationTime;
          data[ptr + OrderData.PICKUP_START_TS] = simulationTime;
          this.dwellTimers.set(vehId, now + this.dwellMs);
        }
      }

      // --- LOADING complete: resume with existing pathBuffer (no re-pathfind) ---
      else if (jobState === JobState.LOADING && now >= (this.dwellTimers.get(vehId) ?? Infinity)) {
        data[ptr + LogicData.JOB_STATE] = JobState.MOVE_TO_UNLOAD;
        data[ptr + OrderData.PICKUP_DONE_TS] = simulationTime;
        data[ptr + OrderData.MOVE_TO_DROP_TS] = simulationTime;
        data[ptr + MovementData.TARGET_RATIO] = 1;
        data[ptr + MovementData.MOVING_STATUS] = MovingStatus.MOVING;
        this.dwellTimers.delete(vehId);
        // vehicleDestinations already set to destStation by preloadNextPath
        this.pendingDestStation.delete(vehId);
      }

      // --- MOVE_TO_UNLOAD: pre-load loop path when entering dest station edge ---
      else if (jobState === JobState.MOVE_TO_UNLOAD) {
        // Use actualDestStation (preserved from preloadNextPath) because
        // preloadLoopPath overwrites vehicleDestinations with the loop destination
        const destStation = this.actualDestStation.get(vehId)
          ?? this.vehicleDestinations.get(vehId);
        if (destStation && currentEdgeIdx === destStation.edgeIndex
          && !this.dwellTimers.has(vehId)) {
          // Just entered dest station edge — pre-load loop path
          this.preloadLoopPath(
            vehId, destStation,
            vehicleDataArray, edgeArray, edgeNameToIndex, transferMgr, lockMgr
          );
          // Stop at dest station
          data[ptr + MovementData.TARGET_RATIO] = destStation.ratio;
          // Mark with a sentinel dwell timer (Infinity) to prevent re-trigger
          this.dwellTimers.set(vehId, Infinity);
        } else if (isStopped && destStation && currentEdgeIdx === destStation.edgeIndex) {
          // Stopped at dest station → start UNLOADING
          data[ptr + LogicData.JOB_STATE] = JobState.UNLOADING;
          data[ptr + OrderData.DROP_ARRIVE_TS] = simulationTime;
          data[ptr + OrderData.DROP_START_TS] = simulationTime;
          this.dwellTimers.set(vehId, now + this.dwellMs);
        }
      }

      // --- UNLOADING complete: resume with existing loop pathBuffer ---
      else if (jobState === JobState.UNLOADING && now >= (this.dwellTimers.get(vehId) ?? Infinity)) {
        // Record lead time before clearing order data
        const moveToPickupTs = data[ptr + OrderData.MOVE_TO_PICKUP_TS];
        data[ptr + OrderData.DROP_DONE_TS] = simulationTime;
        if (moveToPickupTs > 0) {
          this.orderStats.completed++;
          this.orderStats.leadTimes.push(simulationTime - moveToPickupTs);
        }

        data[ptr + LogicData.JOB_STATE] = JobState.IDLE;
        data[ptr + OrderData.ORDER_ID] = 0;
        data[ptr + OrderData.ORDER_SRC_STATION] = 0;
        data[ptr + OrderData.ORDER_DEST_STATION] = 0;
        data[ptr + MovementData.TARGET_RATIO] = 1;
        data[ptr + MovementData.MOVING_STATUS] = MovingStatus.MOVING;
        this.transferringVehicles.delete(vehId);
        this.dwellTimers.delete(vehId);
        this.actualDestStation.delete(vehId);
      }
    }

    // Reroute check
    if (this.rerouteInterval > 0) {
      this.checkReroutes(numVehicles, vehicleDataArray, edgeArray, edgeNameToIndex, transferMgr, lockMgr);
    }

    // === 1. LOOP assign (always — skip transferring vehicles) ===
    const startIndex = this.nextVehicleIndex;
    for (let i = 0; i < numVehicles; i++) {
      if (this.pathFindCountThisFrame >= MAX_PATH_FINDS_PER_FRAME) break;
      const vehId = (startIndex + i) % numVehicles;

      if (this.transferringVehicles.has(vehId)) continue;

      let didAssign = false;
      if (mode === TransferMode.LOOP && vehicleBayLoopMap) {
        didAssign = this.checkAndAssignLoopRoute(
          vehId, vehicleDataArray, edgeArray, edgeNameToIndex, transferMgr, lockMgr, vehicleBayLoopMap
        );
      } else {
        didAssign = this.checkAndAssignRoute(
          vehId, vehicleDataArray, edgeArray, edgeNameToIndex, transferMgr, lockMgr
        );
      }

      if (didAssign) {
        this.nextVehicleIndex = (vehId + 1) % numVehicles;
      }
    }

    // === 2. Transfer assign (only when enabled) ===
    if (!transferEnabled || this.stations.length === 0) return;

    // 쿨다운: 할당량 가득 찼을 때 5초 대기
    this.transferCheckCooldown = Math.max(0, this.transferCheckCooldown - ctx.dt);
    if (this.transferCheckCooldown > 0) return;

    let quotaFull = false;
    for (let i = 0; i < numVehicles; i++) {
      if (this.pathFindCountThisFrame >= MAX_PATH_FINDS_PER_FRAME) break;
      if (!this.shouldAssignTransfer(ctx)) { quotaFull = true; break; }

      const vehId = (startIndex + i) % numVehicles;
      if (this.transferringVehicles.has(vehId)) continue;
      if (!this.isSwappable(vehId, transferMgr)) continue;

      const ptr = vehId * VEHICLE_DATA_SIZE;
      const currentEdgeIdx = Math.trunc(data[ptr + MovementData.CURRENT_EDGE]);
      if (currentEdgeIdx < 1) continue;

      // Pick random src & dest stations (different from each other)
      const stationCount = this.stations.length;
      const srcStationIdx = Math.floor(Math.random() * stationCount);
      let destStationIdx = Math.floor(Math.random() * (stationCount - 1));
      if (destStationIdx >= srcStationIdx) destStationIdx++;

      const srcStation = this.stations[srcStationIdx];
      const destStation = this.stations[destStationIdx];

      // Clear existing path + obsolete locks, then assign src station route
      transferMgr.clearVehiclePath(vehId);
      if (lockMgr) {
        this.cancelObsoleteLocks(vehId, [], edgeArray, lockMgr);
      }

      const assigned = this.assignToStation(
        vehId, srcStation, currentEdgeIdx,
        vehicleDataArray, edgeArray, edgeNameToIndex, transferMgr, lockMgr
      );
      if (!assigned) continue;

      // Set MOVE_TO_LOAD state + store src & dest for phases
      this.transferringVehicles.add(vehId);
      this.pendingSrcStation.set(vehId, srcStation);
      this.pendingDestStation.set(vehId, destStation);
      const orderId = this.nextOrderId++;
      data[ptr + LogicData.JOB_STATE] = JobState.MOVE_TO_LOAD;
      data[ptr + OrderData.ORDER_ID] = orderId;
      data[ptr + OrderData.ORDER_SRC_STATION] = srcStationIdx + 1;  // 1-based
      data[ptr + OrderData.ORDER_DEST_STATION] = destStationIdx + 1; // 1-based
      data[ptr + OrderData.MOVE_TO_PICKUP_TS] = simulationTime;

      // Deduct throughput credit
      if (ctx.transferRateMode === 'throughput') {
        this.throughputCredit -= 1;
      }
    }

    // 할당량이 가득 찼으면 5초 쿨다운
    if (quotaFull) {
      this.transferCheckCooldown = 5.0;
    }
  }

  /**
   * 가동률/물량 기준으로 반송 할당 가능 여부 판정
   */
  private shouldAssignTransfer(ctx: AutoMgrUpdateContext): boolean {
    const transferCount = this.transferringVehicles.size;

    if (ctx.transferRateMode === 'utilization') {
      const currentUtil = (transferCount / ctx.numVehicles) * 100;
      return currentUtil < ctx.transferUtilizationPercent;
    }

    if (ctx.transferRateMode === 'throughput') {
      this.throughputCredit += ctx.dt * (ctx.transferThroughputPerHour / 3600);
      this.throughputCredit = Math.min(this.throughputCredit, 10); // burst cap
      return this.throughputCredit >= 1;
    }

    return false;
  }

  /**
   * 교체 가능 판정: reservedNextEdges가 남아있으면 lock 잡혀있을 수 있으므로 불가
   */
  private isSwappable(vehId: number, transferMgr: TransferMgr): boolean {
    return !transferMgr.hasReservedNextEdges(vehId);
  }

  /**
   * 특정 station으로 경로를 찾아 차량에 적용
   */
  private assignToStation(
    vehId: number,
    station: StationTarget,
    currentEdgeIdx: number,
    vehicleDataArray: IVehicleDataArray,
    edgeArray: Edge[],
    edgeNameToIndex: Map<string, number>,
    transferMgr: TransferMgr,
    lockMgr?: LockMgr
  ): boolean {
    if (currentEdgeIdx < 1) return false;

    const ptr = vehId * VEHICLE_DATA_SIZE;
    const data = vehicleDataArray.getData();
    const currentRatio = data[ptr + MovementData.EDGE_RATIO];

    if (currentEdgeIdx === station.edgeIndex) {
      if (station.ratio >= currentRatio) {
        // Already on the target edge and station is ahead. Move forward.
        transferMgr.clearVehiclePath(vehId);
        if (lockMgr) {
          this.cancelObsoleteLocks(vehId, [currentEdgeIdx], edgeArray, lockMgr);
        }
        this.vehicleDestinations.set(vehId, station);

        data[ptr + MovementData.TARGET_RATIO] = station.ratio;

        const currentStatus = data[ptr + MovementData.MOVING_STATUS];
        if (currentStatus === MovingStatus.STOPPED) {
          data[ptr + MovementData.MOVING_STATUS] = MovingStatus.MOVING;
        }

        return true;
      } else {
        // Station is behind us on the same edge. We must loop around.
        const currentEdge = edgeArray[currentEdgeIdx - 1];
        if (!currentEdge || !currentEdge.nextEdgeIndices || currentEdge.nextEdgeIndices.length === 0) {
          return false; // Cannot loop around if there's no next edge
        }

        let bestPath: number[] | null = null;
        for (const nextIdx of currentEdge.nextEdgeIndices) {
          this.pathFindCountThisFrame++;
          const p = findShortestPath(nextIdx, station.edgeIndex, edgeArray, this.routingContext);
          if (p && p.length > 0) {
            // We found a loop back to the current edge
            if (!bestPath || p.length < bestPath.length - 1) {
              bestPath = [currentEdgeIdx, ...p];
            }
          }
        }

        if (!bestPath) return false;

        this.applyPathToVehicle({
          vehId,
          pathIndices: bestPath,
          candidate: station,
          vehicleDataArray,
          edgeArray,
          edgeNameToIndex,
          transferMgr,
          lockMgr,
        });
        return true;
      }
    }

    this.pathFindCountThisFrame++;
    const pathIndices = findShortestPath(currentEdgeIdx, station.edgeIndex, edgeArray, this.routingContext);
    if (!pathIndices || pathIndices.length === 0) return false;

    this.applyPathToVehicle({
      vehId,
      pathIndices,
      candidate: station,
      vehicleDataArray,
      edgeArray,
      edgeNameToIndex,
      transferMgr,
      lockMgr,
    });
    return true;
  }

  /**
   * Check for edge transitions and reroute vehicles that have traveled rerouteInterval edges.
   */
  private checkReroutes(
    numVehicles: number,
    vehicleDataArray: IVehicleDataArray,
    edgeArray: Edge[],
    edgeNameToIndex: Map<string, number>,
    transferMgr: TransferMgr,
    lockMgr?: LockMgr,
  ): void {
    const data = vehicleDataArray.getData();

    for (let vehId = 0; vehId < numVehicles; vehId++) {
      if (this.pathFindCountThisFrame >= MAX_PATH_FINDS_PER_FRAME) break;

      const ptr = vehId * VEHICLE_DATA_SIZE;
      const currentEdge = Math.trunc(data[ptr + MovementData.CURRENT_EDGE]);
      if (currentEdge < 1) continue;

      const prevEdge = this.lastEdge.get(vehId) ?? 0;
      this.lastEdge.set(vehId, currentEdge);

      // No transition
      if (currentEdge === prevEdge || prevEdge === 0) continue;

      // Edge transition detected — increment counter
      const count = (this.edgesSinceReroute.get(vehId) ?? 0) + 1;

      if (count < this.rerouteInterval) {
        this.edgesSinceReroute.set(vehId, count);
        continue;
      }

      // Reroute threshold reached
      this.edgesSinceReroute.set(vehId, 0);

      // Only reroute if vehicle has a destination
      const dest = this.vehicleDestinations.get(vehId);
      if (!dest) continue;
      // Skip if already at destination
      if (currentEdge === dest.edgeIndex) continue;

      // Skip reroute for vehicles at station (pre-loaded path must be preserved)
      const jobState = data[ptr + LogicData.JOB_STATE];
      if (jobState === JobState.LOADING || jobState === JobState.UNLOADING) continue;
      // MOVE_TO_LOAD on src station edge: pre-loaded dest path, don't reroute
      if (jobState === JobState.MOVE_TO_LOAD && !this.pendingSrcStation.has(vehId)) continue;
      // MOVE_TO_UNLOAD on dest station edge: pre-loaded loop path, don't reroute
      if (jobState === JobState.MOVE_TO_UNLOAD && this.dwellTimers.has(vehId)) continue;

      this.pathFindCountThisFrame++;
      const pathIndices = findShortestPath(currentEdge, dest.edgeIndex, edgeArray, this.routingContext);
      if (!pathIndices || pathIndices.length <= 1) continue;

      // Path change detection (oscillation tracking)
      const prevPath = this.lastPath.get(vehId);
      if (prevPath && !pathsEqual(prevPath, pathIndices)) {
        this.pathChangeCount.set(vehId, (this.pathChangeCount.get(vehId) ?? 0) + 1);
      }
      this.lastPath.set(vehId, pathIndices.slice());

      this.applyPathToVehicle({
        vehId,
        pathIndices,
        candidate: dest,
        vehicleDataArray,
        edgeArray,
        edgeNameToIndex,
        transferMgr,
        lockMgr,
      });
    }
  }

  /**
   * AUTO_ROUTE: 랜덤 station 목적지 할당
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

    // 디버그: STOPPED + 경로 없음 감지
    const movingStatus = data[ptr + MovementData.MOVING_STATUS];
    const nextEdgeState = data[ptr + MovementData.NEXT_EDGE_STATE];
    if (movingStatus === MovingStatus.STOPPED && nextEdgeState === NextEdgeState.EMPTY) {
      console.warn(
        `[AutoMgr] veh${vehId} idle+stopped: edge=${currentEdgeIdx} ratio=${data[ptr + MovementData.EDGE_RATIO].toFixed(2)} → assigning new route`
      );
    }

    // Assign random destination
    return this.assignRandomDestination(vehId, currentEdgeIdx, vehicleDataArray, edgeArray, edgeNameToIndex, transferMgr, lockMgr);
  }

  /**
   * LOOP: bay 순환 목적지 할당
   * phase에 따라:
   *   INIT → edge1으로 이동 → TO_E1
   *   TO_E1 도착 → edge2로 이동 → TO_E2
   *   TO_E2 도착 → edge1으로 이동 → TO_E1
   */
  private checkAndAssignLoopRoute(
    vehId: number,
    vehicleDataArray: IVehicleDataArray,
    edgeArray: Edge[],
    edgeNameToIndex: Map<string, number>,
    transferMgr: TransferMgr,
    lockMgr: LockMgr | undefined,
    vehicleBayLoopMap: Map<number, VehicleBayLoop>
  ): boolean {
    if (transferMgr.hasPendingCommands(vehId)) return false;

    const loopInfo = vehicleBayLoopMap.get(vehId);
    if (!loopInfo) return false;

    const data = vehicleDataArray.getData();
    const ptr = vehId * VEHICLE_DATA_SIZE;
    const currentEdgeIdx = Math.trunc(data[ptr + MovementData.CURRENT_EDGE]);

    // phase에 따라 목적지 결정
    let destEdgeIdx: number;
    let nextPhase: VehicleBayLoop['phase'];

    if (loopInfo.phase === 'INIT' || loopInfo.phase === 'TO_E1') {
      // edge1으로 가야 함 (INIT은 처음 시작, TO_E1은 edge2에서 돌아옴)
      destEdgeIdx = loopInfo.edge1Idx;
      nextPhase = 'TO_E2'; // edge1 도착 후 다음은 edge2로
    } else {
      // TO_E2: edge2로 가야 함
      destEdgeIdx = loopInfo.edge2Idx;
      nextPhase = 'TO_E1'; // edge2 도착 후 다음은 edge1로
    }

    // 이미 목적지 edge에 있으면 phase만 전환
    if (currentEdgeIdx === destEdgeIdx) {
      loopInfo.phase = nextPhase;
      // 즉시 다음 목적지로 재귀 호출
      return this.checkAndAssignLoopRoute(
        vehId, vehicleDataArray, edgeArray, edgeNameToIndex, transferMgr, lockMgr, vehicleBayLoopMap
      );
    }

    this.pathFindCountThisFrame++;

    const pathIndices = findShortestPath(currentEdgeIdx, destEdgeIdx, edgeArray, this.routingContext);
    if (!pathIndices || pathIndices.length === 0) return false;

    const destEdge = edgeArray[destEdgeIdx - 1];
    const candidate = {
      name: destEdge ? `${loopInfo.bayName}:${destEdge.edge_name}` : loopInfo.bayName,
      edgeIndex: destEdgeIdx,
      ratio: 0.5
    };

    this.applyPathToVehicle({
      vehId, pathIndices, candidate,
      vehicleDataArray, edgeArray, edgeNameToIndex, transferMgr, lockMgr,
    });

    // phase 전환
    loopInfo.phase = nextPhase;

    return true;
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

    // Random offset + linear scan: 중복 선택 없이 최대 stations.length개 시도
    const stationCount = this.stations.length;
    const startOffset = Math.floor(Math.random() * stationCount);
    const maxAttempts = Math.min(stationCount, 5);

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const candidate = this.stations[(startOffset + attempt) % stationCount];

      // Skip if same as current edge (unless it's the only one)
      if (candidate.edgeIndex === currentEdgeIdx && stationCount > 1) {
        continue;
      }

      // Increment path find counter BEFORE calling findShortestPath
      this.pathFindCountThisFrame++;

      // Pathfinding
      const pathIndices = findShortestPath(currentEdgeIdx, candidate.edgeIndex, edgeArray, this.routingContext);

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

  /**
   * 경로를 차량에 적용
   */
  private applyPathToVehicle(ctx: ApplyPathContext): void {
    const { vehId, pathIndices, candidate, vehicleDataArray, edgeArray, edgeNameToIndex, transferMgr, lockMgr } = ctx;
    // 경로 변경 전에 새 경로에 없는 락 취소
    if (lockMgr) {
      this.cancelObsoleteLocks(vehId, pathIndices, edgeArray, lockMgr);
    }

    const pathCommand = this.constructPathCommand(pathIndices, edgeArray, candidate.ratio);
    const command: VehicleCommand = { path: pathCommand };

    this.vehicleDestinations.set(vehId, candidate);

    // Path 발견 로그
    this.onPathFound?.(vehId, candidate.edgeIndex, pathIndices.length);

    // Update Shared Memory for UI
    const ptr = vehId * VEHICLE_DATA_SIZE;
    const data = vehicleDataArray.getData();
    if (data) {
      data[ptr + LogicData.DESTINATION_EDGE] = candidate.edgeIndex;
      data[ptr + LogicData.PATH_REMAINING] = pathCommand.length;
    }

    transferMgr.assignCommand(vehId, command, vehicleDataArray, edgeArray, edgeNameToIndex, lockMgr);
  }

  /**
   * Pre-load dest path into pathBuffer when vehicle enters src station edge.
   * This ensures merge locks after the station are acquired before the vehicle departs.
   */
  private preloadNextPath(
    vehId: number,
    srcStation: StationTarget,
    destStation: StationTarget,
    vehicleDataArray: IVehicleDataArray,
    edgeArray: Edge[],
    edgeNameToIndex: Map<string, number>,
    transferMgr: TransferMgr,
    lockMgr?: LockMgr
  ): void {
    this.pathFindCountThisFrame++;
    const pathIndices = findShortestPath(srcStation.edgeIndex, destStation.edgeIndex, edgeArray, this.routingContext);
    if (!pathIndices || pathIndices.length === 0) return;

    // Apply path: pathBuffer = [src+1..dest], checkpoint includes merge locks
    this.applyPathToVehicle({
      vehId,
      pathIndices,
      candidate: destStation,
      vehicleDataArray,
      edgeArray,
      edgeNameToIndex,
      transferMgr,
      lockMgr,
    });
  }

  /**
   * Pre-load loop path into pathBuffer when vehicle enters dest station edge.
   * This ensures merge locks after the dropoff station are acquired before the vehicle departs.
   */
  private preloadLoopPath(
    vehId: number,
    destStation: StationTarget,
    vehicleDataArray: IVehicleDataArray,
    edgeArray: Edge[],
    edgeNameToIndex: Map<string, number>,
    transferMgr: TransferMgr,
    lockMgr?: LockMgr
  ): void {
    // Find a random loop destination (any station different from current)
    if (this.stations.length === 0) return;
    const stationCount = this.stations.length;
    const startOffset = Math.floor(Math.random() * stationCount);
    let loopDest: StationTarget | null = null;

    for (let i = 0; i < stationCount; i++) {
      const candidate = this.stations[(startOffset + i) % stationCount];
      if (candidate.edgeIndex !== destStation.edgeIndex || stationCount === 1) {
        loopDest = candidate;
        break;
      }
    }
    if (!loopDest) return;

    this.pathFindCountThisFrame++;
    const pathIndices = findShortestPath(destStation.edgeIndex, loopDest.edgeIndex, edgeArray, this.routingContext);
    if (!pathIndices || pathIndices.length === 0) return;

    this.applyPathToVehicle({
      vehId,
      pathIndices,
      candidate: loopDest,
      vehicleDataArray,
      edgeArray,
      edgeNameToIndex,
      transferMgr,
      lockMgr,
    });
  }

  /**
   * Dispose all internal data to allow garbage collection
   */
  /** Order completion stats for KPI reporting */
  getOrderStats(): { completed: number; leadTimes: number[]; resetSimTime: number } {
    return this.orderStats;
  }

  /** Reset order stats (for skipping warmup period) */
  resetOrderStats(simulationTime: number): void {
    this.orderStats = { completed: 0, leadTimes: [], resetSimTime: simulationTime };
    this.pathChangeCount.clear();
  }

  /** Total path changes across all vehicles (oscillation measurement) */
  getTotalPathChanges(): number {
    let total = 0;
    for (const count of this.pathChangeCount.values()) total += count;
    return total;
  }

  /** Per-vehicle path change counts */
  getPathChangeCount(): Map<number, number> {
    return this.pathChangeCount;
  }

  dispose(): void {
    this.stations = [];
    this.vehicleDestinations.clear();
    this.transferringVehicles.clear();
    this.dwellTimers.clear();
    this.pendingDestStation.clear();
    this.pendingSrcStation.clear();
    this.actualDestStation.clear();
    this.throughputCredit = 0;
    this.transferCheckCooldown = 0;
    this.lastPath.clear();
    this.pathChangeCount.clear();
  }

  private constructPathCommand(pathIndices: number[], edgeArray: Edge[], finalRatio?: number): Array<{ edgeId: string; targetRatio?: number }> {
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
        targetRatio: isLast ? (finalRatio ?? 0.5) : undefined
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

    for (const nodeName of locksToCancel) {
      lockMgr.cancelLock(nodeName, vehId);
    }
  }
}

function pathsEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
