import { create } from "zustand";
import { Node, Edge, EdgeType } from "@/types";

/**
 * 데드락 존 정보
 * - divergeNodes: 분기점 2개 (같은 합류점 2개로 분기하는 노드들)
 * - mergeNodes: 합류점 2개 (두 분기점에서 합류하는 노드들)
 *
 * 구조:
 *   분기점A ----→ 합류점B ←---- 분기점D
 *       \                   /
 *        ----→ 합류점C ←----
 */
interface DeadlockZone {
  divergeNodes: [string, string];  // 분기점 2개
  mergeNodes: [string, string];    // 합류점 2개
}

/**
 * Node topology 집계 (outgoing/incoming)
 */
interface NodeTopology {
  divergeToNodes: Map<string, Set<string>>;  // 각 노드에서 나가는 toNode 집합
  incomingCount: Map<string, number>;        // 각 노드로 들어오는 edge 개수
}

function collectNodeTopology(edges: Edge[]): NodeTopology {
  const divergeToNodes = new Map<string, Set<string>>();
  const incomingCount = new Map<string, number>();

  for (const edge of edges) {
    // outgoing 집계
    if (!divergeToNodes.has(edge.from_node)) {
      divergeToNodes.set(edge.from_node, new Set());
    }
    divergeToNodes.get(edge.from_node)!.add(edge.to_node);

    // incoming 집계
    incomingCount.set(edge.to_node, (incomingCount.get(edge.to_node) || 0) + 1);
  }

  return { divergeToNodes, incomingCount };
}

/**
 * 분기점 찾기 (outgoing >= 2)
 */
function findDivergeNodes(divergeToNodes: Map<string, Set<string>>): string[] {
  const divergeNodes: string[] = [];
  for (const [node, toNodes] of divergeToNodes) {
    if (toNodes.size >= 2) {
      divergeNodes.push(node);
    }
  }
  return divergeNodes;
}

/**
 * 합류점 찾기 (incoming >= 2)
 */
function findMergeNodes(incomingCount: Map<string, number>): Set<string> {
  const mergeNodeSet = new Set<string>();
  for (const [node, count] of incomingCount) {
    if (count >= 2) {
      mergeNodeSet.add(node);
    }
  }
  return mergeNodeSet;
}

/**
 * A와 D의 공통 toNode 찾기
 * @returns 두 노드 집합의 교집합 배열
 */
function findCommonToNodes(toNodesA: Set<string>, toNodesD: Set<string>): string[] {
  const commonToNodes: string[] = [];
  for (const toNode of toNodesA) {
    if (toNodesD.has(toNode)) {
      commonToNodes.push(toNode);
    }
  }
  return commonToNodes;
}

/**
 * 데드락 존 유효성 검증
 * @returns 공통 toNode가 정확히 2개이고, 둘 다 합류점이면 true
 */
function isValidDeadlockZone(commonToNodes: string[], mergeNodeSet: Set<string>): boolean {
  if (commonToNodes.length !== 2) return false;
  const [nodeB, nodeC] = commonToNodes;
  return mergeNodeSet.has(nodeB) && mergeNodeSet.has(nodeC);
}

/**
 * 데드락 존 쌍 찾기 (분기점 A, D → 합류점 B, C)
 *
 * 조건:
 * - A, D 둘 다 분기점 (outgoing >= 2)
 * - B, C 둘 다 합류점 (incoming >= 2)
 * - A와 D가 정확히 같은 2개의 노드(B, C)로 분기
 */
function findDeadlockZonePairs(
  divergeNodes: string[],
  divergeToNodes: Map<string, Set<string>>,
  mergeNodeSet: Set<string>
): DeadlockZone[] {
  const zones: DeadlockZone[] = [];
  const usedDiverge = new Set<string>();

  // 각 분기점 쌍에 대해 같은 합류점 2개로 분기하는지 확인
  for (let i = 0; i < divergeNodes.length; i++) {
    const nodeA = divergeNodes[i];
    if (usedDiverge.has(nodeA)) continue;

    const toNodesA = divergeToNodes.get(nodeA)!;

    for (let j = i + 1; j < divergeNodes.length; j++) {
      const nodeD = divergeNodes[j];
      if (usedDiverge.has(nodeD)) continue;

      const toNodesD = divergeToNodes.get(nodeD)!;

      const commonToNodes = findCommonToNodes(toNodesA, toNodesD);

      if (isValidDeadlockZone(commonToNodes, mergeNodeSet)) {
        const [nodeB, nodeC] = commonToNodes;
        zones.push({
          divergeNodes: [nodeA, nodeD],
          mergeNodes: [nodeB, nodeC],
        });
        usedDiverge.add(nodeA);
        usedDiverge.add(nodeD);
        break;
      }
    }
  }

  return zones;
}

