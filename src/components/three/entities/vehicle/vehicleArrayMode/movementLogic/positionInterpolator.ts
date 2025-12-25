import { Edge } from "@/types/edge";
import { EdgeType } from "@/types";

const RAD_TO_DEG = 180 / Math.PI;

// Zero-GC: Reusable result type
export interface PositionResult {
  x: number;
  y: number;
  z: number;
  rotation: number;
}

/**
 * Zero-GC: Calculates 3D position and rotation, writes to target object.
 */
export function interpolatePositionTo(edge: Edge, ratio: number, target: PositionResult): void {
  const points = edge.renderingPoints;

  // Fast fail
  if (!points || points.length === 0) {
    target.x = 0;
    target.y = 0;
    target.z = 3.8;
    target.rotation = (edge as any).axis ?? 0;
    return;
  }

  // TYPE 1: LINEAR EDGES
  if (edge.vos_rail_type === EdgeType.LINEAR) {
    const pStart = points[0];
    const pEnd = points.at(-1)!;

    target.x = pStart.x + (pEnd.x - pStart.x) * ratio;
    target.y = pStart.y + (pEnd.y - pStart.y) * ratio;
    target.z = 3.8;

    const dx = pEnd.x - pStart.x;
    const dy = pEnd.y - pStart.y;

    if (Math.abs(dx) >= Math.abs(dy)) {
      target.rotation = dx >= 0 ? 0 : 180;
    } else {
      target.rotation = dy >= 0 ? 90 : -90;
    }
    return;
  }

  // TYPE 2: CURVE EDGES
  const safeRatio = ratio < 0 ? 0 : Math.min(ratio, 1);

  const maxIndex = points.length - 1;
  const floatIndex = safeRatio * maxIndex;
  const index = Math.floor(floatIndex);

  const nextIndex = index < maxIndex ? index + 1 : maxIndex;
  const segmentRatio = floatIndex - index;

  const p1 = points[index];
  const p2 = points[nextIndex];

  target.x = p1.x + (p2.x - p1.x) * segmentRatio;
  target.y = p1.y + (p2.y - p1.y) * segmentRatio;
  target.z = 3.8;

  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;

  const distSq = dx * dx + dy * dy;
  let rawRotation = 0;

  if (distSq > 0.000001) {
    rawRotation = Math.atan2(dy, dx) * RAD_TO_DEG;
  } else if (index > 0) {
    const pPrev = points[index - 1];
    rawRotation = Math.atan2(p1.y - pPrev.y, p1.x - pPrev.x) * RAD_TO_DEG;
  }

  target.rotation = ((rawRotation) % 360 + 360) % 360;
}

/**
 * Calculates 3D position and rotation based on edge and ratio.
 * @deprecated Use interpolatePositionTo for Zero-GC
 */
export function interpolatePosition(edge: Edge, ratio: number) {
  const points = edge.renderingPoints;
  
  // Fast fail
  if (!points || points.length === 0) {
    // axis가 없으면 0도
    return { x: 0, y: 0, z: 3.8, rotation: (edge as any).axis ?? 0 };
  }

  // ==================================================================================
  // TYPE 1: LINEAR EDGES (Direct Access)
  // 이미 로딩 시점에 axis(0, 90, 180, 270)가 결정되었으므로 계산하지 않음.
  // ==================================================================================
  if (edge.vos_rail_type === EdgeType.LINEAR) {
    const pStart = points[0];
    const pEnd = points.at(-1)!;

    // Position Interpolation (Lerp)
    const x = pStart.x + (pEnd.x - pStart.x) * ratio;
    const y = pStart.y + (pEnd.y - pStart.y) * ratio;
    const z = 3.8;

    // Calculate rotation from vector (Support all 4 directions)
    const dx = pEnd.x - pStart.x;
    const dy = pEnd.y - pStart.y;
    // axis-aligned only (degrees)
    let rotation: number;

    if (Math.abs(dx) >= Math.abs(dy)) {
      // X axis
      rotation = dx >= 0 ? 0 : 180;
    } else {
      // Y axis
      rotation = dy >= 0 ? 90 : -90;
    }
    return { x, y, z, rotation };
  }

  // ==================================================================================
  // TYPE 2: CURVE EDGES (Segmented)
  // 곡선은 위치마다 각도가 계속 변하므로 벡터 계산 필요
  // ==================================================================================
  
  const safeRatio = ratio < 0 ? 0 : (Math.min(ratio, 1));
  
  const maxIndex = points.length - 1;
  const floatIndex = safeRatio * maxIndex;
  const index = Math.floor(floatIndex);
  
  const nextIndex = index < maxIndex ? index + 1 : maxIndex;
  const segmentRatio = floatIndex - index;

  const p1 = points[index];
  const p2 = points[nextIndex];

  // Interpolate Position
  const x = p1.x + (p2.x - p1.x) * segmentRatio;
  const y = p1.y + (p2.y - p1.y) * segmentRatio;
  const z = 3.8;

  // Calculate Rotation for Curve
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;

  const distSq = dx * dx + dy * dy;
  let rawRotation = 0;

  if (distSq > 0.000001) {
    rawRotation = Math.atan2(dy, dx) * RAD_TO_DEG;
  } else if (index > 0) {
    const pPrev = points[index - 1];
    rawRotation = Math.atan2(p1.y - pPrev.y, p1.x - pPrev.x) * RAD_TO_DEG;
  }

  // 곡선 구간 -90도 오프셋 (User Mapping Consistency: 위쪽이 0도 기준)
  const rotation = ((rawRotation) % 360 + 360) % 360;

  return { x, y, z, rotation };
}