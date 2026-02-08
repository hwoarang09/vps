// checkpoint/builder.test.ts
// Checkpoint 생성 로직 테스트
//
// 테스트 전략:
// 1. 임의의 두 node 선택
// 2. Dijkstra로 경로 생성
// 3. buildCheckpoints 호출
// 4. 모든 checkpoint가 유효한지 확인 (edge가 path에 있는지)
// 5. 경로 내 2번째 edge부터 각 edge에 대해 checkpoint가 잘 설정되었는지 확인

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import Papa from 'papaparse';
import { Edge, EdgeType } from '@/types/edge';
import { findShortestPath, clearPathCache } from '../Dijkstra';
import { buildCheckpointsFromPath } from './index';
import { CheckpointFlags } from '@/common/vehicle/initialize/constants';
import { isCurveEdge } from './utils';

// ============================================================
// CSV 파싱 유틸
// ============================================================

interface EdgeRow {
  edge_name: string;
  from_node: string;
  to_node: string;
  distance: string;
  vos_rail_type: string;
  radius?: string;
  waiting_offset?: string;
}

interface StationRow {
  station_name: string;
  nearest_edge: string;
}

function parseCSV<T>(content: string): T[] {
  const cleanedContent = content
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');

  const result = Papa.parse<T>(cleanedContent, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
    transform: (value) => value.trim(),
  });

  return result.data;
}

// ============================================================
// 맵 데이터 로드
// ============================================================

interface MapData {
  edges: Edge[];
  edgeNameToIndex: Map<string, number>;
  stations: Array<{ name: string; edgeIndex: number }>;
  mergeNodes: Set<string>;
}

function loadYShortMap(): MapData {
  const basePath = path.resolve(__dirname, '../../../../../public/railConfig/y_short');

  // 1. edges.cfg 로드
  const edgesContent = fs.readFileSync(path.join(basePath, 'edges.cfg'), 'utf-8');
  const edgeRows = parseCSV<EdgeRow>(edgesContent);

  const edges: Edge[] = edgeRows
    .filter((row) => row.edge_name && row.from_node && row.to_node)
    .map((row) => {
      const waitingOffsetRaw = row.waiting_offset ? Number.parseFloat(row.waiting_offset) : -1;
      const waitingOffset = waitingOffsetRaw > 0 ? waitingOffsetRaw / 1000 : undefined;

      return {
        edge_name: row.edge_name,
        from_node: row.from_node,
        to_node: row.to_node,
        distance: Number.parseFloat(row.distance) || 0,
        vos_rail_type: row.vos_rail_type as EdgeType,
        radius: row.radius ? Number.parseFloat(row.radius) : undefined,
        waypoints: [],
        waiting_offset: waitingOffset,
      };
    });

  // 2. edgeNameToIndex 맵 생성 (1-based)
  const edgeNameToIndex = new Map<string, number>();
  for (const [idx, edge] of edges.entries()) {
    edgeNameToIndex.set(edge.edge_name, idx + 1); // 1-based
  }

  // 3. topology 계산 (nextEdgeIndices, merge nodes)
  const nodeOutgoingEdges = new Map<string, number[]>();
  const nodeIncomingEdges = new Map<string, number[]>();

  for (const [idx, edge] of edges.entries()) {
    const edgeIdx = idx + 1;

    const outgoing = nodeOutgoingEdges.get(edge.from_node) || [];
    outgoing.push(edgeIdx);
    nodeOutgoingEdges.set(edge.from_node, outgoing);

    const incoming = nodeIncomingEdges.get(edge.to_node) || [];
    incoming.push(edgeIdx);
    nodeIncomingEdges.set(edge.to_node, incoming);
  }

  for (const edge of edges) {
    edge.nextEdgeIndices = nodeOutgoingEdges.get(edge.to_node) || [];
  }

  const mergeNodes = new Set<string>();
  for (const [nodeName, incoming] of nodeIncomingEdges) {
    if (incoming.length > 1) {
      mergeNodes.add(nodeName);
    }
  }

  // 4. stations 로드
  const stationsContent = fs.readFileSync(path.join(basePath, 'station.map'), 'utf-8');
  const stationRows = parseCSV<StationRow>(stationsContent);

  const stations: Array<{ name: string; edgeIndex: number }> = [];
  for (const row of stationRows) {
    if (row.station_name && row.nearest_edge) {
      const edgeIdx = edgeNameToIndex.get(row.nearest_edge);
      if (edgeIdx !== undefined) {
        stations.push({ name: row.station_name, edgeIndex: edgeIdx });
      }
    }
  }

  return { edges, edgeNameToIndex, stations, mergeNodes };
}

// ============================================================
// 메인 테스트
// ============================================================

