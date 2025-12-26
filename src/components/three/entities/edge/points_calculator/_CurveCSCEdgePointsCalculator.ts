import { Node } from "@/types";
import * as THREE from "three";
import { EdgePathGenerator, PathSegmentDef } from "./EdgePathGenerator";

const DEFAULT_SEGMENTS = 100;

/**
 * CSC (직선-곡선-직선-곡선-직선) Edge Points Calculator
 * 6개 노드로 구성: a→b(직선) → b→c(90도곡선) → c→d(직선) → d→e(90도곡선) → e→f(직선)
 */
export class CurveCSCEdgePointsCalculator {
  static calculate(
    edgeRowData: any,
    nodes: Node[],
    totalSegments: number = DEFAULT_SEGMENTS
  ): THREE.Vector3[] {
    const { waypoints, radius, edge_name, vos_rail_type } = edgeRowData;

    // waypoints 구조: [a, b, c, d, e, f] (6개)
    const nodeNames = waypoints as string[];
    const nodeA = nodes.find((n) => n.node_name === nodeNames[0]);
    const nodeB = nodes.find((n) => n.node_name === nodeNames[1]);
    const nodeC = nodes.find((n) => n.node_name === nodeNames[2]);
    const nodeD = nodes.find((n) => n.node_name === nodeNames[3]);
    const nodeE = nodes.find((n) => n.node_name === nodeNames[4]);
    const nodeF = nodes.find((n) => n.node_name === nodeNames[5]);

    if (!nodeA || !nodeB || !nodeC || !nodeD || !nodeE || !nodeF) {
      console.warn(
        `${vos_rail_type} waypoint nodes not found for edge: ${edge_name}`
      );
      return [];
    }

    // 세그먼트 정의
    const segments: PathSegmentDef[] = [
      { type: "STRAIGHT", from: nodeA, to: nodeB },
      { type: "CURVE", from: nodeB, to: nodeC, radius, angle: 90 },
      { type: "STRAIGHT", from: nodeC, to: nodeD },
      { type: "CURVE", from: nodeD, to: nodeE, radius, angle: 90 },
      { type: "STRAIGHT", from: nodeE, to: nodeF },
    ];

    // Z 오프셋 (CSC 타입은 우선순위 높음)
    const zOffset = 0.003;

    return EdgePathGenerator.generate(segments, totalSegments, zOffset);
  }
}

