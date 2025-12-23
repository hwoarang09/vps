import { Node } from "../../../../../types";
import * as THREE from "three";
import { EdgePathGenerator, PathSegmentDef } from "./EdgePathGenerator";

const DEFAULT_SEGMENTS = 100;

/**
 * CSC_CURVE_HOMO Edge Points Calculator
 * 6개 노드로 구성: n1→n2(직선) → n2→n3(90도곡선) → n3→n4(직선) → n4→n5(90도곡선) → n5→n6(직선)
 * Homo: 두 곡선의 회전 방향이 동일함 (U자 형태) - 이는 노드 위치에 따라 자동 결정됨
 */
export class CurveCSCHomoEdgePointsCalculator {
  static calculate(
    edgeRowData: any,
    nodes: Node[],
    totalSegments: number = DEFAULT_SEGMENTS
  ): THREE.Vector3[] {
    const { waypoints, radius, edge_name, vos_rail_type } = edgeRowData;

    // waypoints 구조: [n1, n2, n3, n4, n5, n6] (6개)
    const nodeNames = waypoints as string[];
    const n1 = nodes.find((n) => n.node_name === nodeNames[0]);
    const n2 = nodes.find((n) => n.node_name === nodeNames[1]);
    const n3 = nodes.find((n) => n.node_name === nodeNames[2]);
    const n4 = nodes.find((n) => n.node_name === nodeNames[3]);
    const n5 = nodes.find((n) => n.node_name === nodeNames[4]);
    const n6 = nodes.find((n) => n.node_name === nodeNames[5]);

    if (!n1 || !n2 || !n3 || !n4 || !n5 || !n6) {
      console.warn(
        `${vos_rail_type} waypoint nodes not found for edge: ${edge_name}`
      );
      return [];
    }

    // 세그먼트 정의
    const segments: PathSegmentDef[] = [
      { type: "STRAIGHT", from: n1, to: n2 },
      { type: "CURVE", from: n2, to: n3, radius, angle: 90 },
      { type: "STRAIGHT", from: n3, to: n4 },
      { type: "CURVE", from: n4, to: n5, radius, angle: 90 },
      { type: "STRAIGHT", from: n5, to: n6 },
    ];

    // Z 오프셋 (CSC 타입은 우선순위 높음)
    const zOffset = 0.003;

    return EdgePathGenerator.generate(segments, totalSegments, zOffset);
  }
}
