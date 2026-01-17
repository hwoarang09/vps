import { Edge, VehicleConfig } from "@/types";

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

export interface EdgeSpot {
  edge: Edge;
  distance: number;
}

/**
 * Calculate all available spots for vehicle placement
 * Returns spots in round-robin order across edges
 */
const calculateAllSpots = (allEdges: Edge[]): EdgeSpot[] => {
  // 1. edge별로 spot 목록 생성
  const edgeSpots: { edge: Edge; spots: number[] }[] = [];

  for (const edge of allEdges) {
    const isCurve = [
      "CURVE_90", "CURVE_180", "S_CURVE", "CURVE_CSC", "CSC_CURVE_HOMO",
    ].includes(edge.vos_rail_type || "");

    if (isCurve) continue;

    const spots = calculateEdgeSpots(edge.distance);
    if (spots.length > 0) {
      edgeSpots.push({ edge, spots });
    }
  }

  // 2. Round-robin으로 spot 수집
  const allSpots: EdgeSpot[] = [];
  let maxSpotsPerEdge = 0;

  for (const { spots } of edgeSpots) {
    maxSpotsPerEdge = Math.max(maxSpotsPerEdge, spots.length);
  }

  for (let spotIndex = 0; spotIndex < maxSpotsPerEdge; spotIndex++) {
    for (const { edge, spots } of edgeSpots) {
      if (spotIndex < spots.length) {
        allSpots.push({ edge, distance: spots[spotIndex] });
      }
    }
  }

  return allSpots;
};

/**
 * Get maximum vehicle capacity for given edges
 */
export const getMaxVehicleCapacity = (allEdges: Edge[]): number => {
  return calculateAllSpots(allEdges).length;
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
      continue;
    }

    const points = edge.renderingPoints || [];
    if (points.length < 2) {
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
 * Uses round-robin distribution to evenly distribute vehicles across edges
 */
export const calculateVehiclePlacements = (
  numVehicles: number,
  allEdges: Edge[]
): VehiclePlacementResult => {
  const allSpots = calculateAllSpots(allEdges);
  const spotsToUse = allSpots.slice(0, numVehicles);

  const placements: VehiclePlacement[] = [];

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