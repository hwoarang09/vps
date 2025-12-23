import { useNodeStore } from "@/store/map/nodeStore";
import * as THREE from "three";

import { StraightPointsCalculator } from "./_StraightPointsCalculator";
import { Curve90EdgePointsCalculator } from "./_Curve90EdgePointsCalculator";
import { SCurvePointsCalculator } from "./_SCurvePointsCalculator";
import { CurveCSCEdgePointsCalculator } from "./_CurveCSCEdgePointsCalculator";
import { Curve180EdgePointsCalculator } from "./_Curve180EdgePointsCalculator";
import { CurveCSCHomoEdgePointsCalculator } from "./_CurveCSCHomoEdgePointsCalculator";


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
    const edgeName = edgeRowData.edge_name;

    // nodeStore에서 전체 nodes 가져오기
    const nodes = useNodeStore.getState().nodes;

    switch (vosRailType) {
      case "CURVE_90":
        return Curve90EdgePointsCalculator.calculate(edgeRowData, nodes);

      case "CURVE_180":
        return Curve180EdgePointsCalculator.calculate(edgeRowData, nodes);

      case "S_CURVE":
        return SCurvePointsCalculator.calculate(edgeRowData, nodes);

      case "CURVE_CSC":
        return CurveCSCEdgePointsCalculator.calculate(edgeRowData, nodes);

      case "CSC_CURVE_HOMO":
        return CurveCSCHomoEdgePointsCalculator.calculate(edgeRowData, nodes);

      case "LINEAR":
        return StraightPointsCalculator.calculate(edgeRowData, nodes);
      default:
        console.log(
          `⚪ Processing UNKNOWN rail type: ${vosRailType} for edge ${edgeName} - using LINEAR`
        );
        return StraightPointsCalculator.calculate(edgeRowData, nodes);
    }
  }
}
