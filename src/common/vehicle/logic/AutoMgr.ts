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

export class AutoMgr {
  private stations: StationTarget[] = [];
  // Vehicle ID -> Current Destination info
  private readonly vehicleDestinations: Map<number, { stationName: string, edgeIndex: number }> = new Map();
  // Edge -> Region ID 매핑 (어떤 구역에 속하는지)
  private readonly edgeToRegion: Map<number, number> = new Map();
  // Region ID -> 해당 구역의 스테이션들
  private readonly regionStations: Map<number, StationTarget[]> = new Map();

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

    for (let vehId = 0; vehId < numVehicles; vehId++) {
      this.checkAndAssignRoute(vehId, vehicleDataArray, edgeArray, edgeNameToIndex, transferMgr);
    }
  }

  /**
   * Checks a specific vehicle and assigns a route if:
   * 1. It has no pending commands (idle or finished path).
   * 2. It is stopped or moving on the last edge.
   */
  private checkAndAssignRoute(
    vehId: number,
    vehicleDataArray: IVehicleDataArray,
    edgeArray: Edge[],
    edgeNameToIndex: Map<string, number>,
    transferMgr: TransferMgr
  ) {
    if (transferMgr.hasPendingCommands(vehId)) return;

    const data = vehicleDataArray.getData();
    const ptr = vehId * VEHICLE_DATA_SIZE;
    const currentEdgeIdx = Math.trunc(data[ptr + MovementData.CURRENT_EDGE]);

    // Assign random destination
    this.assignRandomDestination(vehId, currentEdgeIdx, vehicleDataArray, edgeArray, edgeNameToIndex, transferMgr);
  }

  assignRandomDestination(
    vehId: number,
    currentEdgeIdx: number,
    vehicleDataArray: IVehicleDataArray,
    edgeArray: Edge[],
    edgeNameToIndex: Map<string, number>,
    transferMgr: TransferMgr
  ) {
    // 현재 edge가 속한 구역의 스테이션만 선택
    const availableStations = this.getStationsForEdge(currentEdgeIdx);

    if (availableStations.length === 0) {
      // 해당 구역에 스테이션이 없으면 조용히 실패
      return;
    }

    const MAX_ATTEMPTS = 5;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        // Pick random station from same region
        const candidate = availableStations[Math.floor(Math.random() * availableStations.length)];

        // Skip if same as current edge (unless it's the only one)
        if (candidate.edgeIndex === currentEdgeIdx && availableStations.length > 1) {
            continue;
        }

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
            return;
        }
    }
  }

  getDestinationInfo(vehId: number) {
    return this.vehicleDestinations.get(vehId);
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
