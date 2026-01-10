// fabUtils.ts
// Fab (Fabrication) system utilities for creating multiple map instances

import { Node, Edge } from "@/types";
import { Station } from "@/store/map/stationStore";
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



// ============================================================================
// [3] FAB2 - Node/Edge Cloning with ID offset
// ============================================================================



// ============================================================================
// [4] FAB Grid - Multiple FABs in X * Y grid
// ============================================================================

/**
 * 노드 이름에서 숫자 부분에 특정 값을 더함
 * @param name - 원본 이름
 * @param offset - 더할 값 (예: 1000, 2000, ...)
 * @returns 오프셋이 적용된 새 이름
 */
function addOffsetToId(name: string, offset: number): string {
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

// FabInfo는 fabStore에서 정의
export type { FabInfo } from "@/store/map/fabStore";

/**
 * 노드 위치를 기반으로 해당 노드가 속한 fab 인덱스 찾기
 * @param nodeX - 노드의 editor_x
 * @param nodeY - 노드의 editor_y
 * @param fabs - FabInfo 배열
 * @returns fabIndex (-1 if not found)
 */
export function findFabIndexByPosition(
  nodeX: number,
  nodeY: number,
  fabs: import("@/store/map/fabStore").FabInfo[]
): number {
  for (const fab of fabs) {
    if (
      nodeX >= fab.xMin &&
      nodeX <= fab.xMax &&
      nodeY >= fab.yMin &&
      nodeY <= fab.yMax
    ) {
      return fab.fabIndex;
    }
  }
  return -1;
}

/**
 * 노드 배열에서 가시 fab에 속한 노드만 필터링
 * @param nodes - 전체 노드 배열
 * @param fabs - FabInfo 배열
 * @param visibleFabIndices - 가시 fab 인덱스 Set
 * @returns 가시 fab에 속한 노드들만
 */
export function filterNodesByVisibleFabs(
  nodes: Node[],
  fabs: import("@/store/map/fabStore").FabInfo[],
  visibleFabIndices: Set<number>
): Node[] {
  // 단일 fab이면 전체 반환
  if (fabs.length <= 1) return nodes;
  // 모든 fab이 visible이면 전체 반환
  if (visibleFabIndices.size === fabs.length) return nodes;

  return nodes.filter(node => {
    const fabIdx = findFabIndexByPosition(node.editor_x, node.editor_y, fabs);
    return fabIdx === -1 || visibleFabIndices.has(fabIdx);
  });
}

/**
 * 엣지 배열에서 가시 fab에 속한 엣지만 필터링
 * (renderingPoints의 첫 번째 점 위치로 판단)
 */
export function filterEdgesByVisibleFabs(
  edges: Edge[],
  fabs: import("@/store/map/fabStore").FabInfo[],
  visibleFabIndices: Set<number>
): Edge[] {
  if (fabs.length <= 1) return edges;
  if (visibleFabIndices.size === fabs.length) return edges;

  return edges.filter(edge => {
    if (!edge.renderingPoints || edge.renderingPoints.length === 0) return true;
    const firstPoint = edge.renderingPoints[0];
    const fabIdx = findFabIndexByPosition(firstPoint.x, firstPoint.y, fabs);
    return fabIdx === -1 || visibleFabIndices.has(fabIdx);
  });
}

/**
 * 스테이션 배열에서 가시 fab에 속한 스테이션만 필터링
 */
export function filterStationsByVisibleFabs<T extends { position: { x: number; y: number } }>(
  stations: T[],
  fabs: import("@/store/map/fabStore").FabInfo[],
  visibleFabIndices: Set<number>
): T[] {
  if (fabs.length <= 1) return stations;
  if (visibleFabIndices.size === fabs.length) return stations;

  return stations.filter(station => {
    const fabIdx = findFabIndexByPosition(station.position.x, station.position.y, fabs);
    return fabIdx === -1 || visibleFabIndices.has(fabIdx);
  });
}

/**
 * Fab grid 생성 시 각 fab의 정보 배열 생성
 * @param gridX - 가로 fab 개수
 * @param gridY - 세로 fab 개수
 * @param bounds - 원본 맵의 bounds
 * @param spacingPercent - fab 간격 (기본 10%)
 */
export function createFabInfos(
  gridX: number,
  gridY: number,
  bounds: MapBounds,
  spacingPercent: number = 10
): import("@/store/map/fabStore").FabInfo[] {
  const fabInfos: import("@/store/map/fabStore").FabInfo[] = [];
  const spacing = 1 + spacingPercent / 100; // 1.1 for 10%

  for (let row = 0; row < gridY; row++) {
    for (let col = 0; col < gridX; col++) {
      const fabIndex = row * gridX + col;

      const offsetX = col * bounds.width * spacing;
      const offsetY = row * bounds.height * spacing;

      const xMin = bounds.xMin + offsetX;
      const xMax = bounds.xMax + offsetX;
      const yMin = bounds.yMin + offsetY;
      const yMax = bounds.yMax + offsetY;

      fabInfos.push({
        fabIndex,
        col,
        row,
        xMin,
        xMax,
        yMin,
        yMax,
        centerX: (xMin + xMax) / 2,
        centerY: (yMin + yMax) / 2,
      });
    }
  }

  return fabInfos;
}



// ============================================================================
// [7] Station Clone Functions for FAB Grid
// ============================================================================

/**
 * Create station name with fab suffix (fab_col_row format)
 * @param originalName - Original station name
 * @param col - Column index (0-based)
 * @param row - Row index (0-based)
 * @returns New station name with fab suffix
 */
function createFabStationName(originalName: string, col: number, row: number): string {
  // fab_0_0 is original (no suffix), others get fab_col_row suffix
  if (col === 0 && row === 0) {
    return originalName;
  }
  return `${originalName}_fab_${col}_${row}`;
}

/**
 * Create edge name with fab suffix for station's nearest_edge
 * @param originalEdgeName - Original edge name
 * @param fabIndex - Fab index (0 for original)
 * @returns New edge name with offset
 */
function createFabEdgeName(originalEdgeName: string, fabIndex: number): string {
  if (fabIndex === 0) {
    return originalEdgeName;
  }
  // Use the same offset logic as edges
  const idOffset = fabIndex * 1000;
  return addOffsetToId(originalEdgeName, idOffset);
}

/**
 * Clone a single station for fab grid
 * @param station - Original station
 * @param col - Column index
 * @param row - Row index
 * @param fabIndex - Fab index (row * gridX + col)
 * @param xOffset - X coordinate offset
 * @param yOffset - Y coordinate offset
 * @returns Cloned station
 */
function cloneFabStation(
  station: Station,
  col: number,
  row: number,
  fabIndex: number,
  xOffset: number,
  yOffset: number
): Station {
  return {
    ...station,
    station_name: createFabStationName(station.station_name, col, row),
    nearest_edge: createFabEdgeName(station.nearest_edge, fabIndex),
    position: {
      x: station.position.x + xOffset,
      y: station.position.y + yOffset,
      z: station.position.z,
    },
  };
}

/**
 * Create FAB Grid for stations
 * @param stations - Original station array
 * @param gridX - Number of columns
 * @param gridY - Number of rows
 * @param bounds - Map bounds for offset calculation
 * @returns All stations including originals and clones
 */
export function createFabGridStations(
  stations: Station[],
  gridX: number,
  gridY: number,
  bounds: MapBounds
): Station[] {
  if (stations.length === 0) {
    return [];
  }

  const xOffset = bounds.width * 1.1;
  const yOffset = bounds.height * 1.1;

  const allStations: Station[] = [];

  for (let row = 0; row < gridY; row++) {
    for (let col = 0; col < gridX; col++) {
      const fabIndex = row * gridX + col;
      const currentXOffset = col * xOffset;
      const currentYOffset = row * yOffset;

      if (fabIndex === 0) {
        // Original stations
        allStations.push(...stations);
      } else {
        // Cloned stations
        const clonedStations = stations.map(station =>
          cloneFabStation(station, col, row, fabIndex, currentXOffset, currentYOffset)
        );
        allStations.push(...clonedStations);
      }
    }
  }

  return allStations;
}

// ============================================================================
// [8] FAB Grid Separated - Each Fab as separate data (for Multi-Worker)
// ============================================================================

/**
 * 개별 Fab 데이터 (멀티 워커용)
 */
export interface FabData {
  fabId: string;
  fabIndex: number;
  col: number;
  row: number;
  nodes: Node[];
  edges: Edge[];
  stations: Station[];
}

/**
 * FAB Grid 생성 (각 Fab별로 분리된 데이터 반환)
 * 멀티 워커 시뮬레이션용
 */
export function createFabGridSeparated(
  nodes: Node[],
  edges: Edge[],
  stations: Station[],
  gridX: number,
  gridY: number
): FabData[] {
  if (nodes.length === 0 || edges.length === 0) {
    return [];
  }

  const bounds = getNodeBounds(nodes);
  const xOffset = bounds.width * 1.1;
  const yOffset = bounds.height * 1.1;

  const fabDataList: FabData[] = [];

  for (let row = 0; row < gridY; row++) {
    for (let col = 0; col < gridX; col++) {
      const fabIndex = row * gridX + col;
      const idOffset = fabIndex * 1000;
      const fabId = `fab_${col}_${row}`;

      const currentXOffset = col * xOffset;
      const currentYOffset = row * yOffset;

      let fabNodes: Node[];
      let fabEdges: Edge[];
      let fabStations: Station[];

      if (fabIndex === 0) {
        // 원본
        fabNodes = [...nodes];
        fabEdges = [...edges];
        fabStations = [...stations];
      } else {
        // 복제본
        fabNodes = nodes.map(node => ({
          ...node,
          node_name: addOffsetToId(node.node_name, idOffset),
          editor_x: node.editor_x + currentXOffset,
          editor_y: node.editor_y + currentYOffset,
        }));

        fabEdges = edges.map(edge => {
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

        fabStations = stations.map(station =>
          cloneFabStation(station, col, row, fabIndex, currentXOffset, currentYOffset)
        );
      }

      fabDataList.push({
        fabId,
        fabIndex,
        col,
        row,
        nodes: fabNodes,
        edges: fabEdges,
        stations: fabStations,
      });
    }
  }

  return fabDataList;
}
