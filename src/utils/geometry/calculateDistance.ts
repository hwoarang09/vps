import { Node } from "@/types";

// utils/geometry/calculateStraightDistance.ts
export function calculateStraightDistance(nodeA: Node, nodeB: Node): number {
  const dx = nodeB.editor_x - nodeA.editor_x;
  const dy = nodeB.editor_y - nodeA.editor_y;
  const dz = (nodeB.editor_z || 0) - (nodeA.editor_z || 0);
  return Math.hypot(dx, dy, dz);
}

// utils/geometry/calculateCurveLength.ts
export function calculateCurveLength(
  radius: number,
  angleDegrees: number
): number {
  const angleRadians = (angleDegrees * Math.PI) / 180;
  return Math.abs(radius) * angleRadians; // 호장 길이 = 반지름 × 각도(라디안)
}
