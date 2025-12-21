import { Edge, VehicleConfig } from "../../types";
import { EdgeLoop, VehicleLoop } from "./loopMaker";
import {
  getBodyLength,
  getSensorLength,
  getVehicleSpacing,
} from "../../config/vehicleConfig";

/**
 * Vehicle placement position
 */
export interface VehiclePlacement {
  vehicleIndex: number;
  x: number;
  y: number;
  z: number;
  rotation: number; // in degrees
  edgeName: string;
  edgeRatio: number; // 0.0 ~ 1.0
}

/**
 * Position and rotation on an edge
 */
export interface EdgePosition {
  x: number;
  y: number;
  z: number;
  rotation: number; // in degrees
}

/**
 * Result of vehicle placement calculation
 */
export interface VehiclePlacementResult {
  placements: VehiclePlacement[];
  vehicleLoops: VehicleLoop[];
  maxCapacity: number; // Maximum number of vehicles that can be placed
}

/**
 * Calculate position and rotation on an edge based on ratio
 * @param edge The edge to calculate position on
 * @param ratio Position ratio on edge (0.0 ~ 1.0)
 * @returns Position and rotation on the edge
 */
export const calculatePositionOnEdge = (
  edge: Edge,
  ratio: number
): EdgePosition | null => {
  const points = edge.renderingPoints || [];

  if (points.length < 2) {
    console.warn(
      `[VehiclePlacement] Edge ${edge.edge_name} has insufficient rendering points`
    );
    return null;
  }

  // Clamp ratio to [0, 1]
  ratio = Math.max(0, Math.min(1, ratio));

  // Interpolate position
  const startPoint = points[0];
  const endPoint = points.at(-1)!;
  const x = startPoint.x + (endPoint.x - startPoint.x) * ratio;
  const y = startPoint.y + (endPoint.y - startPoint.y) * ratio;
  const z = startPoint.z + (endPoint.z - startPoint.z) * ratio;

  // Calculate rotation
  const dx = endPoint.x - startPoint.x;
  const dy = endPoint.y - startPoint.y;
  const rotation = (Math.atan2(dy, dx) * 180) / Math.PI;

  return { x, y, z, rotation };
};

/**
 * Create vehicle placements from vehicle config file
 * @param vehicleConfigs Vehicle configurations from vehicles.cfg
 * @param allEdges All edges in the map
 * @returns Array of vehicle placements
 */
export const createPlacementsFromVehicleConfigs = (
  vehicleConfigs: VehicleConfig[],
  allEdges: Edge[]
): VehiclePlacement[] => {
  const placements: VehiclePlacement[] = [];

  console.log(`[VehiclePlacement] Creating placements from ${vehicleConfigs.length} vehicle configs`);
  console.log(`[VehiclePlacement] Available edges: ${allEdges.length}`);

  // Build edge name to edge map
  const edgeMap = new Map<string, Edge>();
  for (const edge of allEdges) {
    edgeMap.set(edge.edge_name, edge);
  }

  let successCount = 0;
  let edgeNotFoundCount = 0;
  let positionFailCount = 0;

  for (let index = 0; index < vehicleConfigs.length; index++) {
    const config = vehicleConfigs[index];
    const edge = edgeMap.get(config.edgeName);
    if (!edge) {
      console.warn(
        `[VehiclePlacement] ✗ Edge ${config.edgeName} not found for vehicle ${config.vehId}`
      );
      edgeNotFoundCount++;
      continue;
    }

    const position = calculatePositionOnEdge(edge, config.ratio);
    if (!position) {
      console.warn(
        `[VehiclePlacement] ✗ Failed to calculate position for vehicle ${config.vehId} on edge ${config.edgeName} (no renderingPoints?)`
      );
      positionFailCount++;
      continue;
    }

    placements.push({
      vehicleIndex: index,
      x: position.x,
      y: position.y,
      z: position.z,
      rotation: position.rotation,
      edgeName: config.edgeName,
      edgeRatio: config.ratio,
    });
    successCount++;
  }

  console.log(
    `[VehiclePlacement] ✓ Created ${successCount} placements (${edgeNotFoundCount} edge not found, ${positionFailCount} position calculation failed)`
  );
  return placements;
};

