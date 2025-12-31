import { EdgePointsCalculator } from "./EdgePointsCalculator";
import * as THREE from "three";

/**
 * Main points calculator - 통합된 EdgePointsCalculator 사용
 */
export class PointsCalculator {
  /**
   * Calculate rendering points for any edge type (EdgePointsCalculator 사용)
   */
  static calculateRenderingPoints(edgeRowData: any): THREE.Vector3[] {
    return EdgePointsCalculator.calculateRenderingPoints(edgeRowData);
  }
}

// Export individual calculators as well
export { EdgePointsCalculator } from "./EdgePointsCalculator";
export { StraightPointsCalculator } from "./_StraightPointsCalculator";
export { SimpleCurveEdgePointsCalculator } from "./_SimpleCurveEdgePointsCalculator";
export { DirectionUtils } from "./_DirectionUtils";
