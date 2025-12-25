// fabUtils.ts
// Fab (Fabrication) system utilities for creating multiple map instances

import { Node, Edge } from "@/types";
import * as THREE from "three";

export interface MapBounds {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  width: number;
  height: number;
}

// ============================================================================
// [1] Bounds Calculation (xmin, xmax, ymin, ymax)
// ============================================================================

/**
 * nodes.cfg 데이터에서 xmin, xmax, ymin, ymax를 계산
 * @param nodes - Node 배열
 * @returns MapBounds 객체
 */
export function getNodeBounds(nodes: Node[]): MapBounds {
  if (nodes.length === 0) {
    return { xMin: 0, xMax: 0, yMin: 0, yMax: 0, width: 0, height: 0 };
  }

  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;

  for (const node of nodes) {
    if (node.editor_x < xMin) xMin = node.editor_x;
    if (node.editor_x > xMax) xMax = node.editor_x;
    if (node.editor_y < yMin) yMin = node.editor_y;
    if (node.editor_y > yMax) yMax = node.editor_y;
  }

  return {
    xMin,
    xMax,
    yMin,
    yMax,
    width: xMax - xMin,
    height: yMax - yMin,
  };
}

// ============================================================================
// [2] FAB1 - Bounding Rectangle
// ============================================================================

export interface BoundingRectangle {
  topLeft: { x: number; y: number };
  topRight: { x: number; y: number };
  bottomLeft: { x: number; y: number };
  bottomRight: { x: number; y: number };
  width: number;
  height: number;
}

/**
 * FAB1: 모든 노드를 포함하는 바운딩 사각형 생성
 * @param nodes - Node 배열
 * @param padding - 여백 (기본값: 0)
 * @returns BoundingRectangle 객체
 */
export function createFab1BoundingRect(nodes: Node[], padding: number = 0): BoundingRectangle {
  const bounds = getNodeBounds(nodes);

  return {
    topLeft: { x: bounds.xMin - padding, y: bounds.yMax + padding },
    topRight: { x: bounds.xMax + padding, y: bounds.yMax + padding },
    bottomLeft: { x: bounds.xMin - padding, y: bounds.yMin - padding },
    bottomRight: { x: bounds.xMax + padding, y: bounds.yMin - padding },
    width: bounds.width + padding * 2,
    height: bounds.height + padding * 2,
  };
}

// ============================================================================
// [3] FAB2 - Node/Edge Cloning with ID offset
// ============================================================================

/**
 * 노드 이름에서 숫자 부분에 1000을 더함
 * N0001 → N1001, NODE0001 → NODE1001, TMP_FROM_E0002 → TMP_FROM_E1002
 * @param name - 원본 이름
 * @returns 1000이 더해진 새 이름
 */
export function addThousandToId(name: string): string {
  // 마지막 숫자 부분을 찾아서 1000을 더함
  const match = /^(.*)(\d{4})$/.exec(name);
  if (!match) {
    // 4자리 숫자가 없으면 원본 반환
    return name;
  }

  const prefix = match[1];
  const numStr = match[2];
  const num = Number.parseInt(numStr, 10);
  const newNum = num + 1000;

  // 4자리로 패딩 (1000을 더했으므로 최소 1000)
  return `${prefix}${newNum.toString().padStart(4, '0')}`;
}

/**
 * FAB2: 노드를 복제하고 이름에 1000을 더하고 x좌표를 오프셋
 * @param nodes - 원본 Node 배열
 * @param xOffset - x좌표에 더할 값 ((xmax-xmin) * 1.1)
 * @returns 복제된 Node 배열
 */
export function cloneFab2Nodes(nodes: Node[], xOffset: number): Node[] {
  return nodes.map(node => ({
    ...node,
    node_name: addThousandToId(node.node_name),
    editor_x: node.editor_x + xOffset,
  }));
}

/**
 * FAB2: 엣지를 복제하고 이름에 1000을 더함 (edge_name, from_node, to_node, waypoints)
 * @param edges - 원본 Edge 배열
 * @param xOffset - x좌표에 더할 값 (renderingPoints용)
 * @returns 복제된 Edge 배열
 */
export function cloneFab2Edges(edges: Edge[], xOffset: number): Edge[] {
  return edges.map(edge => {
    // waypoints의 모든 노드 이름에 1000을 더함
    const newWaypoints = edge.waypoints.map(wp => addThousandToId(wp));

    // renderingPoints도 x좌표 오프셋 적용
    let newRenderingPoints = edge.renderingPoints;
    if (edge.renderingPoints) {
      newRenderingPoints = edge.renderingPoints.map(point =>
        new THREE.Vector3(
          point.x + xOffset,
          point.y,
          point.z
        )
      );
    }

    return {
      ...edge,
      edge_name: addThousandToId(edge.edge_name),
      from_node: addThousandToId(edge.from_node),
      to_node: addThousandToId(edge.to_node),
      waypoints: newWaypoints,
      renderingPoints: newRenderingPoints,
    };
  });
}

