import { Node } from "@/types";
import * as THREE from "three";
import { EdgePathGenerator, PathSegmentDef } from "./EdgePathGenerator";

const DEFAULT_SEGMENTS = 100;

/**
 * 180도 곡선 (LEFT_CURVE, RIGHT_CURVE) Edge Points Calculator
 * 직선 + 180도 곡선 + 직선 구조로 처리
 */
export class Curve180EdgePointsCalculator {
  static calculate(
    edgeRowData: any,
    nodes: Node[],
    totalSegments: number = DEFAULT_SEGMENTS
  ): THREE.Vector3[] {
    const { waypoints, radius, edge_name, vos_rail_type } = edgeRowData;

    // waypoints 구조: [a, b, c, d]
    const nodeNames = waypoints as string[];
    const nodeA = nodes.find((n) => n.node_name === nodeNames[0]);
    const nodeB = nodes.find((n) => n.node_name === nodeNames[1]);
    const nodeC = nodes.find((n) => n.node_name === nodeNames[2]);
    const nodeD = nodes.find((n) => n.node_name === nodeNames[3]);

    if (!nodeA || !nodeB || !nodeC || !nodeD) {
      console.warn(
        `${vos_rail_type} waypoint nodes not found for edge: ${edge_name}`
      );
      return [];
    }

    // 세그먼트 정의
    const segments: PathSegmentDef[] = [
      { type: "STRAIGHT", from: nodeA, to: nodeB },
      { type: "CURVE", from: nodeB, to: nodeC, radius, angle: 180 },
      { type: "STRAIGHT", from: nodeC, to: nodeD },
    ];

    // Z 오프셋
    const zOffset = 0.001;

    return EdgePathGenerator.generate(segments, totalSegments, zOffset);
  }
}

