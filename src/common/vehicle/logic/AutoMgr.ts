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
}

export class AutoMgr {
  private stations: StationTarget[] = [];
  // Vehicle ID -> Current Destination info
  private readonly vehicleDestinations: Map<number, { stationName: string, edgeIndex: number }> = new Map();

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
    console.log(`[AutoMgr] Initialized with ${this.stations.length} valid stations.`);
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
    if (this.stations.length === 0) return;

    const MAX_ATTEMPTS = 5;
    
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        // Pick random station
        let candidate = this.stations[Math.floor(Math.random() * this.stations.length)];
        
        // Skip if same as current edge (unless it's the only one)
        if (candidate.edgeIndex === currentEdgeIdx && this.stations.length > 1) {
            continue;
        }

        // Pathfinding
        const pathIndices = findShortestPath(currentEdgeIdx, candidate.edgeIndex, edgeArray);
        
        if (pathIndices && pathIndices.length > 0) {
             const pathCommand: Array<{ edgeId: string; targetRatio?: number }> = [];

            // Construct command from path
            for (let i = 1; i < pathIndices.length; i++) {
                const idx = pathIndices[i];
                const edge = edgeArray[idx];
                const isLast = (i === pathIndices.length - 1);
                
                pathCommand.push({
                    edgeId: edge.edge_name,
                    targetRatio: isLast ? 0.5 : undefined 
                });
            }

            // Assign
             const command: VehicleCommand = {
                path: pathCommand
            };
            
            console.log(`[AutoMgr] Assigned Veh ${vehId} -> ${candidate.name} (${pathCommand.length} hops)`);
            this.vehicleDestinations.set(vehId, { stationName: candidate.name, edgeIndex: candidate.edgeIndex });

            // Update Shared Memory for UI
             const ptr = vehId * VEHICLE_DATA_SIZE;
             const data = vehicleDataArray.getData();
             if (data) {
                data[ptr + LogicData.DESTINATION_EDGE] = candidate.edgeIndex;
                data[ptr + LogicData.PATH_REMAINING] = pathCommand.length;
             }

            transferMgr.assignCommand(vehId, command, vehicleDataArray, edgeArray, edgeNameToIndex);
            return; // Success
        }
    }

    // Failed after retries
    console.warn(`[AutoMgr] Failed to find path for Veh ${vehId} after ${MAX_ATTEMPTS} attempts`);
  }

  getDestinationInfo(vehId: number) {
    return this.vehicleDestinations.get(vehId);
  }
}
