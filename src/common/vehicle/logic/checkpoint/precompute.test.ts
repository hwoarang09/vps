// checkpoint/precompute.test.ts
// 사전계산 캐시 → lookup 결과가 동적 buildCheckpoints 결과와 동등한지 검증

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import Papa from 'papaparse';
import { Edge } from '@/types/edge';
import { EdgeType } from '@/types';
import { findShortestPath, clearPathCache } from '../Dijkstra';
import { buildCheckpointsFromPath } from './index';
import {
  precomputeCheckpoints,
  lookupCheckpointsFromPath,
  type PrecomputedCheckpointMap,
} from './precompute';
import { CheckpointFlags, type Checkpoint } from '@/common/vehicle/initialize/constants';

// ============================================================
// 맵 로드 (builder.test.ts 와 동일)
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

interface MapData {
  edges: Edge[];
  edgeNameToIndex: Map<string, number>;
  stations: Array<{ name: string; edgeIndex: number }>;
  mergeNodes: Set<string>;
}

function loadYShortMap(): MapData {
  const basePath = path.resolve(__dirname, '../../../../../public/railConfig/y_short');

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

  const edgeNameToIndex = new Map<string, number>();
  for (const [idx, edge] of edges.entries()) {
    edgeNameToIndex.set(edge.edge_name, idx + 1);
  }

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
// 비교 유틸
// ============================================================

function checkpointKey(cp: Checkpoint): string {
  // ratio 비교 시 부동소수 오차 허용
  return `${cp.edge}|${cp.targetEdge}|${cp.flags}|${cp.ratio.toFixed(6)}`;
}

interface DiffResult {
  match: boolean;
  onlyInDynamic: Checkpoint[];
  onlyInLookup: Checkpoint[];
}

function diffCheckpoints(dynamic: Checkpoint[], lookup: Checkpoint[]): DiffResult {
  const dynKeys = new Set(dynamic.map(checkpointKey));
  const lookupKeys = new Set(lookup.map(checkpointKey));

  const onlyInDynamic = dynamic.filter((cp) => !lookupKeys.has(checkpointKey(cp)));
  const onlyInLookup = lookup.filter((cp) => !dynKeys.has(checkpointKey(cp)));

  return {
    match: onlyInDynamic.length === 0 && onlyInLookup.length === 0,
    onlyInDynamic,
    onlyInLookup,
  };
}

function formatCp(cp: Checkpoint, edges: Edge[]): string {
  const flags: string[] = [];
  if (cp.flags & CheckpointFlags.MOVE_PREPARE) flags.push('PREP');
  if (cp.flags & CheckpointFlags.LOCK_REQUEST) flags.push('REQ');
  if (cp.flags & CheckpointFlags.LOCK_WAIT) flags.push('WAIT');
  if (cp.flags & CheckpointFlags.LOCK_RELEASE) flags.push('REL');

  const markerName = edges[cp.edge - 1]?.edge_name ?? `?${cp.edge}`;
  const targetName = cp.targetEdge ? edges[cp.targetEdge - 1]?.edge_name ?? `?${cp.targetEdge}` : '-';
  return `${markerName}@${cp.ratio.toFixed(3)} [${flags.join('|')}] →${targetName}`;
}

// ============================================================
// 메인 테스트
// ============================================================

describe('Checkpoint Precompute - Equivalence with Dynamic Builder', () => {
  let mapData: MapData;
  let cache: PrecomputedCheckpointMap;

  beforeAll(() => {
    mapData = loadYShortMap();
    clearPathCache();
    cache = precomputeCheckpoints({
      edgeArray: mapData.edges,
      isMergeNode: (nodeName) => mapData.mergeNodes.has(nodeName),
    });
  });

  it('should precompute non-empty cache', () => {
    expect(cache.size).toBeGreaterThan(0);
    console.log(`Cache: ${cache.size} target edges, ${[...cache.values()].reduce((sum, arr) => sum + arr.length, 0)} entries`);
  });

  it('lookup should equal dynamic build for a single path', () => {
    const startStation = mapData.stations[5];
    const endStation = mapData.stations[20];
    const pathIndices = findShortestPath(startStation.edgeIndex, endStation.edgeIndex, mapData.edges);
    expect(pathIndices).not.toBeNull();
    expect(pathIndices!.length).toBeGreaterThan(1);

    const dynamicResult = buildCheckpointsFromPath({
      edgeIndices: pathIndices!,
      edgeArray: mapData.edges,
      isMergeNode: (nodeName) => mapData.mergeNodes.has(nodeName),
    });

    const lookupResult = lookupCheckpointsFromPath(pathIndices!, cache);

    const diff = diffCheckpoints(dynamicResult.checkpoints, lookupResult);

    if (!diff.match) {
      console.log(`\nPath: ${startStation.name} → ${endStation.name} (${pathIndices!.length} edges)`);
      console.log('Dynamic only:');
      for (const cp of diff.onlyInDynamic) console.log('  ' + formatCp(cp, mapData.edges));
      console.log('Lookup only:');
      for (const cp of diff.onlyInLookup) console.log('  ' + formatCp(cp, mapData.edges));
    }

    expect(diff.match).toBe(true);
  });

  it('lookup should equal dynamic build for 100 random paths', () => {
    const ITERATIONS = 100;
    let passed = 0;
    let failed = 0;
    const errors: string[] = [];
    const MAX_ERRORS = 5;

    for (let iter = 0; iter < ITERATIONS; iter++) {
      const startIdx = Math.floor(Math.random() * mapData.stations.length);
      let endIdx = Math.floor(Math.random() * mapData.stations.length);
      while (endIdx === startIdx) {
        endIdx = Math.floor(Math.random() * mapData.stations.length);
      }
      const startStation = mapData.stations[startIdx];
      const endStation = mapData.stations[endIdx];

      const pathIndices = findShortestPath(startStation.edgeIndex, endStation.edgeIndex, mapData.edges);
      if (!pathIndices || pathIndices.length < 2) continue;

      const dynamicResult = buildCheckpointsFromPath({
        edgeIndices: pathIndices,
        edgeArray: mapData.edges,
        isMergeNode: (nodeName) => mapData.mergeNodes.has(nodeName),
      });
      const lookupResult = lookupCheckpointsFromPath(pathIndices, cache);
      const diff = diffCheckpoints(dynamicResult.checkpoints, lookupResult);

      if (diff.match) {
        passed++;
      } else {
        failed++;
        if (errors.length < MAX_ERRORS) {
          errors.push(`[${iter}] ${startStation.name} → ${endStation.name} (path len=${pathIndices.length})`);
          for (const cp of diff.onlyInDynamic.slice(0, 3)) {
            errors.push('  - dynamic only: ' + formatCp(cp, mapData.edges));
          }
          for (const cp of diff.onlyInLookup.slice(0, 3)) {
            errors.push('  - lookup only:  ' + formatCp(cp, mapData.edges));
          }
        }
      }
    }

    console.log(`\n=== Precompute Equivalence (${ITERATIONS} random paths) ===`);
    console.log(`Passed: ${passed}, Failed: ${failed}`);
    if (errors.length > 0) {
      console.log('\nFirst mismatches:');
      for (const e of errors) console.log(e);
    }

    expect(failed).toBe(0);
  });
});
