import { create } from "zustand";
import { Node, Edge } from "@/types";

/**
 * 데드락 존 정보
 */
interface DeadlockZone {
  mergeNodes: string[];
  branchNodes: Set<string>;
}

/**
 * BFS로 from에서 to로 도달 가능한지 확인
 */
function canReach(from: string, to: string, graph: Map<string, string[]>): boolean {
  const visited = new Set<string>();
  const queue = [from];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === to) return true;
    if (visited.has(current)) continue;
    visited.add(current);

    const neighbors = graph.get(current) || [];
    for (const next of neighbors) {
      if (!visited.has(next)) {
        queue.push(next);
      }
    }
  }

  return false;
}

/**
 * 데드락 유발 존 감지
 * 양방향 도달 가능한 merge node 쌍을 찾아 그룹화
 */
function detectDeadlockZones(mergeNodes: string[], edges: Edge[]): DeadlockZone[] {
  if (mergeNodes.length < 2) return [];

  // 그래프 구축 (node → [reachable nodes])
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    const list = outgoing.get(edge.from_node) || [];
    list.push(edge.to_node);
    outgoing.set(edge.from_node, list);
  }

  const zones: DeadlockZone[] = [];
  const processedPairs = new Set<string>();
  const assignedNodes = new Set<string>();

  // 각 merge node 쌍에 대해 양방향 도달 가능 여부 확인
  for (const nodeA of mergeNodes) {
    for (const nodeB of mergeNodes) {
      if (nodeA === nodeB) continue;
      if (assignedNodes.has(nodeA) || assignedNodes.has(nodeB)) continue;

      const pairKey = [nodeA, nodeB].sort((a, b) => a.localeCompare(b)).join('|');
      if (processedPairs.has(pairKey)) continue;
      processedPairs.add(pairKey);

      // A → B 도달 가능 && B → A 도달 가능 → 데드락 존
      if (canReach(nodeA, nodeB, outgoing) && canReach(nodeB, nodeA, outgoing)) {
        zones.push({
          mergeNodes: [nodeA, nodeB],
          branchNodes: new Set(),
        });
        assignedNodes.add(nodeA);
        assignedNodes.add(nodeB);
      }
    }
  }

  return zones;
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
    const nodeIncomingFromNodes = new Map<string, string[]>(); // toNode → [fromNodes]

    // Edge를 순회하며 Node의 입출입 차수 계산
    for (const edge of edges) {
      nodeOutgoingCount.set(edge.from_node, (nodeOutgoingCount.get(edge.from_node) || 0) + 1);
      nodeIncomingCount.set(edge.to_node, (nodeIncomingCount.get(edge.to_node) || 0) + 1);

      // 합류점에 들어오는 from_node 기록 (분기점 후보)
      const fromNodes = nodeIncomingFromNodes.get(edge.to_node) || [];
      fromNodes.push(edge.from_node);
      nodeIncomingFromNodes.set(edge.to_node, fromNodes);
    }

    // 1단계: merge/diverge 계산
    const mergeNodes: string[] = [];

    const nodesWithBasicTopology = nodes.map(node => {
      const inCount = nodeIncomingCount.get(node.node_name) || 0;
      const outCount = nodeOutgoingCount.get(node.node_name) || 0;
      const isMerge = inCount > 1;

      if (isMerge) {
        mergeNodes.push(node.node_name);
      }

      return {
        ...node,
        isMerge,
        isDiverge: outCount > 1,
        isTerminal: (inCount + outCount) === 1,
      };
    });

    // 2단계: 데드락 존 감지 (양방향 도달 가능한 merge node 쌍 찾기)
    const deadlockZones = detectDeadlockZones(mergeNodes, edges);

    // 3단계: 분기점 식별 (데드락 합류점 직전 노드)
    for (const zone of deadlockZones) {
      for (const mergeNode of zone.mergeNodes) {
        const fromNodes = nodeIncomingFromNodes.get(mergeNode) || [];
        for (const fromNode of fromNodes) {
          zone.branchNodes.add(fromNode);
        }
      }
    }

    // 4단계: Node에 데드락 존 정보 추가
    const updatedNodes = nodesWithBasicTopology.map(node => {
      let isDeadlockMergeNode = false;
      let isDeadlockBranchNode = false;
      let deadlockZoneId: number | undefined;

      // 데드락 합류점 체크
      for (let i = 0; i < deadlockZones.length; i++) {
        const zone = deadlockZones[i];
        if (zone.mergeNodes.includes(node.node_name)) {
          isDeadlockMergeNode = true;
          deadlockZoneId = i;
          break;
        }
        if (zone.branchNodes.has(node.node_name)) {
          isDeadlockBranchNode = true;
          deadlockZoneId = i;
          break;
        }
      }

      return {
        ...node,
        isDeadlockMergeNode: isDeadlockMergeNode || undefined,
        isDeadlockBranchNode: isDeadlockBranchNode || undefined,
        deadlockZoneId,
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