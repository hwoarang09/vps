#!/usr/bin/env node
/**
 * 변형 데드락 존 분석 스크립트
 *
 * 목적: 현재 detection (`findDeadlockZonePairs` in nodeStore.ts)이 놓치는
 *       변형 deadlock 케이스 후보를 정적으로 추출.
 *
 * 사용법:
 *   node analyze_variant_dz.js [map_name]
 *   기본 map: y_short
 *
 * 분석 대상:
 *   public/railConfig/{map}/edges.cfg
 *   public/railConfig/{map}/edge.map (cop)
 */

const fs = require('fs');
const path = require('path');

const MAP = process.argv[2] || 'y_short';
const REPO = path.resolve(__dirname, '..', '..');
const CFG_DIR = path.join(REPO, 'public', 'railConfig', MAP);

// 1. edges.cfg 또는 edge.map 자동 선택
function loadEdges() {
  const candidates = ['edges.cfg', 'edge.map'];
  for (const fn of candidates) {
    const p = path.join(CFG_DIR, fn);
    if (fs.existsSync(p)) {
      return parseCfg(fs.readFileSync(p, 'utf8'));
    }
  }
  throw new Error(`No edges file in ${CFG_DIR}`);
}

function parseCfg(content) {
  const lines = content.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
  const header = lines[0].split(',');
  // header positions
  const idx = (name) => header.indexOf(name);
  const iName = idx('edge_name');
  const iFrom = idx('from_node');
  const iTo = idx('to_node');
  const iDist = idx('distance');
  const iType = idx('vos_rail_type');
  const iWait = idx('waiting_offset');

  const edges = [];
  for (let li = 1; li < lines.length; li++) {
    // CSV with quoted waypoints — split carefully
    const cols = splitCSV(lines[li]);
    if (cols.length < header.length) continue;
    edges.push({
      edge_name: cols[iName],
      from_node: cols[iFrom],
      to_node: cols[iTo],
      distance: parseFloat(cols[iDist]),
      type: cols[iType],
      waiting_offset: cols[iWait] ? parseFloat(cols[iWait]) : -1,
    });
  }
  return edges;
}