/**
 * Calculate capacity for each loop based on straight edges
 */
export const calculateLoopCapacities = (
  loops: EdgeLoop[],
  edgeMap: Map<string, Edge>,
  totalVehicleLength: number
): { loopCapacities: number[]; loopStraightEdges: Edge[][] } => {
  const loopCapacities: number[] = [];
  const loopStraightEdges: Edge[][] = [];

  for (const loop of loops) {
    const straightEdges: Edge[] = [];
    let totalStraightLength = 0;

    // Find all straight edges in this loop
    for (const edgeName of loop.edgeNames) {
      const edge = edgeMap.get(edgeName);
      if (edge?.vos_rail_type === "LINEAR") {
        straightEdges.push(edge);
        totalStraightLength += edge.distance;
      }
    }

    // Calculate how many vehicles can fit on straight edges
    const capacity = Math.floor(totalStraightLength / totalVehicleLength);
    loopCapacities.push(capacity);
    loopStraightEdges.push(straightEdges);
  }

  return { loopCapacities, loopStraightEdges };
};

/**
 * Calculate how many vehicles to place on each edge
 */
export const calculateVehiclesPerEdge = (
  vehiclesForThisLoop: number,
  numEdges: number
): number[] => {
  const vehiclesPerEdge = new Array(numEdges).fill(0);
  for (let i = 0; i < vehiclesForThisLoop; i++) {
    const edgeIndex = i % numEdges;
    vehiclesPerEdge[edgeIndex]++;
  }
  return vehiclesPerEdge;
};

/**
 * Generate placements for a specific loop
 */
export const createLoopPlacements = (
  vehiclesForThisLoop: number,
  straightEdges: Edge[],
  vehiclesPerEdge: number[],
  vehicleIndex: number,
  loop: EdgeLoop
): {
  placements: VehiclePlacement[];
  vehicleLoops: VehicleLoop[];
  nextVehicleIndex: number;
} => {
  const placements: VehiclePlacement[] = [];
  const vehicleLoops: VehicleLoop[] = [];
  const vehicleIndexOnEdgeCounter = new Array(straightEdges.length).fill(0);
  let currentVehicleIndex = vehicleIndex;

  // Place vehicles evenly across straight edges
  for (let i = 0; i < vehiclesForThisLoop; i++) {
    const edgeIndex = i % straightEdges.length;
    const edge = straightEdges[edgeIndex];
    const points = edge.renderingPoints || [];

    if (points.length < 2) {
      console.warn(
        `[VehiclePlacement] Edge ${edge.edge_name} has insufficient rendering points`
      );
      continue;
    }

    // Get actual number of vehicles on this edge
    const vehiclesOnThisEdge = vehiclesPerEdge[edgeIndex];
    const vehicleIndexOnEdge = vehicleIndexOnEdgeCounter[edgeIndex];
    vehicleIndexOnEdgeCounter[edgeIndex]++;

    // Calculate ratio based on vehicle spacing
    const edgeLength = edge.distance;

    let ratio: number;
    if (vehiclesOnThisEdge <= 1) {
      ratio = 0.5; // Single vehicle in the middle
    } else {
      // Distribute vehicles evenly with spacing
      // Leave small margin at both ends (10% of edge length)
      const margin = edgeLength * 0.1;
      const availableLength = edgeLength - (2 * margin);
      const spacing = availableLength / (vehiclesOnThisEdge - 1);
      const distanceFromStart = margin + (vehicleIndexOnEdge * spacing);
      ratio = distanceFromStart / edgeLength;
    }

    // Clamp ratio to [0.05, 0.95] to avoid edge boundaries
    ratio = Math.max(0.05, Math.min(0.95, ratio));

    // Interpolate position
    const startPoint = points[0];
    const endPoint = points.at(-1)!;
    const x = startPoint.x + (endPoint.x - startPoint.x) * ratio;
    const y = startPoint.y + (endPoint.y - startPoint.y) * ratio;
    const z = startPoint.z + (endPoint.z - startPoint.z) * ratio;

    // Calculate rotation
    const dx = endPoint.x - startPoint.x;
    const dy = endPoint.y - startPoint.y;
    const rotation = (Math.atan2(dy, dx) * 180) / Math.PI;

    placements.push({
      vehicleIndex: currentVehicleIndex,
      x,
      y,
      z,
      rotation,
      edgeName: edge.edge_name,
      edgeRatio: ratio,
    });

    // Assign this vehicle to this loop
    vehicleLoops.push({
      vehicleIndex: currentVehicleIndex,
      edgeSequence: [...loop.edgeNames],
    });

    currentVehicleIndex++;
  }

  return { placements, vehicleLoops, nextVehicleIndex: currentVehicleIndex };
};

