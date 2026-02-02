import { create } from "zustand";
import { Node, Edge } from "@/types";

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
 * 데드락 존 감지
 *
 * 조건:
 * 1. 분기점 A에서 나가는 edge 2개의 toNode가 B, C
 * 2. B, C 둘 다 합류점 (incoming >= 2)
 * 3. 다른 분기점 D도 B, C 둘 다로 분기
 *
 * → A, D가 분기점, B, C가 합류점인 데드락 존
 */
function detectDeadlockZones(edges: Edge[]): DeadlockZone[] {
  // 분기점별 toNode 집합 계산
  const divergeToNodes = new Map<string, Set<string>>();
  // 합류점별 incoming count
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

  // 분기점 목록 (outgoing >= 2)
  const divergeNodes: string[] = [];
  for (const [node, toNodes] of divergeToNodes) {
    if (toNodes.size >= 2) {
      divergeNodes.push(node);
    }
  }

  // 합류점 집합 (incoming >= 2)
  const mergeNodeSet = new Set<string>();
  for (const [node, count] of incomingCount) {
    if (count >= 2) {
      mergeNodeSet.add(node);
    }
  }

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

      // A와 D의 공통 toNode 찾기
      const commonToNodes: string[] = [];
      for (const toNode of toNodesA) {
        if (toNodesD.has(toNode)) {
          commonToNodes.push(toNode);
        }
      }

      // 공통 toNode가 정확히 2개이고, 둘 다 합류점이면 데드락 존
      if (commonToNodes.length === 2) {
        const [nodeB, nodeC] = commonToNodes;
        if (mergeNodeSet.has(nodeB) && mergeNodeSet.has(nodeC)) {
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
  }

  return zones;
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

  clearNodes: () => set({ nodes: [], nodeNameToIndex: new Map() }),

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