/**
 * FAB2 전체 생성: 노드와 엣지를 복제하여 fab2 생성
 * @param nodes - 원본 Node 배열
 * @param edges - 원본 Edge 배열
 * @returns { fab2Nodes, fab2Edges, xOffset } - 복제된 노드/엣지와 사용된 오프셋
 */
export function createFab2(nodes: Node[], edges: Edge[]): {
  fab2Nodes: Node[];
  fab2Edges: Edge[];
  xOffset: number;
} {
  const bounds = getNodeBounds(nodes);
  const xOffset = bounds.width * 1.1;

  const fab2Nodes = cloneFab2Nodes(nodes, xOffset);
  const fab2Edges = cloneFab2Edges(edges, xOffset);

  return { fab2Nodes, fab2Edges, xOffset };
}

// ============================================================================
// [4] FAB Grid - Multiple FABs in X * Y grid
// ============================================================================

/**
 * 노드 이름에서 숫자 부분에 특정 값을 더함
 * @param name - 원본 이름
 * @param offset - 더할 값 (예: 1000, 2000, ...)
 * @returns 오프셋이 적용된 새 이름
 */
export function addOffsetToId(name: string, offset: number): string {
  const match = /^(.*)(\d{4})$/.exec(name);
  if (!match) {
    return name;
  }

  const prefix = match[1];
  const numStr = match[2];
  const num = Number.parseInt(numStr, 10);
  const newNum = num + offset;

  return `${prefix}${newNum.toString().padStart(4, '0')}`;
}

/**
 * FAB Grid 생성: X * Y 그리드 형태로 FAB 복제
 * @param nodes - 원본 Node 배열
 * @param edges - 원본 Edge 배열
 * @param gridX - 가로 개수 (1 = 원본만)
 * @param gridY - 세로 개수 (1 = 원본만)
 * @returns { allNodes, allEdges } - 전체 노드/엣지 (원본 포함)
 */
export function createFabGrid(
  nodes: Node[],
  edges: Edge[],
  gridX: number,
  gridY: number
): {
  allNodes: Node[];
  allEdges: Edge[];
} {
  if (nodes.length === 0 || edges.length === 0) {
    return { allNodes: nodes, allEdges: edges };
  }

  const bounds = getNodeBounds(nodes);
  const xOffset = bounds.width * 1.1;  // 10% 간격
  const yOffset = bounds.height * 1.1; // 10% 간격

  const allNodes: Node[] = [];
  const allEdges: Edge[] = [];

  // 그리드 순회: (0,0)은 원본, 나머지는 복제
  for (let row = 0; row < gridY; row++) {
    for (let col = 0; col < gridX; col++) {
      const fabIndex = row * gridX + col; // 0, 1, 2, ...
      const idOffset = fabIndex * 1000;   // 0, 1000, 2000, ...

      const currentXOffset = col * xOffset;
      const currentYOffset = row * yOffset;

      if (fabIndex === 0) {
        // 원본은 그대로 추가
        allNodes.push(...nodes);
        allEdges.push(...edges);
      } else {
        // 복제본 생성
        const clonedNodes = nodes.map(node => ({
          ...node,
          node_name: addOffsetToId(node.node_name, idOffset),
          editor_x: node.editor_x + currentXOffset,
          editor_y: node.editor_y + currentYOffset,
        }));

        const clonedEdges = edges.map(edge => {
          const newWaypoints = edge.waypoints.map(wp => addOffsetToId(wp, idOffset));

          let newRenderingPoints = edge.renderingPoints;
          if (edge.renderingPoints) {
            newRenderingPoints = edge.renderingPoints.map(point =>
              new THREE.Vector3(
                point.x + currentXOffset,
                point.y + currentYOffset,
                point.z
              )
            );
          }

          return {
            ...edge,
            edge_name: addOffsetToId(edge.edge_name, idOffset),
            from_node: addOffsetToId(edge.from_node, idOffset),
            to_node: addOffsetToId(edge.to_node, idOffset),
            waypoints: newWaypoints,
            renderingPoints: newRenderingPoints,
          };
        });

        allNodes.push(...clonedNodes);
        allEdges.push(...clonedEdges);
      }
    }
  }

  return { allNodes, allEdges };
}

export interface FabOffset {
  offsetX: number;
  offsetY: number;
}

/**
 * Convert 4-digit ID to 5-digit ID format
 * N0001 → N00001
 * E0874 → E00874
 */
export function convertTo5Digit(id: string): string {
  // Extract prefix (N, E, etc.) and number part
  const prefix = /^[A-Z]+/.exec(id)?.[0] || '';
  const numStr = id.slice(prefix.length);
  const num = Number.parseInt(numStr, 10);

  // Convert to 5-digit format with zero-padding
  return `${prefix}${num.toString().padStart(5, '0')}`;
}

/**
 * Calculate map boundaries from nodes
 */