/**
 * Calculate vehicle placements on loops
 * Places vehicles evenly on straight edges only
 * @param loops Array of edge loops
 * @param numVehicles Requested number of vehicles
 * @param allEdges All edges in the map
 * @returns Result containing placements and vehicle loops
 */
export const calculateVehiclePlacementsOnLoops = (
  loops: EdgeLoop[],
  numVehicles: number,
  allEdges: Edge[]
): VehiclePlacementResult => {
  const placements: VehiclePlacement[] = [];
  const vehicleLoops: VehicleLoop[] = [];

  if (loops.length === 0) {
    console.warn("[VehiclePlacement] No loops found, cannot place vehicles");
    return { placements, vehicleLoops, maxCapacity: 0 };
  }

  // Build edge name to edge map
  // Build edge name to edge map
  const edgeMap = new Map<string, Edge>();
  for (const edge of allEdges) {
    edgeMap.set(edge.edge_name, edge);
  }

  // Calculate total vehicle length (body + sensor + spacing)
  const bodyLength = getBodyLength();
  const sensorLength = getSensorLength();
  const spacing = getVehicleSpacing();
  const totalVehicleLength = bodyLength + sensorLength + spacing;

  // Calculate max capacity for each loop
  const { loopCapacities, loopStraightEdges } = calculateLoopCapacities(
    loops,
    edgeMap,
    totalVehicleLength
  );

  // Calculate total max capacity
  const totalCapacity = loopCapacities.reduce((sum, cap) => sum + cap, 0);
  const actualNumVehicles = Math.min(numVehicles, totalCapacity);

  if (actualNumVehicles < numVehicles) {
    console.warn(
      `[VehiclePlacement] Requested ${numVehicles} vehicles but only ${actualNumVehicles} can fit (max capacity: ${totalCapacity})`
    );
  }

  console.log(
    `[VehiclePlacement] Placing ${actualNumVehicles} vehicles across ${loops.length} loops`
  );

  // Distribute vehicles across loops proportionally
  let vehicleIndex = 0;
  let remainingVehicles = actualNumVehicles;

  for (let loopIndex = 0; loopIndex < loops.length; loopIndex++) {
    const loop = loops[loopIndex];
    const loopCapacity = loopCapacities[loopIndex];
    const straightEdges = loopStraightEdges[loopIndex];

    if (loopCapacity === 0 || straightEdges.length === 0) {
      continue; // Skip this loop
    }

    // Calculate how many vehicles to place on this loop
    // For the last loop, place all remaining vehicles
    const isLastLoop = loopIndex === loops.length - 1;
    const vehiclesForThisLoop = isLastLoop
      ? Math.min(remainingVehicles, loopCapacity)
      : Math.min(
          Math.ceil((loopCapacity / totalCapacity) * actualNumVehicles),
          loopCapacity,
          remainingVehicles
        );

    // First, calculate how many vehicles will be placed on each edge
    const vehiclesPerEdge = calculateVehiclesPerEdge(
      vehiclesForThisLoop,
      straightEdges.length
    );

    // Place vehicles evenly across straight edges
    const result = createLoopPlacements(
      vehiclesForThisLoop,
      straightEdges,
      vehiclesPerEdge,
      vehicleIndex,
      loop
    );

    placements.push(...result.placements);
    vehicleLoops.push(...result.vehicleLoops);
    vehicleIndex = result.nextVehicleIndex;

    // Decrease remaining vehicles
    remainingVehicles -= vehiclesForThisLoop;
  }

  console.log(`[VehiclePlacement] Placed ${placements.length} vehicles total (max capacity: ${totalCapacity})`);
  return { placements, vehicleLoops, maxCapacity: totalCapacity };
};

