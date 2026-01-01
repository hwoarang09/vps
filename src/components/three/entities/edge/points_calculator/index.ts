import { EdgePointsCalculator } from "./EdgePointsCalculator";
import * as THREE from "three";

export class PointsCalculator {
  /**
   * Calculate rendering points for any edge type (EdgePointsCalculator 사용)
   */
  static calculateRenderingPoints(edgeRowData: any): THREE.Vector3[] {
    return EdgePointsCalculator.calculateRenderingPoints(edgeRowData);
  }
}


