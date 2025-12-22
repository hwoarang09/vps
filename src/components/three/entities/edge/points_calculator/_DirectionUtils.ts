import { Node } from "../../../../../types";
import * as THREE from "three";

/**
 * 직선의 방향 타입 (4방향만 지원)
 */
export type Direction = "+x" | "-x" | "+y" | "-y";

/**
 * 방향 관련 유틸리티 함수들
 */
export class DirectionUtils {
  /**
   * 두 노드 사이의 직선 방향을 구함 (4방향만)
   */
  static getLineDirection(fromNode: Node, toNode: Node): Direction {
    const dx = toNode.editor_x - fromNode.editor_x;
    const dy = toNode.editor_y - fromNode.editor_y;

    // x, y 중 어느 쪽이 더 많이 변했는지 확인
    if (Math.abs(dx) > Math.abs(dy)) {
      // x 방향으로 더 많이 변함
      return dx > 0 ? "+x" : "-x";
    } else {
      // y 방향으로 더 많이 변함
      return dy > 0 ? "+y" : "-y";
    }
  }

  /**
   * 90도 곡선의 호 중심 좌표를 계산
   * @param bNode 곡선 시작점 (b)
   * @param cNode 곡선 끝점 (c)
   * @param fromDirection from쪽 직선의 방향
   * @param radius 곡선 반지름
   */
 static calculateArcCenter(
    bNode: Node,
    cNode: Node,
    fromDirection: Direction,
    radius: number
  ): [number, number, number] {
    let { editor_x: centerX, editor_y: centerY, editor_z: centerZ } = bNode;

    // Check if the direction is horizontal (+x or -x)
    const isHorizontal = fromDirection === "+x" || fromDirection === "-x";

    if (isHorizontal) {
      // Logic for both +x and -x is identical: modify centerY based on cNode's Y
      const sign = cNode.editor_y > bNode.editor_y ? 1 : -1;
      centerY += sign * radius;
    } else {
      // Logic for both +y and -y is identical: modify centerX based on cNode's X
      const sign = cNode.editor_x > bNode.editor_x ? 1 : -1;
      centerX += sign * radius;
    }
    return [centerX, centerY, centerZ];
  }

  /**
   * 직선 방향과 곡선 끝점에 따라 곡선 회전 방향 결정
   * @param straightDirection 직선의 진행 방향
   * @param curveStartNode 곡선 시작점
   * @param curveEndNode 곡선 끝점
   * @returns 1: 반시계방향, -1: 시계방향
   */
  static getCurveRotationDirection(
    straightDirection: Direction,
    curveStartNode: Node,
    curveEndNode: Node
  ): number {
    const dx = curveEndNode.editor_x - curveStartNode.editor_x;
    const dy = curveEndNode.editor_y - curveStartNode.editor_y;

    switch (straightDirection) {
      case "+x": // 직선이 +x 방향으로 진행
        // 곡선 끝점이 시작점보다 위쪽(+y)에 있으면 반시계방향 회전
        return dy > 0 ? 1 : -1;

      case "-x": // 직선이 -x 방향으로 진행
        // 곡선 끝점이 시작점보다 아래쪽(-y)에 있으면 반시계방향 회전
        return dy < 0 ? 1 : -1;

      case "+y": // 직선이 +y 방향으로 진행
        // 곡선 끝점이 시작점보다 왼쪽(-x)에 있으면 반시계방향 회전
        return dx < 0 ? 1 : -1;

      case "-y": // 직선이 -y 방향으로 진행
        // 곡선 끝점이 시작점보다 오른쪽(+x)에 있으면 반시계방향 회전
        return dx > 0 ? 1 : -1;

      default:
        return 1; // 기본값: 반시계방향
    }
  }

  /**
   * Calculate curve area points for rendering (공용 함수)
   * @param curveStartNode 곡선 시작점 (보통 b노드)
   * @param curveEndNode 곡선 끝점 (보통 c노드)
   * @param straightLineDirection from노드에서 시작된 직선 영역의 방향
   * @param radius 곡선 반지름
   * @param rotationDegrees 곡선 회전 각도 (도 단위: 90, 180, 43 등 모든 각도 가능)
   * @param segments 곡선을 나눌 세그먼트 수
   * @param arcCenterBase 'from': curveStartNode 기준으로 arc center (기본값), 'to': curveEndNode 기준으로 arc center (S자 곡선용)
   */
  static calculateCurveAreaPoints(
    curveStartNode: Node,
    curveEndNode: Node,
    straightLineDirection: Direction,
    radius: number = 0.5,
    rotationDegrees: number = 90,
    segments: number = 16,
    arcCenterBase: "from" | "to" = "from"
  ): THREE.Vector3[] {
    const points: THREE.Vector3[] = [];

    // 1. 원의 중심 계산
    const [centerX, centerY] = DirectionUtils.calculateArcCenter(
      curveStartNode,
      curveEndNode,
      straightLineDirection,
      radius
    );

    // 2. 시작각도 계산
    const startAngle = Math.atan2(
      curveStartNode.editor_y - centerY,
      curveStartNode.editor_x - centerX
    );

    // 3. 직선 방향에 따른 곡선 회전 방향 결정
    const rotationDirection = DirectionUtils.getCurveRotationDirection(
      straightLineDirection,
      curveStartNode,
      curveEndNode
    );

    // 4. 지정된 각도만큼 호를 segments로 나누어 점들 생성
    const rotationRadians = (rotationDegrees * Math.PI) / 180;

    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const angle = startAngle + rotationRadians * rotationDirection * t;

      const x = centerX + Math.cos(angle) * radius;
      const y = centerY + Math.sin(angle) * radius;
      const z =
        curveStartNode.editor_z +
        (curveEndNode.editor_z - curveStartNode.editor_z) * t;

      points.push(new THREE.Vector3(x, y, z));
    }

    return points;
  }
}