export function calculateMapBounds(nodes: Array<{ x: number; y: number }>): MapBounds {
  if (nodes.length === 0) {
    return { xMin: 0, xMax: 0, yMin: 0, yMax: 0, width: 0, height: 0 };
  }

  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;

  for (const node of nodes) {
    if (node.x < xMin) xMin = node.x;
    if (node.x > xMax) xMax = node.x;
    if (node.y < yMin) yMin = node.y;
    if (node.y > yMax) yMax = node.y;
  }

  return {
    xMin,
    xMax,
    yMin,
    yMax,
    width: xMax - xMin,
    height: yMax - yMin,
  };
}

/**
 * Calculate fab offset based on fab index and grid configuration
 * @param fabIndex - Index of the fab (0, 1, 2, ...)
 * @param gridX - Number of fabs in horizontal direction
 * @param bounds - Map boundaries
 * @param spacingPercent - Spacing between fabs as percentage (default: 10%)
 */
export function getFabOffset(
  fabIndex: number,
  gridX: number,
  bounds: MapBounds,
  spacingPercent: number = 10
): FabOffset {
  const row = Math.floor(fabIndex / gridX); // Vertical position
  const col = fabIndex % gridX;              // Horizontal position

  const spacing = 1 + spacingPercent / 100; // 1.1 for 10%

  const offsetX = col * bounds.width * spacing;
  const offsetY = row * bounds.height * spacing;

  return { offsetX, offsetY };
}

/**
 * Add fab ID offset to a 5-digit ID
 * N00001 + fabIndex 1 → N01001
 * N00658 + fabIndex 2 → N02658
 */
export function addFabIdOffset(id: string, fabIndex: number): string {
  const prefix = /^[A-Z]+/.exec(id)?.[0] || '';
  const numStr = id.slice(prefix.length);
  const num = Number.parseInt(numStr, 10);

  // Add fab offset (fabIndex * 1000)
  const newNum = num + fabIndex * 1000;

  return `${prefix}${newNum.toString().padStart(5, '0')}`;
}

/**
 * Clone node with fab-specific ID and coordinates
 * @param originalNode - Original node to clone
 * @param fabIndex - Fab index (0 for original, 1+ for clones)
 * @param offset - Coordinate offset for this fab
 */
export function cloneFabNode(
  originalNode: Node,
  fabIndex: number,
  offset: FabOffset
): Node {
  // Convert to 5-digit and add fab offset
  const node5digit = convertTo5Digit(originalNode.node_name);
  const newNodeName = addFabIdOffset(node5digit, fabIndex);

  return {
    ...originalNode,
    node_name: newNodeName,
    editor_x: originalNode.editor_x + offset.offsetX,
    editor_y: originalNode.editor_y + offset.offsetY,
    // editor_z remains the same
  };
}

/**
 * Clone edge with fab-specific ID and node references
 * @param originalEdge - Original edge to clone
 * @param fabIndex - Fab index (0 for original, 1+ for clones)
 * @param offset - Coordinate offset for this fab (optional, for renderingPoints)
 */
export function cloneFabEdge(
  originalEdge: Edge,
  fabIndex: number,
  offset?: FabOffset
): Edge {
  // Convert to 5-digit and add fab offset
  const edge5digit = convertTo5Digit(originalEdge.edge_name);
  const newEdgeName = addFabIdOffset(edge5digit, fabIndex);

  // Update from_node and to_node
  const fromNode5digit = convertTo5Digit(originalEdge.from_node);
  const toNode5digit = convertTo5Digit(originalEdge.to_node);
  const newFromNode = addFabIdOffset(fromNode5digit, fabIndex);
  const newToNode = addFabIdOffset(toNode5digit, fabIndex);

  // Update waypoints
  const newWaypoints = originalEdge.waypoints.map(wp => {
    const wp5digit = convertTo5Digit(wp);
    return addFabIdOffset(wp5digit, fabIndex);
  });

  // Update renderingPoints with offset if provided
  let newRenderingPoints = originalEdge.renderingPoints;
  if (offset && originalEdge.renderingPoints) {
    newRenderingPoints = originalEdge.renderingPoints.map(point =>
      new THREE.Vector3(
        point.x + offset.offsetX,
        point.y + offset.offsetY,
        point.z
      )
    );
  }

  return {
    ...originalEdge,
    edge_name: newEdgeName,
    from_node: newFromNode,
    to_node: newToNode,
    waypoints: newWaypoints,
    renderingPoints: newRenderingPoints,
  };
}

/**
 * Clone multiple nodes for a fab
 */
export function cloneFabNodes(
  originalNodes: Node[],
  fabIndex: number,
  offset: FabOffset
): Node[] {
  return originalNodes.map(node => cloneFabNode(node, fabIndex, offset));
}

/**
 * Clone multiple edges for a fab
 */
export function cloneFabEdges(
  originalEdges: Edge[],
  fabIndex: number,
  offset?: FabOffset
): Edge[] {
  return originalEdges.map(edge => cloneFabEdge(edge, fabIndex, offset));
}
