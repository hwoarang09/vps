// checkpoint/builder.test.ts
// Checkpoint 생성 로직 테스트
//
// 테스트 항목:
// 1. y_short 맵 로드
// 2. 임의의 두 station 선택 → Dijkstra 경로 생성
// 3. buildCheckpoints 호출 → checkpoint 생성 확인
// 4. 위치 검증 (곡선 edge 고려)

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import Papa from 'papaparse';
import { Edge, EdgeType } from '@/types/edge';
import { findShortestPath, clearPathCache } from '../Dijkstra';
import { buildCheckpointsFromPath } from './index';
import { CheckpointFlags, Checkpoint } from '@/common/vehicle/initialize/constants';
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
      const waitingOffsetRaw = row.waiting_offset ? parseFloat(row.waiting_offset) : -1;
      const waitingOffset = waitingOffsetRaw > 0 ? waitingOffsetRaw / 1000 : undefined;

      return {
        edge_name: row.edge_name,
        from_node: row.from_node,
        to_node: row.to_node,
        distance: parseFloat(row.distance) || 0,
        vos_rail_type: row.vos_rail_type as EdgeType,
        radius: row.radius ? parseFloat(row.radius) : undefined,
        waypoints: [],
        waiting_offset: waitingOffset,
      };
    });

  // 2. edgeNameToIndex 맵 생성 (1-based)
  const edgeNameToIndex = new Map<string, number>();
  edges.forEach((edge, idx) => {
    edgeNameToIndex.set(edge.edge_name, idx + 1); // 1-based
  });

  // 3. topology 계산 (nextEdgeIndices, merge nodes)
  const nodeOutgoingEdges = new Map<string, number[]>();
  const nodeIncomingEdges = new Map<string, number[]>();

  edges.forEach((edge, idx) => {
    const edgeIdx = idx + 1;

    const outgoing = nodeOutgoingEdges.get(edge.from_node) || [];
    outgoing.push(edgeIdx);
    nodeOutgoingEdges.set(edge.from_node, outgoing);

    const incoming = nodeIncomingEdges.get(edge.to_node) || [];
    incoming.push(edgeIdx);
    nodeIncomingEdges.set(edge.to_node, incoming);
  });

  edges.forEach((edge) => {
    edge.nextEdgeIndices = nodeOutgoingEdges.get(edge.to_node) || [];
  });

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
// 기본 테스트
// ============================================================

describe('Checkpoint Builder with y_short map', () => {
  let mapData: MapData;

  beforeAll(() => {
    mapData = loadYShortMap();
    clearPathCache();
  });

  it('should load y_short map correctly', () => {
    expect(mapData.edges.length).toBeGreaterThan(0);
    expect(mapData.stations.length).toBeGreaterThan(0);
    console.log(`Loaded ${mapData.edges.length} edges, ${mapData.stations.length} stations`);
    console.log(`Merge nodes: ${mapData.mergeNodes.size}`);
  });

  it('should parse waiting_offset correctly', () => {
    const e0002Idx = mapData.edgeNameToIndex.get('E0002');
    expect(e0002Idx).toBeDefined();

    const e0002 = mapData.edges[e0002Idx! - 1];
    expect(e0002.waiting_offset).toBeCloseTo(1.89, 2);

    console.log(`E0002 waiting_offset: ${e0002.waiting_offset}m`);
  });

  it('should find path between two random stations', () => {
    const startStation = mapData.stations[0];
    const endStation = mapData.stations[mapData.stations.length - 1];

    const pathIndices = findShortestPath(startStation.edgeIndex, endStation.edgeIndex, mapData.edges);

    expect(pathIndices).not.toBeNull();
    expect(pathIndices!.length).toBeGreaterThan(0);

    console.log(`Path found: ${pathIndices!.length} edges`);
  });

  it('should build checkpoints for a path', () => {
    const startStation = mapData.stations[5];
    const endStation = mapData.stations[20];

    const pathIndices = findShortestPath(startStation.edgeIndex, endStation.edgeIndex, mapData.edges);
    expect(pathIndices).not.toBeNull();

    const result = buildCheckpointsFromPath({
      edgeIndices: pathIndices!,
      edgeArray: mapData.edges,
      isMergeNode: (nodeName) => mapData.mergeNodes.has(nodeName),
    });

    expect(result.checkpoints.length).toBeGreaterThan(0);

    const hasMovePrep = result.checkpoints.some((cp) => cp.flags & CheckpointFlags.MOVE_PREPARE);
    expect(hasMovePrep).toBe(true);
  });
});

