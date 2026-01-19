import { Node } from "@/types";
import * as THREE from "three";
import { EdgePathGenerator, PathSegmentDef } from "./EdgePathGenerator";

const DEFAULT_SEGMENTS = 100;

type CurveConfig = {
  waypointCount: number;
  angles: number[];
  zOffset: number;
};

const CURVE_CONFIGS: Record<string, CurveConfig> = {
  CURVE_90: { waypointCount: 4, angles: [90], zOffset: 0.001 },
  CURVE_180: { waypointCount: 4, angles: [180], zOffset: 0.001 },
  CURVE_CSC: { waypointCount: 6, angles: [90, 90], zOffset: 0.003 },
};

/**
 * Simple Curve Edge Points Calculator
 * 90도, 180도, CSC 곡선을 통합 처리
 *
 * - CURVE_90: 4 waypoints (a,b,c,d) → 직선-90도곡선-직선
 * - CURVE_180: 4 waypoints (a,b,c,d) → 직선-180도곡선-직선
 * - CURVE_CSC: 6 waypoints (a,b,c,d,e,f) → 직선-90도곡선-직선-90도곡선-직선
 */
export class SimpleCurveEdgePointsCalculator {
  static calculate(
    edgeRowData: any,
    nodes: Node[],
    totalSegments: number = DEFAULT_SEGMENTS
  ): THREE.Vector3[] {
    // Rule A.1: Remove useless assignment - edge_name not used
    const { waypoints, radius, vos_rail_type } = edgeRowData;

    const config = CURVE_CONFIGS[vos_rail_type];
    if (!config) {
      return [];
    }

    const nodeNames = waypoints as string[];
    const resolvedNodes = nodeNames.map((name) =>
      nodes.find((n) => n.node_name === name)
    );

    if (resolvedNodes.some((n) => !n)) {
      return [];
    }

    const segments = this.buildSegments(
      resolvedNodes as Node[],
      config.angles,
      radius
    );

    return EdgePathGenerator.generate(segments, totalSegments, config.zOffset);
  }

  /**
   * waypoints와 angles를 기반으로 세그먼트 정의 생성
   * 패턴: 직선 - (곡선 - 직선) 반복
   */
  private static buildSegments(
    nodes: Node[],
    angles: number[],
    radius: number
  ): PathSegmentDef[] {
    const segments: PathSegmentDef[] = [];
    let nodeIndex = 0;

    // 첫 직선
    segments.push({
      type: "STRAIGHT",
      from: nodes[nodeIndex],
      to: nodes[nodeIndex + 1],
    });
    nodeIndex++;

    // 곡선 - 직선 반복
    for (const angle of angles) {
      segments.push({
        type: "CURVE",
        from: nodes[nodeIndex],
        to: nodes[nodeIndex + 1],
        radius,
        angle,
      });
      nodeIndex++;

      segments.push({
        type: "STRAIGHT",
        from: nodes[nodeIndex],
        to: nodes[nodeIndex + 1],
      });
      nodeIndex++;
    }

    return segments;
  }
}