/**
 * 데드락 존 감지 (메인 함수)
 *
 * 조건:
 * 1. 분기점 A에서 나가는 edge 2개의 toNode가 B, C
 * 2. B, C 둘 다 합류점 (incoming >= 2)
 * 3. 다른 분기점 D도 B, C 둘 다로 분기
 *
 * → A, D가 분기점, B, C가 합류점인 데드락 존
 */
function detectDeadlockZones(edges: Edge[]): DeadlockZone[] {
  // 1. Node topology 집계
  const { divergeToNodes, incomingCount } = collectNodeTopology(edges);

  // 2. 분기점 찾기
  const divergeNodes = findDivergeNodes(divergeToNodes);

  // 3. 합류점 찾기
  const mergeNodeSet = findMergeNodes(incomingCount);

  // 4. 데드락 존 쌍 찾기
  return findDeadlockZonePairs(divergeNodes, divergeToNodes, mergeNodeSet);
}

/**
 * 데드락 존 감지 결과를 콘솔에 출력
 */
function logDeadlockZones(zones: DeadlockZone[], edges: Edge[]): void {
  if (zones.length === 0) {
    console.log('[DeadlockZone] No deadlock zones detected');
    return;
  }

  // edge lookup: from_node → to_node → edge_name
  const edgeLookup = new Map<string, Map<string, string>>();
  for (const edge of edges) {
    if (!edgeLookup.has(edge.from_node)) {
      edgeLookup.set(edge.from_node, new Map());
    }
    edgeLookup.get(edge.from_node)!.set(edge.to_node, edge.edge_name);
  }

  const getEdgeName = (from: string, to: string): string => {
    return edgeLookup.get(from)?.get(to) || `${from}→${to}`;
  };

  console.log(`[DeadlockZone] Detected ${zones.length} zone(s):`);
  for (let i = 0; i < zones.length; i++) {
    const zone = zones[i];
    const [A, D] = zone.divergeNodes;
    const [B, C] = zone.mergeNodes;

    const edgeNames = [
      getEdgeName(A, B),
      getEdgeName(A, C),
      getEdgeName(D, B),
      getEdgeName(D, C),
    ];

    console.log(`  Zone ${i} (id: ${i}):`);
    console.log(`    분기점: ${A}, ${D}`);
    console.log(`    합류점: ${B}, ${C}`);
    console.log(`    Edges: ${edgeNames.join(', ')}`);
  }
}

// ============================================================================
// Short-Edge Wait Relocation (변형 DZ 처리)
// ============================================================================

/**
 * 한 진입 edge에 대한 wait point 재배치 정보
 * - waitNode: 실제 대기할 노드 (원래 merge 노드 대신)
 * - waitEdge: waitNode로 들어오는 edge (CP가 박힐 edge)
 * - hops: 거슬러 올라간 hop 수 (디버그용)
 * - mergeNode: 원래 lock을 잡을 merge 노드 (변경 없음)
 */
export interface WaitRelocation {
  waitNode: string;
  waitEdge: string;
  hops: number;
  mergeNode: string;
}

/**
 * 짧은 직선 edge 앞에서 wait point를 거슬러 올림
 *
 * 변형 deadlock 케이스 처리:
 *   merge 진입 edge가 짧은 직선이면, 그 edge에서 대기하면 봉쇄 발생.
 *   따라서 대기 위치를 한 단계 또는 여러 단계 위로 올림 (긴 edge or 분기점까지).
 *
 * @param edges - 모든 edge 목록
 * @param threshold - 짧은 edge 임계 (m). 이 미만 LINEAR가 "짧음" 판정
 * @returns 진입 edge name → WaitRelocation 매핑
 */
