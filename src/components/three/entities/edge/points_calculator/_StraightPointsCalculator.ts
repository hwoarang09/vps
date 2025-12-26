import { Node } from "@/types";
import * as THREE from "three";

/**
 * Calculate waypoints for straight edges (LINEAR/S type)
 */
export class StraightPointsCalculator {
  /**
   * Calculate 3D points for rendering straight edge
   * @param edgeRowData CFG에서 파싱된 edge row 데이터
   * @param nodes 전체 노드 배열
   * @returns 3D 렌더링 포인트 배열
   */
  static calculate(edgeRowData: any, nodes: Node[]): THREE.Vector3[] {
    const { from_node, to_node } = edgeRowData;

    const fromNode = nodes.find((n: Node) => n.node_name === from_node);
    const toNode = nodes.find((n: Node) => n.node_name === to_node);

    if (!fromNode || !toNode) {
      console.warn(`LINEAR nodes not found: ${from_node} or ${to_node}`);
      return [];
    }

    // For straight line, we only need start and end points
    const points = [
      new THREE.Vector3(
        fromNode.editor_x,
        fromNode.editor_y,
        fromNode.editor_z
      ),
      new THREE.Vector3(toNode.editor_x, toNode.editor_y, toNode.editor_z),
    ];

    return points;
  }

  /**
   * 두 노드 사이를 지정된 세그먼트 수만큼 나누어 점들을 생성
   * @param nodeA 시작 노드
   * @param nodeB 끝 노드
   * @param segments 세그먼트 수 (점의 개수)
   * @returns 3D 점 배열
   */
  static calculateSegmentedPoints(
    nodeA: Node,
    nodeB: Node,
    segments: number
  ): THREE.Vector3[] {
    if (segments < 2) {
      console.warn(`Invalid segments count: ${segments}. Using minimum 2.`);
      segments = 2;
    }

    const points: THREE.Vector3[] = [];

    // 시작점과 끝점 좌표
    const startX = nodeA.editor_x;
    const startY = nodeA.editor_y;
    const startZ = nodeA.editor_z || 0;

    const endX = nodeB.editor_x;
    const endY = nodeB.editor_y;
    const endZ = nodeB.editor_z || 0;

    // segments개의 점을 생성 (시작점과 끝점 포함)
    for (let i = 0; i < segments; i++) {
      const t = i / (segments - 1); // 0부터 1까지의 비율

      const x = startX + (endX - startX) * t;
      const y = startY + (endY - startY) * t;
      const z = startZ + (endZ - startZ) * t;

      points.push(new THREE.Vector3(x, y, z));
    }

    return points;
  }
}
