import { useNodeStore } from "@/store/map/nodeStore";
import * as THREE from "three";
import { EdgeType } from "@/types";

import { StraightPointsCalculator } from "./_StraightPointsCalculator";
import { SimpleCurveEdgePointsCalculator } from "./_SimpleCurveEdgePointsCalculator";
import { SCurvePointsCalculator } from "./_SCurvePointsCalculator";

/**
 * Edge Points Calculator 라우터
 * vos_rail_type에 따라 적절한 계산 클래스로 분기
 */
export class EdgePointsCalculator {
  /**
   * vos_rail_type에 따른 3D 렌더링 포인트 계산
   * @param edgeRowData CFG에서 파싱된 edge row 데이터 전체 (waypoints 포함)
   */
  static calculateRenderingPoints(edgeRowData: any): THREE.Vector3[] {
    const vosRailType = edgeRowData.vos_rail_type;
    // Rule A.1: Remove useless assignment - edgeName not used

    // nodeStore에서 전체 nodes 가져오기
    const nodes = useNodeStore.getState().nodes;

    switch (vosRailType) {
      case EdgeType.CURVE_90:
      case EdgeType.CURVE_180:
      case EdgeType.CURVE_CSC:
        return SimpleCurveEdgePointsCalculator.calculate(edgeRowData, nodes);

      case EdgeType.S_CURVE:
        return SCurvePointsCalculator.calculate(edgeRowData, nodes);

      case EdgeType.LINEAR:
        return StraightPointsCalculator.calculate(edgeRowData, nodes);
      default:
        return StraightPointsCalculator.calculate(edgeRowData, nodes);
    }
  }
}