// ============================================================
// 위치 검증 테스트
// ============================================================

describe('Checkpoint Position Verification', () => {
  let mapData: MapData;
  const REQUEST_DISTANCE = 5.1;
  const TOLERANCE = 0.05; // 5cm

  beforeAll(() => {
    mapData = loadYShortMap();
    clearPathCache();
  });

  const CURVE_REQUEST_DISTANCE = 1.0; // 곡선 target: from_node에서 1m 전

  /**
   * findRequestPoint 로직을 재현해서 예상 위치 계산
   * - target의 from_node에서 거리만큼 거슬러 올라감
   * - 곡선 target: 1m
   * - 직선 target: 5.1m
   */
  function expectedRequestPoint(
    targetPathIdx: number,
    pathIndices: number[]
  ): { edgeIdx: number; ratio: number; viaCurve: boolean } {
    const targetEdgeIdx = pathIndices[targetPathIdx];
    const targetEdge = mapData.edges[targetEdgeIdx - 1];

    // target이 곡선이면 1m, 직선이면 5.1m
    const distanceToFind = isCurveEdge(targetEdge) ? CURVE_REQUEST_DISTANCE : REQUEST_DISTANCE;

    let accumulatedDist = 0;

    // target의 from_node에서 역순으로 거슬러 올라감
    for (let i = targetPathIdx - 1; i >= 0; i--) {
      const edgeIdx = pathIndices[i];
      const edge = mapData.edges[edgeIdx - 1];

      // 곡선 만남 → ratio 0.5
      if (isCurveEdge(edge)) {
        return { edgeIdx, ratio: 0.5, viaCurve: true };
      }

      accumulatedDist += edge.distance;

      if (accumulatedDist >= distanceToFind) {
        const overshoot = accumulatedDist - distanceToFind;
        const ratio = overshoot / edge.distance;
        return { edgeIdx, ratio, viaCurve: false };
      }
    }

    // path 시작까지 감
    return { edgeIdx: pathIndices[0], ratio: 0, viaCurve: false };
  }

  /**
   * findWaitPoint 로직을 재현
   */
  function expectedWaitPoint(
    targetPathIdx: number,
    pathIndices: number[],
    waitDistance: number
  ): { edgeIdx: number; ratio: number; viaCurve: boolean } {
    let accumulatedDist = 0;

    for (let i = targetPathIdx - 1; i >= 0; i--) {
      const edgeIdx = pathIndices[i];
      const edge = mapData.edges[edgeIdx - 1];

      // 곡선 만남 → ratio 0
      if (isCurveEdge(edge)) {
        return { edgeIdx, ratio: 0, viaCurve: true };
      }

      accumulatedDist += edge.distance;

      if (accumulatedDist >= waitDistance) {
        const overshoot = accumulatedDist - waitDistance;
        const ratio = overshoot / edge.distance;
        return { edgeIdx, ratio, viaCurve: false };
      }
    }

    return { edgeIdx: pathIndices[0], ratio: 0, viaCurve: false };
  }

  /**
   * 실제 checkpoint 찾기
   */
  function findCheckpointAt(
    checkpoints: Checkpoint[],
    edgeIdx: number,
    ratio: number,
    flag: number
  ): Checkpoint | undefined {
    return checkpoints.find(
      (cp) =>
        cp.edge === edgeIdx &&
        Math.abs(cp.ratio - ratio) < 0.001 &&
        (cp.flags & flag) !== 0
    );
  }

  /**
   * 경로의 모든 merge edge에 대해 checkpoint 위치 검증
   */
  function verifyPath(pathIndices: number[]): {
    reqOk: number;
    reqFail: number;
    waitOk: number;
    waitFail: number;
    details: string[];
  } {
    const result = buildCheckpointsFromPath({
      edgeIndices: pathIndices,
      edgeArray: mapData.edges,
      isMergeNode: (nodeName) => mapData.mergeNodes.has(nodeName),
    });

    let reqOk = 0, reqFail = 0;
    let waitOk = 0, waitFail = 0;
    const details: string[] = [];

    // path의 각 edge에 대해 (1번째부터, 0은 시작 edge)
    for (let i = 1; i < pathIndices.length; i++) {
      const edgeIdx = pathIndices[i];
      const edge = mapData.edges[edgeIdx - 1];
      const isMerge = mapData.mergeNodes.has(edge.from_node);

      if (!isMerge) continue;

      // ============ LOCK_REQUEST 검증 ============
      const expectedReq = expectedRequestPoint(i, pathIndices);
      const foundReqCp = findCheckpointAt(
        result.checkpoints,
        expectedReq.edgeIdx,
        expectedReq.ratio,
        CheckpointFlags.LOCK_REQUEST
      );

      if (foundReqCp) {
        reqOk++;
      } else {
        reqFail++;
        const expectedEdgeName = mapData.edges[expectedReq.edgeIdx - 1]?.edge_name;
        details.push(
          `REQ MISS: ${edge.edge_name} expected at ${expectedEdgeName}@${expectedReq.ratio.toFixed(3)} (viaCurve=${expectedReq.viaCurve})`
        );
      }

      // ============ LOCK_WAIT 검증 ============
      if (edge.waiting_offset && edge.waiting_offset > 0) {
        const expectedWait = expectedWaitPoint(i, pathIndices, edge.waiting_offset);
        const foundWaitCp = findCheckpointAt(
          result.checkpoints,
          expectedWait.edgeIdx,
          expectedWait.ratio,
          CheckpointFlags.LOCK_WAIT
        );

        if (foundWaitCp) {
          waitOk++;
        } else {
          waitFail++;
          const expectedEdgeName = mapData.edges[expectedWait.edgeIdx - 1]?.edge_name;
          details.push(
            `WAIT MISS: ${edge.edge_name} (offset=${edge.waiting_offset.toFixed(3)}m) expected at ${expectedEdgeName}@${expectedWait.ratio.toFixed(3)}`
          );
        }
      }
    }

    return { reqOk, reqFail, waitOk, waitFail, details };
  }

  it('should verify single path', () => {
    const startStation = mapData.stations[5];
    const endStation = mapData.stations[20];
    const pathIndices = findShortestPath(startStation.edgeIndex, endStation.edgeIndex, mapData.edges);
    expect(pathIndices).not.toBeNull();

    console.log('\n=== Single Path Verification ===');
    console.log(`Path: ${startStation.name} → ${endStation.name}, ${pathIndices!.length} edges`);

    const result = verifyPath(pathIndices!);

    console.log(`REQ: ${result.reqOk} ok, ${result.reqFail} fail`);
    console.log(`WAIT: ${result.waitOk} ok, ${result.waitFail} fail`);

    if (result.details.length > 0) {
      console.log('Details (first 10):');
      result.details.slice(0, 10).forEach((d) => console.log(`  ${d}`));
    }

    expect(result.reqFail).toBe(0);
    expect(result.waitFail).toBe(0);
  });

  it('should verify 100 random paths', () => {
    const ITERATIONS = 100;

    console.log(`\n=== ${ITERATIONS} Random Paths ===`);

    let totalReqOk = 0, totalReqFail = 0;
    let totalWaitOk = 0, totalWaitFail = 0;
    const allDetails: string[] = [];

    for (let i = 0; i < ITERATIONS; i++) {
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

      if (!pathIndices || pathIndices.length < 3) continue;

      const result = verifyPath(pathIndices);

      totalReqOk += result.reqOk;
      totalReqFail += result.reqFail;
      totalWaitOk += result.waitOk;
      totalWaitFail += result.waitFail;

      if (allDetails.length < 30) {
        result.details.slice(0, 3).forEach((d) => allDetails.push(`[${i}] ${d}`));
      }
    }

    console.log(`REQ: ${totalReqOk} ok, ${totalReqFail} fail`);
    console.log(`WAIT: ${totalWaitOk} ok, ${totalWaitFail} fail`);

    if (allDetails.length > 0) {
      console.log('\nFirst errors:');
      allDetails.forEach((d) => console.log(`  ${d}`));
    }

    expect(totalReqFail).toBe(0);
    expect(totalWaitFail).toBe(0);
  });

  it('should verify 500 random paths (stress test)', () => {
    const ITERATIONS = 500;

    console.log(`\n=== Stress Test: ${ITERATIONS} paths ===`);

    let totalReqOk = 0, totalReqFail = 0;
    let totalWaitOk = 0, totalWaitFail = 0;

    for (let i = 0; i < ITERATIONS; i++) {
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

      if (!pathIndices || pathIndices.length < 3) continue;

      const result = verifyPath(pathIndices);

      totalReqOk += result.reqOk;
      totalReqFail += result.reqFail;
      totalWaitOk += result.waitOk;
      totalWaitFail += result.waitFail;
    }

    console.log(`REQ: ${totalReqOk} ok, ${totalReqFail} fail`);
    console.log(`WAIT: ${totalWaitOk} ok, ${totalWaitFail} fail`);

    expect(totalReqFail).toBe(0);
    expect(totalWaitFail).toBe(0);
  });

  it('should verify manual path E0001 → E0010', () => {
    const manualPath = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

    console.log('\n=== Manual Path E0001 → E0010 ===');

    // 경로 정보 출력
    console.log('Path edges:');
    manualPath.forEach((edgeIdx, i) => {
      const edge = mapData.edges[edgeIdx - 1];
      const isMerge = mapData.mergeNodes.has(edge.from_node);
      const isCurve = isCurveEdge(edge);
      console.log(
        `  [${i}] ${edge.edge_name}: ${edge.from_node}→${edge.to_node}, ` +
          `dist=${edge.distance.toFixed(3)}m, type=${edge.vos_rail_type}, ` +
          `merge=${isMerge}, curve=${isCurve}, offset=${edge.waiting_offset?.toFixed(3) || '-'}`
      );
    });

    const bResult = buildCheckpointsFromPath({
      edgeIndices: manualPath,
      edgeArray: mapData.edges,
      isMergeNode: (nodeName) => mapData.mergeNodes.has(nodeName),
    });

    console.log('\nGenerated checkpoints:');
    bResult.checkpoints.forEach((cp, idx) => {
      const flags: string[] = [];
      if (cp.flags & CheckpointFlags.MOVE_PREPARE) flags.push('PREP');
      if (cp.flags & CheckpointFlags.LOCK_REQUEST) flags.push('REQ');
      if (cp.flags & CheckpointFlags.LOCK_WAIT) flags.push('WAIT');
      if (cp.flags & CheckpointFlags.LOCK_RELEASE) flags.push('REL');

      const edge = mapData.edges[cp.edge - 1];
      console.log(`  [${idx}] ${edge.edge_name}@${cp.ratio.toFixed(3)} [${flags.join('|')}]`);
    });

    const result = verifyPath(manualPath);
    console.log(`\nVerification: REQ=${result.reqOk}/${result.reqOk + result.reqFail}, WAIT=${result.waitOk}/${result.waitOk + result.waitFail}`);

    if (result.details.length > 0) {
      console.log('Issues:');
      result.details.forEach((d) => console.log(`  ${d}`));
    }

    expect(result.reqFail).toBe(0);
    expect(result.waitFail).toBe(0);
  });

  it('should verify curve target checkpoint at 1m before from_node', () => {
    // 곡선 target에 대해 from_node 1m 전에 checkpoint가 있는지 검증
    console.log('\n=== Curve Target Verification (from_node 기준 1m) ===');

    const CURVE_REQ_DIST = 1.0;
    let testedCount = 0;
    let passedCount = 0;

    // 500개 경로에서 곡선 target 찾기
    for (let iter = 0; iter < 500; iter++) {
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

      if (!pathIndices || pathIndices.length < 3) continue;

      const result = buildCheckpointsFromPath({
        edgeIndices: pathIndices,
        edgeArray: mapData.edges,
        isMergeNode: (nodeName) => mapData.mergeNodes.has(nodeName),
      });

      // 곡선 target edge 찾기
      for (let i = 1; i < pathIndices.length; i++) {
        const targetEdgeIdx = pathIndices[i];
        const targetEdge = mapData.edges[targetEdgeIdx - 1];

        if (!isCurveEdge(targetEdge)) continue;

        // 경유하는 곡선이 있으면 skip
        const searchStart = Math.max(0, i - 3);
        if (hasCurveInRange(pathIndices, searchStart, i)) continue;

        testedCount++;

        // 예상 위치: from_node에서 1m 전 (역순 탐색)
        const expected = expectedRequestPoint(i, pathIndices);

        // checkpoint 찾기
        const foundCp = result.checkpoints.find(
          (cp) =>
            cp.edge === expected.edgeIdx &&
            Math.abs(cp.ratio - expected.ratio) < 0.001 &&
            (cp.flags & CheckpointFlags.MOVE_PREPARE)
        );

        if (foundCp) {
          passedCount++;
        }
      }
    }

    console.log(`Curve targets tested: ${testedCount}, passed: ${passedCount}`);

    const passRate = passedCount / (testedCount || 1);
    console.log(`Pass rate: ${(passRate * 100).toFixed(2)}%`);

    expect(passRate).toBeGreaterThan(0.95);
  });
});

