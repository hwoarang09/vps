import { Edge, VehicleConfig } from "../../types";

const EDGE_MIN_LENGTH = 5;
const NODE_MARGIN = 2;
const VEHICLE_SPACING = 2;

export interface VehiclePlacement {
  vehicleIndex: number;
  x: number;
  y: number;
  z: number;
  rotation: number;
  edgeName: string;
  edgeRatio: number;
}

export interface VehiclePlacementResult {
  placements: VehiclePlacement[];
  maxCapacity: number;
}

const calculateEdgeSpots = (edgeLength: number): number[] => {
  if (edgeLength < EDGE_MIN_LENGTH) return [];
  
  const startPos = NODE_MARGIN;
  const endPos = edgeLength - NODE_MARGIN;
  if (startPos > endPos) return [];

  const spots: number[] = [];
  for (let pos = startPos; pos <= endPos; pos += VEHICLE_SPACING) {
    spots.push(pos);
  }
  return spots;
};

/**
 * Create vehicle placements from vehicle config file (vehicles.cfg)
 */
export const createPlacementsFromVehicleConfigs = (
  vehicleConfigs: VehicleConfig[],
  allEdges: Edge[]
): VehiclePlacement[] => {
  const placements: VehiclePlacement[] = [];

  const edgeMap = new Map<string, Edge>();
  for (const edge of allEdges) {
    edgeMap.set(edge.edge_name, edge);
  }

  for (let index = 0; index < vehicleConfigs.length; index++) {
    const config = vehicleConfigs[index];
    const edge = edgeMap.get(config.edgeName);
    if (!edge) {
      console.warn(`[VehiclePlacement] Edge ${config.edgeName} not found for vehicle ${config.vehId}`);
      continue;
    }

    const points = edge.renderingPoints || [];
    if (points.length < 2) {
      console.warn(`[VehiclePlacement] Edge ${config.edgeName} has insufficient rendering points`);
      continue;
    }

    const ratio = Math.max(0, Math.min(1, config.ratio));
    const start = points[0];
    const end = points.at(-1)!;

    const x = start.x + (end.x - start.x) * ratio;
    const y = start.y + (end.y - start.y) * ratio;
    const z = start.z + (end.z - start.z) * ratio;
    const rotation = (Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI;

    placements.push({
      vehicleIndex: index,
      x, y, z, rotation,
      edgeName: config.edgeName,
      edgeRatio: ratio,
    });
  }

  return placements;
};

/**
 * Auto-place vehicles on straight edges
 */
export const calculateVehiclePlacements = (
  numVehicles: number,
  allEdges: Edge[]
): VehiclePlacementResult => {
  // 1. 모든 spot 수집
  const allSpots: { edge: Edge; distance: number }[] = [];

  for (const edge of allEdges) {
    const isCurve = [
      "CURVE_90", "CURVE_180", "S_CURVE", "CURVE_CSC", "CSC_CURVE_HOMO",
    ].includes(edge.vos_rail_type || "");

    if (isCurve) continue;

    const spots = calculateEdgeSpots(edge.distance);
    for (const distance of spots) {
      allSpots.push({ edge, distance });
    }
  }

  // 2. 배치
  const placements: VehiclePlacement[] = [];
  const spotsToUse = allSpots.slice(0, numVehicles);

  for (let i = 0; i < spotsToUse.length; i++) {
    const { edge, distance } = spotsToUse[i];
    const points = edge.renderingPoints || [];
    if (points.length < 2) continue;

    const ratio = distance / edge.distance;
    const start = points[0];
    const end = points.at(-1)!;

    const x = start.x + (end.x - start.x) * ratio;
    const y = start.y + (end.y - start.y) * ratio;
    const z = start.z + (end.z - start.z) * ratio;
    const rotation = (Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI;

    placements.push({
      vehicleIndex: i,
      x, y, z, rotation,
      edgeName: edge.edge_name,
      edgeRatio: ratio,
    });
  }

  return { placements, maxCapacity: allSpots.length };
};