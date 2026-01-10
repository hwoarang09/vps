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

interface StationTarget {
  name: string;
  edgeIndex: number;
  regionId?: number;  // 어떤 연결 구역에 속하는지
}

// Maximum number of path findings per frame to prevent spikes
const MAX_PATH_FINDS_PER_FRAME = 10;

export class AutoMgr {
  private stations: StationTarget[] = [];
  // Vehicle ID -> Current Destination info
  private readonly vehicleDestinations: Map<number, { stationName: string, edgeIndex: number }> = new Map();
  // Edge -> Region ID mapping (which region an edge belongs to)
  private readonly edgeToRegion: Map<number, number> = new Map();
  // Region ID -> stations in that region
  private readonly regionStations: Map<number, StationTarget[]> = new Map();
  // Round-robin index for fair vehicle processing
  private nextVehicleIndex = 0;
  // Path finding count in current frame
  private pathFindCountThisFrame = 0;

  /**
   * Initializes available stations for routing.
   * Called once at startup.
   */
  initStations(stationData: StationRawData[], edgeNameToIndex: Map<string, number>, edgeArray?: Edge[]) {
    this.stations = [];
    this.edgeToRegion.clear();
    this.regionStations.clear();

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
    // 구역 매핑 및 스테이션 분류
    if (edgeArray && this.stations.length > 0) {
      this.buildRegionMapping(edgeArray);
    }
  }

  /**
   * 구역 매핑 빌드 - 각 edge가 어느 구역에 속하는지 계산
   * BFS로 연결된 edge들을 같은 구역으로 분류
   */
  private buildRegionMapping(edgeArray: Edge[]) {
    // 1. 역방향 인덱스 구축
    const prevEdges = this.buildReverseEdgeIndex(edgeArray);

    // 2. BFS로 edge들을 구역에 할당
    this.assignEdgesToRegions(edgeArray, prevEdges);

    // 3. 스테이션을 구역별로 분류
    this.classifyStationsByRegion();
  }

  /**
   * 역방향 edge 인덱스 구축 (O(E))
   * @returns prevEdges[i] = i로 들어오는 edge들의 목록
   */
  private buildReverseEdgeIndex(edgeArray: Edge[]): number[][] {
    const prevEdges: number[][] = Array.from({ length: edgeArray.length }, () => []);
    
    for (let i = 0; i < edgeArray.length; i++) {
      const nextIndices = edgeArray[i]?.nextEdgeIndices || [];
      for (const next of nextIndices) {
        if (next < prevEdges.length) {
          prevEdges[next].push(i);
        }
      }
    }
    
    return prevEdges;
  }

  /**
   * BFS로 연결된 edge들을 같은 구역으로 분류
   */
  private assignEdgesToRegions(edgeArray: Edge[], prevEdges: number[][]): void {
    const visited = new Set<number>();
    let regionId = 0;

    for (let startEdge = 0; startEdge < edgeArray.length; startEdge++) {
      if (visited.has(startEdge)) continue;

      // 새 구역 시작 - BFS 수행
      this.exploreRegion(startEdge, regionId, edgeArray, prevEdges, visited);
      regionId++;
    }
  }