// ============================================================
// 실제 거리 검증 테스트 (직선만 있는 경로)
// ============================================================

describe('Checkpoint Distance Verification (Straight Edges Only)', () => {
  let mapData: MapData;
  const REQUEST_DISTANCE = 5.1;
  const TOLERANCE = 0.001; // 1mm

  beforeAll(() => {
    mapData = loadYShortMap();
    clearPathCache();
  });

  /**
   * checkpoint에서 target edge의 from_node까지 실제 거리 계산
   */
  function calculateActualDistance(
    cpEdgeIdx: number,
    cpRatio: number,
    targetPathIdx: number,
    pathIndices: number[]
  ): number {
    const cpPathIdx = pathIndices.indexOf(cpEdgeIdx);
    if (cpPathIdx === -1 || cpPathIdx >= targetPathIdx) return -1;

    let distance = 0;

    // 1. checkpoint edge에서 끝까지 남은 거리
    const cpEdge = mapData.edges[cpEdgeIdx - 1];
    distance += cpEdge.distance * (1 - cpRatio);

    // 2. 중간 edge들의 전체 거리
    for (let i = cpPathIdx + 1; i < targetPathIdx; i++) {
      const edgeIdx = pathIndices[i];
      const edge = mapData.edges[edgeIdx - 1];
      distance += edge.distance;
    }

    return distance;
  }

  /**
   * 경로에 곡선이 있는지 확인 (특정 범위 내)
   */
  function hasCurveInRange(pathIndices: number[], startIdx: number, endIdx: number): boolean {
    for (let i = startIdx; i < endIdx; i++) {
      const edge = mapData.edges[pathIndices[i] - 1];
      if (isCurveEdge(edge)) return true;
    }
    return false;
  }

  it('should verify LOCK_REQUEST is exactly 5.1m before merge (straight only)', () => {
    console.log('\n=== LOCK_REQUEST Distance Verification (Straight Only) ===');

    let testedCount = 0;
    let passedCount = 0;
    let failedCount = 0;
    const failures: string[] = [];

    // 500개 랜덤 경로 테스트
    for (let iter = 0; iter < 500; iter++) {
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

      if (!pathIndices || pathIndices.length < 5) continue;

      const result = buildCheckpointsFromPath({
        edgeIndices: pathIndices,
        edgeArray: mapData.edges,
        isMergeNode: (nodeName) => mapData.mergeNodes.has(nodeName),
      });

      // 각 merge edge에 대해
      for (let i = 1; i < pathIndices.length; i++) {
        const targetEdgeIdx = pathIndices[i];
        const targetEdge = mapData.edges[targetEdgeIdx - 1];

        if (!mapData.mergeNodes.has(targetEdge.from_node)) continue;

        // target edge가 곡선이면 skip (1m 규칙 적용됨)
        if (isCurveEdge(targetEdge)) continue;

        // 5.1m 범위 내에 곡선이 있으면 skip (곡선은 다른 규칙)
        // 대략 path[i-3] ~ path[i] 범위에서 곡선 체크
        const searchStart = Math.max(0, i - 5);
        if (hasCurveInRange(pathIndices, searchStart, i)) continue;

        // LOCK_REQUEST checkpoint 찾기
        const reqCps = result.checkpoints.filter((cp) => cp.flags & CheckpointFlags.LOCK_REQUEST);

        for (const cp of reqCps) {
          const cpPathIdx = pathIndices.indexOf(cp.edge);
          if (cpPathIdx === -1 || cpPathIdx >= i) continue;

          // 이 checkpoint가 target edge를 위한 것인지 확인
          // (cp와 target 사이에 다른 merge edge가 없어야 함)
          let isForThisTarget = true;
          for (let j = cpPathIdx + 1; j < i; j++) {
            const midEdge = mapData.edges[pathIndices[j] - 1];
            if (mapData.mergeNodes.has(midEdge.from_node)) {
              isForThisTarget = false;
              break;
            }
          }

          if (!isForThisTarget) continue;

          // 실제 거리 계산
          const actualDist = calculateActualDistance(cp.edge, cp.ratio, i, pathIndices);
          const diff = Math.abs(actualDist - REQUEST_DISTANCE);

          testedCount++;

          // ratio가 0이면 path 시작까지 갔다는 것 (5.1m 확보 불가)
          // 이 경우 actualDist < 5.1m는 정상
          const isPathStart = cp.ratio < 0.001;

          if (diff <= TOLERANCE) {
            passedCount++;
          } else if (isPathStart && actualDist < REQUEST_DISTANCE) {
            // path 시작까지 갔지만 5.1m 미만 - 정상 케이스
            passedCount++;
          } else {
            failedCount++;
            if (failures.length < 20) {
              const cpEdgeName = mapData.edges[cp.edge - 1]?.edge_name;
              failures.push(
                `${targetEdge.edge_name}: expected ${REQUEST_DISTANCE}m, got ${actualDist.toFixed(4)}m ` +
                  `at ${cpEdgeName}@${cp.ratio.toFixed(4)} (diff=${diff.toFixed(4)}m)`
              );
            }
          }
          break; // 하나 찾으면 다음 target으로
        }
      }
    }

    console.log(`Tested: ${testedCount}, Passed: ${passedCount}, Failed: ${failedCount}`);

    if (failures.length > 0) {
      console.log('\nFailures:');
      failures.forEach((f) => console.log(`  ${f}`));
    }

    expect(failedCount).toBe(0);
  });

  it('should verify LOCK_WAIT is exactly waiting_offset before merge (straight only)', () => {
    console.log('\n=== LOCK_WAIT Distance Verification (Straight Only) ===');

    let testedCount = 0;
    let passedCount = 0;
    let failedCount = 0;
    const failures: string[] = [];

    for (let iter = 0; iter < 500; iter++) {
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

      if (!pathIndices || pathIndices.length < 5) continue;

      const result = buildCheckpointsFromPath({
        edgeIndices: pathIndices,
        edgeArray: mapData.edges,
        isMergeNode: (nodeName) => mapData.mergeNodes.has(nodeName),
      });

      for (let i = 1; i < pathIndices.length; i++) {
        const targetEdgeIdx = pathIndices[i];
        const targetEdge = mapData.edges[targetEdgeIdx - 1];

        if (!mapData.mergeNodes.has(targetEdge.from_node)) continue;
        if (!targetEdge.waiting_offset || targetEdge.waiting_offset <= 0) continue;

        const expectedDist = targetEdge.waiting_offset;

        // waiting_offset 범위 내에 곡선이 있으면 skip
        const searchStart = Math.max(0, i - 3);
        if (hasCurveInRange(pathIndices, searchStart, i)) continue;

        // LOCK_WAIT checkpoint 찾기
        const waitCps = result.checkpoints.filter((cp) => cp.flags & CheckpointFlags.LOCK_WAIT);

        for (const cp of waitCps) {
          const cpPathIdx = pathIndices.indexOf(cp.edge);
          if (cpPathIdx === -1 || cpPathIdx >= i) continue;

          // 이 checkpoint가 target edge를 위한 것인지 확인
          let isForThisTarget = true;
          for (let j = cpPathIdx + 1; j < i; j++) {
            const midEdge = mapData.edges[pathIndices[j] - 1];
            if (mapData.mergeNodes.has(midEdge.from_node) && midEdge.waiting_offset && midEdge.waiting_offset > 0) {
              isForThisTarget = false;
              break;
            }
          }

          if (!isForThisTarget) continue;

          const actualDist = calculateActualDistance(cp.edge, cp.ratio, i, pathIndices);
          const diff = Math.abs(actualDist - expectedDist);

          testedCount++;

          if (diff <= TOLERANCE) {
            passedCount++;
          } else {
            failedCount++;
            if (failures.length < 20) {
              const cpEdgeName = mapData.edges[cp.edge - 1]?.edge_name;
              failures.push(
                `${targetEdge.edge_name}: expected ${expectedDist.toFixed(4)}m, got ${actualDist.toFixed(4)}m ` +
                  `at ${cpEdgeName}@${cp.ratio.toFixed(4)} (diff=${diff.toFixed(4)}m)`
              );
            }
          }
          break;
        }
      }
    }

    console.log(`Tested: ${testedCount}, Passed: ${passedCount}, Failed: ${failedCount}`);

    if (failures.length > 0) {
      console.log('\nFailures:');
      failures.forEach((f) => console.log(`  ${f}`));
    }

    expect(failedCount).toBe(0);
  });

  it('should verify with a known straight path', () => {
    // 직선만 있는 경로를 수동으로 찾아서 테스트
    // E0007 → E0008 → E0009 → E0010 → E0011 → E0012 → E0013 → E0014
    // E0007의 from_node = N0007 (merge)

    const straightPath = [7, 8, 9, 10, 11, 12, 13, 14];

    console.log('\n=== Known Straight Path Verification ===');
    console.log('Path: E0007 → E0008 → ... → E0014');

    // 경로 정보 출력
    console.log('\nPath details:');
    let cumDist = 0;
    straightPath.forEach((edgeIdx, i) => {
      const edge = mapData.edges[edgeIdx - 1];
      const isMerge = mapData.mergeNodes.has(edge.from_node);
      console.log(
        `  [${i}] ${edge.edge_name}: ${edge.distance.toFixed(3)}m, ` +
          `cumulative=${cumDist.toFixed(3)}m, type=${edge.vos_rail_type}, ` +
          `merge=${isMerge}, offset=${edge.waiting_offset?.toFixed(3) || '-'}`
      );
      cumDist += edge.distance;
    });

    const result = buildCheckpointsFromPath({
      edgeIndices: straightPath,
      edgeArray: mapData.edges,
      isMergeNode: (nodeName) => mapData.mergeNodes.has(nodeName),
    });

    console.log('\nCheckpoints:');
    result.checkpoints.forEach((cp, idx) => {
      const flags: string[] = [];
      if (cp.flags & CheckpointFlags.MOVE_PREPARE) flags.push('PREP');
      if (cp.flags & CheckpointFlags.LOCK_REQUEST) flags.push('REQ');
      if (cp.flags & CheckpointFlags.LOCK_WAIT) flags.push('WAIT');

      const edge = mapData.edges[cp.edge - 1];
      const posInEdge = cp.ratio * edge.distance;

      // 해당 edge까지의 누적 거리
      const cpPathIdx = straightPath.indexOf(cp.edge);
      let distFromStart = 0;
      for (let i = 0; i < cpPathIdx; i++) {
        distFromStart += mapData.edges[straightPath[i] - 1].distance;
      }
      distFromStart += posInEdge;

      console.log(
        `  [${idx}] ${edge.edge_name}@${cp.ratio.toFixed(4)} ` +
          `(${posInEdge.toFixed(3)}m in edge, ${distFromStart.toFixed(3)}m from start) [${flags.join('|')}]`
      );
    });

    // merge edge들에 대해 거리 검증
    // 예상 위치 계산 함수 재사용
    console.log('\nDistance verification:');
    for (let i = 1; i < straightPath.length; i++) {
      const targetEdgeIdx = straightPath[i];
      const targetEdge = mapData.edges[targetEdgeIdx - 1];

      if (!mapData.mergeNodes.has(targetEdge.from_node)) continue;

      // 예상 LOCK_REQUEST 위치 계산 (builder 로직 재현)
      let accDist = 0;
      let expectedReqEdgeIdx = straightPath[0];
      let expectedReqRatio = 0;

      for (let j = i - 1; j >= 0; j--) {
        const edgeIdx = straightPath[j];
        const edge = mapData.edges[edgeIdx - 1];
        accDist += edge.distance;

        if (accDist >= REQUEST_DISTANCE) {
          const overshoot = accDist - REQUEST_DISTANCE;
          expectedReqEdgeIdx = edgeIdx;
          expectedReqRatio = overshoot / edge.distance;
          break;
        }
      }

      // 예상 위치에 checkpoint가 있는지 확인
      const foundCp = result.checkpoints.find(
        (cp) =>
          cp.edge === expectedReqEdgeIdx &&
          Math.abs(cp.ratio - expectedReqRatio) < 0.001 &&
          (cp.flags & CheckpointFlags.LOCK_REQUEST)
      );

      if (foundCp) {
        const actualDist = calculateActualDistance(foundCp.edge, foundCp.ratio, i, straightPath);
        const diff = Math.abs(actualDist - REQUEST_DISTANCE);

        // ratio가 0이고 거리가 5.1m 미만이면 path 시작 케이스
        const isPathStart = foundCp.ratio < 0.001 && actualDist < REQUEST_DISTANCE;
        const isValid = diff <= TOLERANCE || isPathStart;
        const status = isValid ? '✓' : '✗';

        console.log(
          `  ${status} ${targetEdge.edge_name} REQ: expected=${REQUEST_DISTANCE}m, actual=${actualDist.toFixed(4)}m, diff=${diff.toFixed(4)}m` +
            (isPathStart ? ' (path start)' : '')
        );

        expect(isValid).toBe(true);
      } else {
        console.log(`  ? ${targetEdge.edge_name} REQ: checkpoint not found at expected location`);
      }
    }
  });
});