describe('Checkpoint Builder - Simple Validation', () => {
  let mapData: MapData;

  beforeAll(() => {
    mapData = loadYShortMap();
    clearPathCache();
  });

  it('should load y_short map correctly', () => {
    expect(mapData.edges.length).toBeGreaterThan(0);
    expect(mapData.stations.length).toBeGreaterThan(0);
    console.log(`Loaded ${mapData.edges.length} edges, ${mapData.stations.length} stations, ${mapData.mergeNodes.size} merge nodes`);
  });

  /**
   * 핵심 검증 함수
   * @param pathIndices - 경로 (1-based edge indices)
   * @returns 검증 결과
   */
  function validateCheckpoints(pathIndices: number[]): {
    allCheckpointsValid: boolean;
    allEdgesCovered: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    // Checkpoint 생성
    const result = buildCheckpointsFromPath({
      edgeIndices: pathIndices,
      edgeArray: mapData.edges,
      isMergeNode: (nodeName) => mapData.mergeNodes.has(nodeName),
    });

    const checkpoints = result.checkpoints;
    const pathSet = new Set(pathIndices);

    // ============================================================
    // 검증 1: 모든 checkpoint의 edge가 path에 있는지
    // ============================================================
    let allCheckpointsValid = true;
    for (const cp of checkpoints) {
      if (!pathSet.has(cp.edge)) {
        allCheckpointsValid = false;
        errors.push(`Checkpoint edge ${cp.edge} is NOT in path`);
      }
    }

    // ============================================================
    // 검증 2: 경로 내 2번째 edge부터 각 edge에 대해 checkpoint 확인
    // ============================================================
    // 각 target edge에 대해:
    // - MOVE_PREPARE checkpoint가 있어야 함
    // - target edge의 from_node가 merge면 LOCK_REQUEST, LOCK_WAIT도 있어야 함
    let allEdgesCovered = true;

    for (let i = 1; i < pathIndices.length; i++) {
      const targetEdgeIdx = pathIndices[i];
      const targetEdge = mapData.edges[targetEdgeIdx - 1];
      const isMerge = mapData.mergeNodes.has(targetEdge.from_node);

      // target edge를 위한 checkpoint 찾기
      // checkpoint는 target 이전 edge들에 있어야 함
      const targetPrecedingEdges = new Set(pathIndices.slice(0, i));

      // MOVE_PREPARE 체크
      const hasMovePrep = checkpoints.some(
        (cp) => targetPrecedingEdges.has(cp.edge) && (cp.flags & CheckpointFlags.MOVE_PREPARE)
      );

      if (!hasMovePrep) {
        allEdgesCovered = false;
        errors.push(`[${i}] ${targetEdge.edge_name}: Missing MOVE_PREPARE checkpoint`);
      }

      // Merge인 경우 LOCK_REQUEST, LOCK_WAIT 체크
      if (isMerge) {
        const hasLockReq = checkpoints.some(
          (cp) => targetPrecedingEdges.has(cp.edge) && (cp.flags & CheckpointFlags.LOCK_REQUEST)
        );

        if (!hasLockReq) {
          allEdgesCovered = false;
          errors.push(`[${i}] ${targetEdge.edge_name}: Missing LOCK_REQUEST checkpoint (merge node: ${targetEdge.from_node})`);
        }

        // LOCK_WAIT는 incomingEdge에 waiting_offset이 있거나 곡선인 경우만
        const incomingEdgeIdx = pathIndices[i - 1];
        const incomingEdge = mapData.edges[incomingEdgeIdx - 1];
        const needsWait = isCurveEdge(incomingEdge) || (incomingEdge.waiting_offset && incomingEdge.waiting_offset > 0);

        if (needsWait) {
          const hasLockWait = checkpoints.some(
            (cp) => targetPrecedingEdges.has(cp.edge) && (cp.flags & CheckpointFlags.LOCK_WAIT)
          );

          if (!hasLockWait) {
            allEdgesCovered = false;
            errors.push(`[${i}] ${targetEdge.edge_name}: Missing LOCK_WAIT checkpoint`);
          }
        }
      }
    }

    return { allCheckpointsValid, allEdgesCovered, errors };
  }

  it('should validate single path', () => {
    // 임의의 두 station 선택
    const startStation = mapData.stations[5];
    const endStation = mapData.stations[20];

    // Dijkstra로 경로 생성
    const pathIndices = findShortestPath(startStation.edgeIndex, endStation.edgeIndex, mapData.edges);
    expect(pathIndices).not.toBeNull();
    expect(pathIndices!.length).toBeGreaterThan(1);

    console.log(`\nPath: ${startStation.name} → ${endStation.name}`);
    console.log(`Path length: ${pathIndices!.length} edges`);

    // 경로 출력
    console.log('Path edges:');
    for (const [i, edgeIdx] of pathIndices!.entries()) {
      const edge = mapData.edges[edgeIdx - 1];
      const isMerge = mapData.mergeNodes.has(edge.from_node);
      console.log(`  [${i}] ${edge.edge_name}: ${edge.from_node}→${edge.to_node} | dist=${edge.distance.toFixed(2)}m | type=${edge.vos_rail_type} | merge=${isMerge} | offset=${edge.waiting_offset?.toFixed(2) || '-'}`);
    }

    // Checkpoint 생성 및 출력
    const result = buildCheckpointsFromPath({
      edgeIndices: pathIndices!,
      edgeArray: mapData.edges,
      isMergeNode: (nodeName) => mapData.mergeNodes.has(nodeName),
    });

    console.log('\nCheckpoints:');
    for (const [idx, cp] of result.checkpoints.entries()) {
      const flags: string[] = [];
      if (cp.flags & CheckpointFlags.MOVE_PREPARE) flags.push('PREP');
      if (cp.flags & CheckpointFlags.LOCK_REQUEST) flags.push('REQ');
      if (cp.flags & CheckpointFlags.LOCK_WAIT) flags.push('WAIT');
      if (cp.flags & CheckpointFlags.LOCK_RELEASE) flags.push('REL');

      const edge = mapData.edges[cp.edge - 1];
      console.log(`  [${idx}] ${edge.edge_name}@${cp.ratio.toFixed(3)} [${flags.join('|')}]`);
    }

    // 검증
    const validation = validateCheckpoints(pathIndices!);

    console.log('\nValidation:');
    console.log(`  All checkpoints valid: ${validation.allCheckpointsValid}`);
    console.log(`  All edges covered: ${validation.allEdgesCovered}`);

    if (validation.errors.length > 0) {
      console.log('Errors:');
      for (const e of validation.errors) {
        console.log(`  ${e}`);
      }
    }

    expect(validation.allCheckpointsValid).toBe(true);
    expect(validation.allEdgesCovered).toBe(true);
  });

  it('should validate 100 random paths', () => {
    const ITERATIONS = 100;
    let passedCount = 0;
    let failedCount = 0;
    const allErrors: string[] = [];

    for (let iter = 0; iter < ITERATIONS; iter++) {
      // 임의의 두 station 선택
      const startIdx = Math.floor(Math.random() * mapData.stations.length);
      let endIdx = Math.floor(Math.random() * mapData.stations.length);
      while (endIdx === startIdx) {
        endIdx = Math.floor(Math.random() * mapData.stations.length);
      }

      const startStation = mapData.stations[startIdx];
      const endStation = mapData.stations[endIdx];

      // Dijkstra로 경로 생성
      const pathIndices = findShortestPath(startStation.edgeIndex, endStation.edgeIndex, mapData.edges);

      if (!pathIndices || pathIndices.length < 2) continue;

      // 검증
      const validation = validateCheckpoints(pathIndices);

      if (validation.allCheckpointsValid && validation.allEdgesCovered) {
        passedCount++;
      } else {
        failedCount++;
        if (allErrors.length < 10) {
          allErrors.push(`[${iter}] ${startStation.name} → ${endStation.name}:`);
          for (const e of validation.errors.slice(0, 3)) {
            allErrors.push(`  ${e}`);
          }
        }
      }
    }

    console.log(`\n=== Random Path Validation (${ITERATIONS} paths) ===`);
    console.log(`Passed: ${passedCount}, Failed: ${failedCount}`);

    if (allErrors.length > 0) {
      console.log('\nFirst errors:');
      allErrors.forEach((e) => console.log(e));
    }

    expect(failedCount).toBe(0);
  });

  it('should validate 500 random paths (stress test)', () => {
    const ITERATIONS = 500;
    let passedCount = 0;
    let failedCount = 0;

    for (let iter = 0; iter < ITERATIONS; iter++) {
      const startIdx = Math.floor(Math.random() * mapData.stations.length);
      let endIdx = Math.floor(Math.random() * mapData.stations.length);
      while (endIdx === startIdx) {
        endIdx = Math.floor(Math.random() * mapData.stations.length);
      }

      const pathIndices = findShortestPath(
        mapData.stations[startIdx].edgeIndex,
        mapData.stations[endIdx].edgeIndex,
        mapData.edges
      );

      if (!pathIndices || pathIndices.length < 2) continue;

      const validation = validateCheckpoints(pathIndices);

      if (validation.allCheckpointsValid && validation.allEdgesCovered) {
        passedCount++;
      } else {
        failedCount++;
      }
    }

    console.log(`\n=== Stress Test (${ITERATIONS} paths) ===`);
    console.log(`Passed: ${passedCount}, Failed: ${failedCount}`);

    expect(failedCount).toBe(0);
  });
});
