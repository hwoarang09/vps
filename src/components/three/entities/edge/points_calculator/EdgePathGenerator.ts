import { Node } from "@/types";
import { DirectionUtils, Direction } from "./_DirectionUtils";
import { StraightPointsCalculator } from "./_StraightPointsCalculator";
import * as THREE from "three";
import {
  calculateStraightDistance,
  calculateCurveLength,
} from "@/utils/geometry/calculateDistance";

// 각 구간을 정의하는 인터페이스
export interface PathSegmentDef {
  type: "STRAIGHT" | "CURVE";
  from: Node;
  to: Node;
  angle?: number;  // 곡선일 경우 필수
  radius?: number; // 곡선일 경우 필수
}

export class EdgePathGenerator {
  /**
   * 여러 구간(직선/곡선)으로 이루어진 엣지의 전체 포인트를 생성합니다.
   */
  static generate(
    segments: PathSegmentDef[],
    totalSegments: number,
    zOffset: number
  ): THREE.Vector3[] {
    // 1. 전체 길이 및 각 구간 길이 계산
    const lengths = segments.map((seg) => {
      if (seg.type === "STRAIGHT") {
        return calculateStraightDistance(seg.from, seg.to);
      } else {
        return calculateCurveLength(seg.radius!, seg.angle!);
      }
    });

    const totalLength = lengths.reduce((sum, len) => sum + len, 0);

    // 2. 세그먼트 개수 배분 (최소 1개 보장)
    const segmentCounts = lengths.map((len) =>
      Math.max(1, Math.round(totalSegments * (len / totalLength)))
    );

    // 3. 반올림 오차 보정 (가장 긴 구간에 나머지 할당)
    const assignedTotal = segmentCounts.reduce((sum, cnt) => sum + cnt, 0);
    const diff = totalSegments - assignedTotal;

    if (diff !== 0) {
      // 가장 긴 구간의 인덱스 찾기
      let maxLenIndex = 0;
      let maxLen = lengths[0];
      for (let i = 1; i < lengths.length; i++) {
        if (lengths[i] > maxLen) {
          maxLen = lengths[i];
          maxLenIndex = i;
        }
      }
      segmentCounts[maxLenIndex] += diff;
    }

    // 4. 포인트 생성 루프
    const allPoints: THREE.Vector3[] = [];
    
    // 곡선 계산을 위한 이전 직선 방향 캐싱용
    let lastStraightDirection: Direction | null = null;

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const count = segmentCounts[i];

      if (seg.type === "STRAIGHT") {
        const points = StraightPointsCalculator.calculateSegmentedPoints(
          seg.from,
          seg.to,
          count
        );
        allPoints.push(...points);
        
        // 다음 곡선을 위해 직선 방향 저장
        lastStraightDirection = DirectionUtils.getLineDirection(seg.from, seg.to);
      } else {
        // CURVE
        // 곡선은 진입하는 직선의 방향이 필요함
        const direction = lastStraightDirection ?? DirectionUtils.getLineDirection(seg.from, seg.to);        const points = DirectionUtils.calculateCurveAreaPoints(
          seg.from,
          seg.to,
          direction,
          seg.radius,
          seg.angle,
          count,
          "from"
        );
        allPoints.push(...points);
        
        // 곡선 이후의 방향? 
        // 일반적으로 곡선 다음 직선이 나오면 그 직선에서 다시 getLineDirection을 하므로 
        // 여기서 update할 필요는 없지만, CSC 같은 경우 곡선->직선->곡선 이라서 
        // 다음 루프(직선)에서 lastStraightDirection이 갱신됨.
        // 만약 곡선->곡선 이라면? 
        // 현재 로직상 곡선 끝에서 방향을 유추해야 하는데 복잡함.
        // 하지만 use case상 직선->곡선 패턴이 주류임.
      }
    }
    // 5. Z 오프셋 적용
    return allPoints.map(
      (p) => new THREE.Vector3(p.x, p.y, p.z + zOffset)
    );
  }
}
