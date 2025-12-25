import { Node } from "../../../../../types";
import * as THREE from "three";
import { DirectionUtils } from "./_DirectionUtils";
import { StraightPointsCalculator } from "./_StraightPointsCalculator";
import {
  calculateStraightDistance,
  calculateCurveLength,
} from "@/utils/geometry/calculateDistance";

const DEFAULT_SEGMENTS = 100;

/**
 * S자 곡선 Edge Points Calculator
 * 전반부: n1 → n2 → n3 → n4 (정방향)
 * 후반부: n6 → n5 → n4 (역방향으로 계산 후 reverse)
 */
export class SCurvePointsCalculator {
  static calculate(
    edgeRowData: any,
    nodes: Node[],
    totalSegments: number = DEFAULT_SEGMENTS
  ): THREE.Vector3[] {
    const { waypoints,   radius,edge_name, vos_rail_type } = edgeRowData;
    const rotation = 43;
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

    console.log(radius, rotation)
    // 각 구간 길이 계산
    const len1 = calculateStraightDistance(n1, n2);
    const len2 = calculateCurveLength(radius, rotation);
    const len3 = calculateStraightDistance(n3, n4);
    const len4 = calculateCurveLength(radius, rotation);
    const len5 = calculateStraightDistance(n5, n6);

    const lengths = [len1, len2, len3, len4, len5];
    const totalLength = lengths.reduce((sum, len) => sum + len, 0);

    // 세그먼트 개수 배분
    const segmentCounts = lengths.map((len) =>
      Math.max(1, Math.round(totalSegments * (len / totalLength)))
    );

    // 반올림 오차 보정
    const assignedTotal = segmentCounts.reduce((sum, cnt) => sum + cnt, 0);
    const diff = totalSegments - assignedTotal;
    if (diff !== 0) {
      let maxIdx = 0;
      for (let i = 1; i < lengths.length; i++) {
        if (lengths[i] > lengths[maxIdx]) maxIdx = i;
      }
      segmentCounts[maxIdx] += diff;
    }

    const [seg1, seg2, seg3, seg4, seg5] = segmentCounts;

    // ===== 전반부: n1 → n2 → n3 → n4 (정방향) =====
    const forwardPoints: THREE.Vector3[] = [];

    // n1 → n2 직선
    const pts1 = StraightPointsCalculator.calculateSegmentedPoints(n1, n2, seg1);
    forwardPoints.push(...pts1);

    // n2 → n3 곡선
    const dir1 = DirectionUtils.getLineDirection(n1, n2);
    const pts2 = DirectionUtils.calculateCurveAreaPoints(
      n2, n3, dir1, radius, rotation, seg2, "from"
    );
    forwardPoints.push(...pts2);

    // n3 → n4 직선 (마지막 점 제외 - 후반부와 겹침 방지)
    const pts3 = StraightPointsCalculator.calculateSegmentedPoints(n3, n4, seg3);
    forwardPoints.push(...pts3.slice(0, -1));

    // ===== 후반부: n6 → n5 → n4 (역방향 계산 후 reverse) =====
    const backwardPoints: THREE.Vector3[] = [];

    // n6 → n5 직선
    const pts5 = StraightPointsCalculator.calculateSegmentedPoints(n6, n5, seg5);
    backwardPoints.push(...pts5);

    // n5 → n4 곡선
    const dir5 = DirectionUtils.getLineDirection(n6, n5);
    const pts4 = DirectionUtils.calculateCurveAreaPoints(
      n5, n4, dir5, radius, rotation, seg4, "from"
    );
    backwardPoints.push(...pts4);

    // 역순으로 뒤집기
    backwardPoints.reverse();

    // 합치기
    const allPoints = [...forwardPoints, ...backwardPoints];

    // Z 오프셋 적용
    const zOffset = 0.001;
    return allPoints.map((p) => new THREE.Vector3(p.x, p.y, p.z + zOffset));
  }
}