function splitCSV(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (const ch of line) {
    if (ch === '"') inQ = !inQ;
    else if (ch === ',' && !inQ) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

// 2. 그래프 토폴로지 구축
function buildTopology(edges) {
  const outAdj = new Map();    // node → Set<{toNode, edge}>
  const inAdj = new Map();     // node → Set<{fromNode, edge}>
  const outDegree = new Map();
  const inDegree = new Map();

  for (const e of edges) {
    if (!outAdj.has(e.from_node)) outAdj.set(e.from_node, []);
    if (!inAdj.has(e.to_node)) inAdj.set(e.to_node, []);
    outAdj.get(e.from_node).push({ to: e.to_node, edge: e });
    inAdj.get(e.to_node).push({ from: e.from_node, edge: e });

    outDegree.set(e.from_node, (outDegree.get(e.from_node) || 0) + 1);
    inDegree.set(e.to_node, (inDegree.get(e.to_node) || 0) + 1);
  }

  const allNodes = new Set([...outDegree.keys(), ...inDegree.keys()]);
  return { outAdj, inAdj, outDegree, inDegree, allNodes };
}

// 3. 분기/합류 노드 찾기 (코드의 findDivergeNodes/findMergeNodes 동일)
function findDiverges(topo) {
  const diverges = [];
  for (const [n, deg] of topo.outDegree) {
    if (deg >= 2) diverges.push(n);
  }
  return diverges;
}
function findMerges(topo) {
  const merges = new Set();
  for (const [n, deg] of topo.inDegree) {
    if (deg >= 2) merges.add(n);
  }
  return merges;
}

// 4. 단순통과 노드 (in=1, out=1) — 변형 detection에서 "투명"하게 취급
function isPassThrough(node, topo) {
  return topo.inDegree.get(node) === 1 && topo.outDegree.get(node) === 1;
}

// 5. 분기점에서 출발해 도달하는 "최근접 merge" 집합 (단순통과 무시)
//    각 outgoing edge별로 단순통과만 따라가다 처음 만나는 merge에서 stop
function reachableMergesViaPassThrough(start, topo, mergeSet, maxHop = 10) {
  // 각 outgoing edge별로 별도 추적
  const result = []; // [{merge, hops, path: [edge,...]}]
  const outs = topo.outAdj.get(start) || [];
  for (const { to, edge } of outs) {
    const visited = new Set([start]);
    let cur = to;
    let hops = 1;
    const path = [edge];
    while (hops <= maxHop) {
      if (visited.has(cur)) break;
      visited.add(cur);
      if (mergeSet.has(cur)) {
        result.push({ merge: cur, hops, path });
        break;
      }
      // 단순통과면 계속
      if (isPassThrough(cur, topo)) {
        const nextOuts = topo.outAdj.get(cur);
        if (!nextOuts || nextOuts.length === 0) break;
        const nx = nextOuts[0];
        path.push(nx.edge);
        cur = nx.to;
        hops++;
      } else {
        break; // diverge 만나면 중단
      }
    }
  }
  return result;
}

// 6. 현재 코드의 detection (직접 1-hop diamond)
function currentDetection(topo, diverges, mergeSet) {
  const zones = [];
  const used = new Set();
  for (let i = 0; i < diverges.length; i++) {
    const A = diverges[i];
    if (used.has(A)) continue;
    const toA = new Set((topo.outAdj.get(A) || []).map(x => x.to));
    for (let j = i + 1; j < diverges.length; j++) {
      const D = diverges[j];
      if (used.has(D)) continue;
      const toD = new Set((topo.outAdj.get(D) || []).map(x => x.to));
      const common = [...toA].filter(n => toD.has(n));
      if (common.length === 2 && mergeSet.has(common[0]) && mergeSet.has(common[1])) {
        zones.push({ diverges: [A, D], merges: common });
        used.add(A); used.add(D);
        break;
      }
    }
  }
  return zones;
}

// 7. 확장 detection (단순통과 1-N hop 허용)
function extendedDetection(topo, diverges, mergeSet) {
  const zones = [];
  const used = new Set();

  // 각 diverge의 reachable merges 캐싱
  const reachCache = new Map();
  for (const D of diverges) {
    reachCache.set(D, reachableMergesViaPassThrough(D, topo, mergeSet));
  }

  for (let i = 0; i < diverges.length; i++) {
    const A = diverges[i];
    if (used.has(A)) continue;
    const reachA = reachCache.get(A);
    const mergesA = new Map(reachA.map(r => [r.merge, r])); // merge → info

    for (let j = i + 1; j < diverges.length; j++) {
      const D = diverges[j];
      if (used.has(D)) continue;
      const reachD = reachCache.get(D);
      const common = [];
      for (const r of reachD) {
        if (mergesA.has(r.merge)) {
          common.push({ merge: r.merge, infoA: mergesA.get(r.merge), infoD: r });
        }
      }
      if (common.length === 2) {
        zones.push({
          diverges: [A, D],
          merges: common.map(c => c.merge),
          info: common,
        });
        used.add(A); used.add(D);
        break;
      }
    }
  }
  return zones;
}

// 8. 메인
const edges = loadEdges();
const topo = buildTopology(edges);
const diverges = findDiverges(topo);
const merges = findMerges(topo);

console.log(`=== Map: ${MAP} ===`);
console.log(`Total edges: ${edges.length}`);
console.log(`Total nodes: ${topo.allNodes.size}`);
console.log(`Diverge nodes (out≥2): ${diverges.length}`);
console.log(`Merge nodes (in≥2): ${merges.size}`);

const cur = currentDetection(topo, diverges, merges);
const ext = extendedDetection(topo, diverges, merges);

console.log(`\n=== 현재 detection (직접 1-hop diamond): ${cur.length} zones ===`);
for (const z of cur) {
  console.log(`  diverges=${z.diverges.join(',')}  merges=${z.merges.join(',')}`);
}

console.log(`\n=== 확장 detection (단순통과 hop 허용): ${ext.length} zones ===`);
for (const z of ext) {
  const hopInfo = z.info.map(i =>
    `${i.merge}[A:${i.infoA.hops}h${i.infoA.hops > 1 ? `(${i.infoA.path.map(e => e.edge_name).join('→')})` : ''}, D:${i.infoD.hops}h${i.infoD.hops > 1 ? `(${i.infoD.path.map(e => e.edge_name).join('→')})` : ''}]`
  ).join('  ');
  console.log(`  diverges=${z.diverges.join(',')}  merges=${z.merges.join(',')}`);
  console.log(`    hop info: ${hopInfo}`);
}

// 차집합: 확장에만 있고 현재에 없는 = 변형 케이스
const curKey = (z) => [...z.diverges].sort().join('|') + '#' + [...z.merges].sort().join('|');
const curSet = new Set(cur.map(curKey));
const variants = ext.filter(z => !curSet.has(curKey(z)));

console.log(`\n=== 변형 케이스 (현재 detection이 놓침): ${variants.length} ===`);
for (const z of variants) {
  console.log(`\n  diverges=[${z.diverges.join(', ')}]  merges=[${z.merges.join(', ')}]`);
  for (const i of z.info) {
    const aPath = i.infoA.path.map(e => `${e.edge_name}(${e.distance.toFixed(2)}m,${e.type})`).join(' → ');
    const dPath = i.infoD.path.map(e => `${e.edge_name}(${e.distance.toFixed(2)}m,${e.type})`).join(' → ');
    console.log(`    merge=${i.merge}`);
    console.log(`      A=${z.diverges[0]} 경로 (${i.infoA.hops}hop): ${aPath}`);
    console.log(`      D=${z.diverges[1]} 경로 (${i.infoD.hops}hop): ${dPath}`);
  }
}

// 짧은 edge가 끼어있는 변형만 따로 카운트
const SHORT_THRESHOLD = 1.5; // m
const shortVariants = variants.filter(z =>
  z.info.some(i => [...i.infoA.path, ...i.infoD.path].some(e => e.distance < SHORT_THRESHOLD))
);
console.log(`\n=== 변형 + 짧은 edge(<${SHORT_THRESHOLD}m) 포함: ${shortVariants.length} ===`);
for (const z of shortVariants) {
  console.log(`  diverges=[${z.diverges.join(', ')}]  merges=[${z.merges.join(', ')}]`);
}
