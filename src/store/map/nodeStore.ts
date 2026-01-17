import { create } from "zustand";
import { Node, Edge } from "@/types";

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

    // Edge를 순회하며 Node의 입출입 차수 계산
    for (const edge of edges) {
      nodeOutgoingCount.set(edge.from_node, (nodeOutgoingCount.get(edge.from_node) || 0) + 1);
      nodeIncomingCount.set(edge.to_node, (nodeIncomingCount.get(edge.to_node) || 0) + 1);
    }

    // Node 상태 업데이트
    const updatedNodes = nodes.map(node => {
      const inCount = nodeIncomingCount.get(node.node_name) || 0;
      const outCount = nodeOutgoingCount.get(node.node_name) || 0;

      return {
        ...node,
        isMerge: inCount > 1,
        isDiverge: outCount > 1,
        isTerminal: (inCount + outCount) === 1,
        // 필요하다면 incomingEdgeIndices 등도 여기서 매핑 가능
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