export function buildShortEdgeWaitRelocation(
  edges: Edge[],
  threshold: number
): Map<string, WaitRelocation> {
  const relocation = new Map<string, WaitRelocation>();

  // topology 빌드
  const inEdges = new Map<string, Edge[]>();   // node → 들어오는 edge 들
  const outDegree = new Map<string, number>();
  for (const e of edges) {
    if (!inEdges.has(e.to_node)) inEdges.set(e.to_node, []);
    inEdges.get(e.to_node)!.push(e);
    outDegree.set(e.from_node, (outDegree.get(e.from_node) || 0) + 1);
  }

  const isDiverge = (n: string) => (outDegree.get(n) ?? 0) >= 2;

  // [DEBUG]
  let mergeCount = 0;
  let totalEntries = 0;

  // 각 merge node M의 진입 edge 별로 검사
  for (const [mergeNode, entryEdges] of inEdges) {
    if (entryEdges.length < 2) continue; // merge 아님
    mergeCount++;

    for (const e_in of entryEdges) {
      totalEntries++;
      // 진입 edge type/length 무관 — e_in.from_node부터 거슬러 올라가면서
      // 짧은 LINEAR이 끼어있는지 검사
      let waitNode = e_in.from_node;
      let waitEdge: Edge = e_in;
      let hops = 0;
      const visited = new Set<string>([mergeNode]);

      while (hops < 20) { // safety: 무한루프 방지
        if (visited.has(waitNode)) break;
        visited.add(waitNode);

        // 종료 조건: 진짜 분기점
        if (isDiverge(waitNode)) break;

        // 종료 조건: 또 다른 merge (in ≥ 2)
        const inE = inEdges.get(waitNode) ?? [];
        if (inE.length !== 1) break;

        const prev = inE[0];
        // 짧은 LINEAR이 아니면 stop (긴 edge / 곡선 만남)
        if (prev.distance >= threshold) break;
        if (prev.vos_rail_type !== EdgeType.LINEAR) break;

        // 짧은 LINEAR 만남 → 거슬러 올라감
        waitNode = prev.from_node;
        waitEdge = prev;
        hops++;
      }

      // hops === 0 이면 짧은 LINEAR이 없었던 거 → relocation 의미 없음 skip
      if (hops === 0) continue;

      relocation.set(e_in.edge_name, {
        waitNode,
        waitEdge: waitEdge.edge_name,
        hops,
        mergeNode,
      });
    }
  }

  // [DEBUG]
  console.log(
    `[WaitRelocation/diag] edges=${edges.length}, merges=${mergeCount}, ` +
    `entries=${totalEntries}, relocations=${relocation.size}`
  );

  return relocation;
}

/**
 * Wait relocation 결과를 콘솔에 출력 (dry-run 검증용)
 */
function logShortEdgeWaitRelocation(
  relocation: Map<string, WaitRelocation>,
  threshold: number
): void {
  if (relocation.size === 0) {
    console.log(`[WaitRelocation] threshold=${threshold}m: no short merge entries detected`);
    return;
  }
  console.log(`[WaitRelocation] threshold=${threshold}m: ${relocation.size} relocation(s)`);
  let i = 0;
  for (const [entryEdge, r] of relocation) {
    i++;
    console.log(
      `  ${String(i).padStart(2)}. entry=${entryEdge} → wait@${r.waitNode} (waitEdge=${r.waitEdge}, hops=${r.hops}, lockOn=${r.mergeNode})`
    );
  }
}

/**
 * 노드가 데드락 존의 분기점인지 확인
 */
export function isDeadlockDivergeNode(
  nodeName: string,
  zones: DeadlockZone[]
): { isDiverge: boolean; zoneId?: number } {
  for (let i = 0; i < zones.length; i++) {
    if (zones[i].divergeNodes.includes(nodeName)) {
      return { isDiverge: true, zoneId: i };
    }
  }
  return { isDiverge: false };
}

/**
 * 노드가 데드락 존의 합류점인지 확인
 */
export function isDeadlockMergeNode(
  nodeName: string,
  zones: DeadlockZone[]
): { isMerge: boolean; zoneId?: number } {
  for (let i = 0; i < zones.length; i++) {
    if (zones[i].mergeNodes.includes(nodeName)) {
      return { isMerge: true, zoneId: i };
    }
  }
  return { isMerge: false };
}

interface NodeStore {
  nodes: Node[];
  nodeNameToIndex: Map<string, number>; // O(1) Lookup
  previewNodes: Node[];
  /** 짧은 edge wait point relocation 결과 (entry edge name → WaitRelocation) */
  waitRelocations: Map<string, WaitRelocation>;

