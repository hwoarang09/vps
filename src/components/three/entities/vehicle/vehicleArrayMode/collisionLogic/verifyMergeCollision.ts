import { Edge } from "@/types/edge";
import { edgeVehicleQueue } from "@/store/vehicle/arrayMode/edgeVehicleQueue";
import { MovementData, VEHICLE_DATA_SIZE, HitZone } from "@/store/vehicle/arrayMode/vehicleDataArray";
import { checkSensorCollision } from "@/components/three/entities/vehicle/vehicleArrayMode/helpers/sensorCollision";
import { applyCollisionZoneLogic } from "./collisionCommon";
import { getBodyLength } from "@/config/vehicleConfig";

/**
 * Returns a fixed curve tail length (assumption: 0.5m).
 * This represents the distance between Node[-2] and ToNode on the merging curve.
 */
function getCurveTailLength(): number {
  return 0.5;
}

import { useEdgeStore } from "@/store/map/edgeStore";

/**
 * Helper to check collision against all vehicles on a competitor edge.
 * Returns the updated max HitZone.
 */
function checkCompetitorVehicles(
  myVehId: number,
  compQueue: Int32Array,
  currentMaxHitZone: number,
  data: Float32Array,
  compThreshold: number,
  compEdgeLen: number
): { maxHitZone: number, targetId: number } {
  const compCount = compQueue[0];
  let maxHitZone = currentMaxHitZone;
  let maxTargetId = -1;

  for (let j = 0; j < compCount; j++) {
    const compVehId = compQueue[1 + j];
    const compPtr = compVehId * VEHICLE_DATA_SIZE;

    // Filter by Competitor Position
    // We need competitor's offset. 
    // If vos_rail_trpy is set, OFFSET is reliable.
    // If straight, verifyLinearCollision updates OFFSET? 
    // Wait, verifyLinearCollision logic still uses Ratio * Length.
    // To be safe, let's use OFFSET if available, else derive from Ratio (fallback).
    // Actually, vehicleDataArray now has OFFSET. ideally it should be populated.
    // But verifyLinearCollision doesn't set OFFSET explicitly unless we changed it?
    // We haven't updated verifyLinearCollision to SET offset.
    // So for straight edges, we rely on Ratio * Length.
    
    // Check if OFFSET is populated (non-zero or we trust ratio more?)
    // Reliable way for now: Ratio * Length (Universal)
    // Actually, for generic logic, Ratio * Length is safest for now if we didn't refactor population.
    const compRatio = data[compPtr + MovementData.EDGE_RATIO];
    const compOffset = compRatio * compEdgeLen;

    if (compOffset < compThreshold) continue;

    const hitZone = checkSensorCollision(myVehId, compVehId);
    
    if (hitZone > maxHitZone) {
      maxHitZone = hitZone;
      maxTargetId = compVehId;
    }

    // Optimization: STOP is the max value, no need to check further if found
    if (maxHitZone === HitZone.STOP) break;
  }

  return { maxHitZone, targetId: maxTargetId };
}

/**
 * Checks for side/merge collisions in the Danger Zone.
 * Iterates ALL vehicles on the edge (not just lead) because a long edge
 * might have multiple vehicles in the merge zone.
 */
/**
 * Check a single vehicle against all collision candidates in the merge zone.
 */
function checkAgainstCompetitors(
  vehId: number, 
  edgeIdx: number, 
  edge: Edge, 
  data: Float32Array, 
  ptr: number,
  dangerZoneLen: number
) {
  if (!edge.prevEdgeIndices) return;

  if (!edge.prevEdgeIndices) return;

  let mostCriticalHitZone: number = HitZone.NONE;
  let criticalTargetId = -1;

  for (const compEdgeIdx of edge.prevEdgeIndices) {
    if (compEdgeIdx === edgeIdx) continue; // Skip self

    const compQueue = edgeVehicleQueue.getData(compEdgeIdx);
    if (!compQueue || compQueue[0] === 0) continue;

    // Retrieve Competitor Edge to check type/length
    const compEdge = useEdgeStore.getState().getEdgeByIndex(compEdgeIdx);
    if (!compEdge) continue; // Should not happen

    // [Competitor Filter Logic]
    // If Competitor is Straight (Long): Check Danger Zone Only
    let compThreshold = 0;
    if (compEdge.vos_rail_type === "LINEAR") {
      compThreshold = compEdge.distance - dangerZoneLen;
    }

    // Check against relevant vehicles on competitor edge.
    const result = checkCompetitorVehicles(
      vehId, 
      compQueue, 
      mostCriticalHitZone, 
      data, 
      compThreshold, 
      compEdge.distance
    );

    if (result.maxHitZone > mostCriticalHitZone) {
        mostCriticalHitZone = result.maxHitZone;
        criticalTargetId = result.targetId;
    }
  }

  // Apply Logic if collision detected
  if (mostCriticalHitZone !== HitZone.NONE) {
      applyCollisionZoneLogic(mostCriticalHitZone, data, ptr, criticalTargetId);
  }
}

/**
 * Checks for side/merge collisions in the Danger Zone.
 * Iterates ALL vehicles on the edge (not just lead) because a long edge
 * might have multiple vehicles in the merge zone.
 */
export function verifyMergeZoneCollision(
  edgeIdx: number, 
  edge: Edge, 
  data: Float32Array, 
  queue: Int32Array
) {
  // 1. Calculate Danger Zone Length
  const tailLength = getCurveTailLength();
  const vehicleLen = getBodyLength();
  
  // Safety Margin: Tail Length + (VehicleLength * 2)
  const dangerZoneLen = tailLength + (vehicleLen * 2);

  const edgeLen = edge.distance;
  const dangerStartOffset = edgeLen - dangerZoneLen;

  const count = queue[0];

  for (let i = 0; i < count; i++) {
    const vehId = queue[1 + i];
    const ptr = vehId * VEHICLE_DATA_SIZE;
    
    // Calculate Position on Edge (Generic: support both Curve and Straight)
    let currentOffset = 0;
    
    if (edge.vos_rail_type !== "LINEAR") {
       // Curve: Use OFFSET directly
       currentOffset = data[ptr + MovementData.OFFSET];
    } else {
       // Straight: Calculate offset from EDGE_RATIO
       const ratio = data[ptr + MovementData.EDGE_RATIO];
       currentOffset = ratio * edgeLen;
    }

    // [Current Edge Filter Logic]
    // If Curve: Check ALL (StartOffset = 0 per user req)
    // If Straight: Check Danger Zone Only
    let effectiveStartOffset = dangerStartOffset;
    if (edge.vos_rail_type !== "LINEAR") {
        effectiveStartOffset = 0; // Check all on curve
    }

    if (currentOffset < effectiveStartOffset) continue;

    checkAgainstCompetitors(vehId, edgeIdx, edge, data, ptr, dangerZoneLen);
  }
}