  /**
   * BFS로 하나의 구역 탐색
   */
  private exploreRegion(
    startEdge: number,
    regionId: number,
    edgeArray: Edge[],
    prevEdges: number[][],
    visited: Set<number>
  ): void {
    const queue: number[] = [startEdge];
    visited.add(startEdge);

    while (queue.length > 0) {
      const current = queue.shift()!;
      this.edgeToRegion.set(current, regionId);

      // 정방향 탐색
      const nextEdges = edgeArray[current]?.nextEdgeIndices || [];
      for (const next of nextEdges) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }

      // 역방향 탐색
      for (const prev of prevEdges[current]) {
        if (!visited.has(prev)) {
          visited.add(prev);
          queue.push(prev);
        }
      }
    }
  }

  /**
   * 스테이션을 구역별로 분류
   */
  private classifyStationsByRegion(): void {
    for (const station of this.stations) {
      const region = this.edgeToRegion.get(station.edgeIndex);
      if (region !== undefined) {
        station.regionId = region;

        if (!this.regionStations.has(region)) {
          this.regionStations.set(region, []);
        }
        this.regionStations.get(region)!.push(station);
      }
    }
  }

  /**
   * 특정 edge가 속한 구역의 스테이션들 반환
   */
  getStationsForEdge(edgeIndex: number): StationTarget[] {
    const region = this.edgeToRegion.get(edgeIndex);
    if (region === undefined) return this.stations; // fallback
    return this.regionStations.get(region) || [];
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
    transferMgr: TransferMgr
  ) {
    if (mode !== TransferMode.AUTO_ROUTE) return;
    if (numVehicles === 0) return;

    // Reset per-frame counter
    this.pathFindCountThisFrame = 0;

    // Process vehicles in round-robin fashion with limit
    const startIndex = this.nextVehicleIndex;
    let processedCount = 0;

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
        transferMgr
      );

      processedCount++;

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
    transferMgr: TransferMgr
  ): boolean {
    if (transferMgr.hasPendingCommands(vehId)) return false;

    const data = vehicleDataArray.getData();
    const ptr = vehId * VEHICLE_DATA_SIZE;
    const currentEdgeIdx = Math.trunc(data[ptr + MovementData.CURRENT_EDGE]);

    // Assign random destination
    return this.assignRandomDestination(vehId, currentEdgeIdx, vehicleDataArray, edgeArray, edgeNameToIndex, transferMgr);
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
    transferMgr: TransferMgr
  ): boolean {
    // Get stations for the region this edge belongs to
    const availableStations = this.getStationsForEdge(currentEdgeIdx);

    if (availableStations.length === 0) {
      return false;
    }

    const MAX_ATTEMPTS = 5;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      // Pick random station from same region
      const candidate = availableStations[Math.floor(Math.random() * availableStations.length)];

      // Skip if same as current edge (unless it's the only one)
      if (candidate.edgeIndex === currentEdgeIdx && availableStations.length > 1) {
        continue;
      }

      // Increment path find counter BEFORE calling findShortestPath
      this.pathFindCountThisFrame++;

      // Pathfinding
      const pathIndices = findShortestPath(currentEdgeIdx, candidate.edgeIndex, edgeArray);

      if (pathIndices && pathIndices.length > 0) {
        const pathCommand = this.constructPathCommand(pathIndices, edgeArray);

        // Assign
        const command: VehicleCommand = {
          path: pathCommand
        };

        this.vehicleDestinations.set(vehId, { stationName: candidate.name, edgeIndex: candidate.edgeIndex });

        // Update Shared Memory for UI
        const ptr = vehId * VEHICLE_DATA_SIZE;
        const data = vehicleDataArray.getData();
        if (data) {
          data[ptr + LogicData.DESTINATION_EDGE] = candidate.edgeIndex;
          data[ptr + LogicData.PATH_REMAINING] = pathCommand.length;
        }

        transferMgr.assignCommand(vehId, command, vehicleDataArray, edgeArray, edgeNameToIndex);
        return true;
      }
    }

    return false;
  }

  getDestinationInfo(vehId: number) {
    return this.vehicleDestinations.get(vehId);
  }

  /**
   * Dispose all internal data to allow garbage collection
   */
  dispose(): void {
    this.stations = [];
    this.vehicleDestinations.clear();
    this.edgeToRegion.clear();
    this.regionStations.clear();
  }

  private constructPathCommand(pathIndices: number[], edgeArray: Edge[]): Array<{ edgeId: string; targetRatio?: number }> {
    const pathCommand: Array<{ edgeId: string; targetRatio?: number }> = [];

    // Construct command from path (start from 1 as 0 is current edge)
    for (let i = 1; i < pathIndices.length; i++) {
      const idx = pathIndices[i];
      const edge = edgeArray[idx];
      const isLast = (i === pathIndices.length - 1);

      pathCommand.push({
        edgeId: edge.edge_name,
        targetRatio: isLast ? 0.5 : undefined
      });
    }

    return pathCommand;
  }
}