  // Actions
  setNodes: (nodes: Node[]) => void;
  addNode: (node: Node) => void;
  clearNodes: () => void;

  // [핵심] Edge 정보를 기반으로 Node 상태(Merge/Diverge) 계산
  updateTopology: (edges: Edge[]) => void;

  getNodeByName: (node_name: string) => Node | undefined;
}

export const useNodeStore = create<NodeStore>((set, get) => ({
  nodes: [],
  nodeNameToIndex: new Map(),
  previewNodes: [],
  waitRelocations: new Map(),

  setNodes: (newNodes) => {
    const newMap = new Map<string, number>();
    for (const [i, n] of newNodes.entries()) {
      newMap.set(n.node_name, i);
    }
    set({ nodes: newNodes, nodeNameToIndex: newMap });
  },

  addNode: (node) => set((state) => {
    const newIndex = state.nodes.length;
    const newMap = new Map(state.nodeNameToIndex);
    newMap.set(node.node_name, newIndex);
    return {
      nodes: [...state.nodes, node],
      nodeNameToIndex: newMap
    };
  }),

  clearNodes: () => set({ nodes: [], nodeNameToIndex: new Map(), waitRelocations: new Map() }),

  // 맵 로더에서 Edge 로딩 직후 호출해주면 됨
  updateTopology: (edges: Edge[]) => {
    const { nodes } = get();
    if (nodes.length === 0 || edges.length === 0) return;

    // 연결 카운트 계산
    const nodeIncomingCount = new Map<string, number>();
    const nodeOutgoingCount = new Map<string, number>();

    for (const edge of edges) {
      nodeOutgoingCount.set(edge.from_node, (nodeOutgoingCount.get(edge.from_node) || 0) + 1);
      nodeIncomingCount.set(edge.to_node, (nodeIncomingCount.get(edge.to_node) || 0) + 1);
    }

    // 1단계: merge/diverge 계산
    const nodesWithBasicTopology = nodes.map(node => {
      const inCount = nodeIncomingCount.get(node.node_name) || 0;
      const outCount = nodeOutgoingCount.get(node.node_name) || 0;

      return {
        ...node,
        isMerge: inCount > 1,
        isDiverge: outCount > 1,
        isTerminal: (inCount + outCount) === 1,
      };
    });

    // 2단계: 데드락 존 감지 (분기점 2개 → 합류점 2개 구조)
    const deadlockZones = detectDeadlockZones(edges);

    // 콘솔에 데드락 존 목록 출력
    logDeadlockZones(deadlockZones, edges);

    // 2.5단계: 짧은 직선 wait relocation 정적 분석
    const SHORT_EDGE_THRESHOLD = 1.5; // m, 추후 config화
    const waitRelocation = buildShortEdgeWaitRelocation(edges, SHORT_EDGE_THRESHOLD);
    logShortEdgeWaitRelocation(waitRelocation, SHORT_EDGE_THRESHOLD);
    set({ waitRelocations: waitRelocation });

    // 3단계: Node에 데드락 존 정보 추가
    const updatedNodes = nodesWithBasicTopology.map(node => {
      // 분기점 체크
      const divergeResult = isDeadlockDivergeNode(node.node_name, deadlockZones);
      if (divergeResult.isDiverge) {
        return {
          ...node,
          isDeadlockMergeNode: undefined,
          isDeadlockBranchNode: true,
          deadlockZoneId: divergeResult.zoneId,
        };
      }

      // 합류점 체크
      const mergeResult = isDeadlockMergeNode(node.node_name, deadlockZones);
      if (mergeResult.isMerge) {
        return {
          ...node,
          isDeadlockMergeNode: true,
          isDeadlockBranchNode: undefined,
          deadlockZoneId: mergeResult.zoneId,
        };
      }

      return {
        ...node,
        isDeadlockMergeNode: undefined,
        isDeadlockBranchNode: undefined,
        deadlockZoneId: undefined,
      };
    });

    set({ nodes: updatedNodes });
  },

  getNodeByName: (node_name) => {
    const state = get();
    const idx = state.nodeNameToIndex.get(node_name);
    if (idx !== undefined) return state.nodes[idx];
    return state.previewNodes.find((node) => node.node_name === node_name);
  },
}));