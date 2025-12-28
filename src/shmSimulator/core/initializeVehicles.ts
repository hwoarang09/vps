// shmSimulator/core/initializeVehicles.ts

import VehicleDataArray, {
  SensorData,
  MovementData,
  NextEdgeState,
  VEHICLE_DATA_SIZE,
  MovingStatus,
} from "../memory/vehicleDataArray";
import SensorPointArray from "../memory/sensorPointArray";
import EdgeVehicleQueue from "../memory/edgeVehicleQueue";
import { EngineStore } from "./EngineStore";
import { LockMgr } from "../logic/LockMgr";
import { PresetIndex } from "../memory/sensorPresets";
import { updateSensorPoints } from "../helpers/sensorPoints";
import type { Edge } from "@/types/edge";
import type { Node } from "@/types";
import { EdgeType } from "@/types";
import type { SimulationConfig, VehicleInitConfig } from "../types";

export interface VehiclePlacement {
  vehicleIndex: number;
  edgeName: string;
  x: number;
  y: number;
  z: number;
  rotation: number;
  edgeRatio: number;
}

export interface InitializationResult {
  edgeNameToIndex: Map<string, number>;
  edgeArray: Edge[];
  actualNumVehicles: number;
}

export interface InitializeVehiclesParams {
  edges: Edge[];
  nodes: Node[];
  numVehicles: number;
  vehicleConfigs: VehicleInitConfig[];
  store: EngineStore;
  lockMgr: LockMgr;
  sensorPointArray: SensorPointArray;
  config: SimulationConfig;
}

export function initializeVehicles(params: InitializeVehiclesParams): InitializationResult {
  const { edges, nodes, numVehicles, vehicleConfigs, store, lockMgr, sensorPointArray, config } = params;

  console.log(`[shmSimulator] Initializing ${numVehicles} vehicles...`);

  const vehicleDataArray = store.getVehicleDataArray();
  const edgeVehicleQueue = store.getEdgeVehicleQueue();
  const directData = vehicleDataArray.getData();

  const edgeArray = edges;
  const nameToIndex = new Map<string, number>();
  for (let idx = 0; idx < edgeArray.length; idx++) {
    nameToIndex.set(edgeArray[idx].edge_name, idx);
  }

  // Calculate placements (simple auto-placement)
  const placements = calculateSimplePlacements(numVehicles, edgeArray, config.vehicleZOffset);

  // Initialize vehicle state
  const edgeVehicleCount = new Map<number, number>();

  // Build node lookup map
  const nodeNameToIndex = new Map<string, number>();
  for (let idx = 0; idx < nodes.length; idx++) {
    nodeNameToIndex.set(nodes[idx].node_name, idx);
  }

  for (const placement of placements) {
    const edgeIndex = nameToIndex.get(placement.edgeName);
    if (edgeIndex === undefined) continue;

    const edge = edgeArray[edgeIndex];
    const isCurve = edge.vos_rail_type !== EdgeType.LINEAR;
    const initialVelocity = isCurve ? config.curveMaxSpeed : 0;

    // Use vehicleConfigs if provided, otherwise use config defaults
    const vehConfig = vehicleConfigs[placement.vehicleIndex] || vehicleConfigs[0] || {
      acceleration: config.linearAcceleration,
      deceleration: config.linearDeceleration,
      maxSpeed: config.linearMaxSpeed,
    };

    store.addVehicle(placement.vehicleIndex, {
      x: placement.x,
      y: placement.y,
      z: placement.z,
      edgeIndex: edgeIndex,
      edgeRatio: placement.edgeRatio,
      rotation: placement.rotation,
      velocity: initialVelocity,
      acceleration: vehConfig.acceleration,
      deceleration: vehConfig.deceleration,
      movingStatus: MovingStatus.MOVING,
    });

    // Initialize sensor preset
    const ptr = placement.vehicleIndex * VEHICLE_DATA_SIZE;
    directData[ptr + SensorData.PRESET_IDX] = PresetIndex.STRAIGHT;
    directData[ptr + SensorData.HIT_ZONE] = -1;
    directData[ptr + MovementData.NEXT_EDGE] = -1;
    directData[ptr + MovementData.NEXT_EDGE_STATE] = NextEdgeState.EMPTY;

    updateSensorPoints(
      sensorPointArray,
      placement.vehicleIndex,
      placement.x,
      placement.y,
      placement.rotation,
      PresetIndex.STRAIGHT,
      config
    );

    edgeVehicleCount.set(edgeIndex, (edgeVehicleCount.get(edgeIndex) || 0) + 1);
  }

  // Sort vehicles in each edge by edgeRatio
  for (const [edgeIdx, _] of edgeVehicleCount) {
    edgeVehicleQueue.sortByEdgeRatio(edgeIdx, directData);
  }

  // Process merge edge locks
  for (const [edgeIdx, _] of edgeVehicleCount) {
    const edge = edgeArray[edgeIdx];

    if (lockMgr.isMergeNode(edge.to_node)) {
      const vehiclesOnEdge = edgeVehicleQueue.getVehicles(edgeIdx);

      for (const vehId of vehiclesOnEdge) {
        lockMgr.requestLock(edge.to_node, edge.edge_name, vehId);
      }
    }
  }

  store.setActualNumVehicles(placements.length);

  console.log(`[shmSimulator] Initialized ${placements.length} vehicles`);

  return {
    edgeNameToIndex: nameToIndex,
    edgeArray: edgeArray,
    actualNumVehicles: placements.length,
  };
}

function calculateSimplePlacements(
  numVehicles: number,
  edges: Edge[],
  vehicleZOffset: number
): VehiclePlacement[] {
  const placements: VehiclePlacement[] = [];
  let vehicleIndex = 0;

  // Simple placement: distribute vehicles evenly across LINEAR edges
  const linearEdges = edges.filter((e) => e.vos_rail_type === EdgeType.LINEAR);

  if (linearEdges.length === 0) {
    console.warn("[shmSimulator] No LINEAR edges found for placement");
    return placements;
  }

  const vehiclesPerEdge = Math.ceil(numVehicles / linearEdges.length);

  for (const edge of linearEdges) {
    if (vehicleIndex >= numVehicles) break;

    const points = edge.renderingPoints;
    if (!points || points.length < 2) continue;

    const startPoint = points[0];
    const endPoint = points[points.length - 1];

    const edgeCapacity = Math.min(vehiclesPerEdge, numVehicles - vehicleIndex);
    const spacing = 1.0 / (edgeCapacity + 1);

    for (let j = 0; j < edgeCapacity; j++) {
      const ratio = spacing * (j + 1);

      const x = startPoint.x + (endPoint.x - startPoint.x) * ratio;
      const y = startPoint.y + (endPoint.y - startPoint.y) * ratio;
      const z = vehicleZOffset;

      const dx = endPoint.x - startPoint.x;
      const dy = endPoint.y - startPoint.y;
      let rotation = 0;
      if (Math.abs(dx) >= Math.abs(dy)) {
        rotation = dx >= 0 ? 0 : 180;
      } else {
        rotation = dy >= 0 ? 90 : -90;
      }

      placements.push({
        vehicleIndex,
        edgeName: edge.edge_name,
        x,
        y,
        z,
        rotation,
        edgeRatio: ratio,
      });

      vehicleIndex++;
    }
  }

  return placements;
}
