import { create } from "zustand";
import { Node, Edge } from "@/types"; // 분리된 타입 경로
import { useNodeStore } from "./nodeStore";

interface EdgeState {
  edges: Edge[];
  edgeNameToIndex: Map<string, number>; // O(1) Lookup

  // Actions
  setEdges: (edges: Edge[]) => void; // 여기서 토폴로지 자동 계산
  addEdge: (edge: Edge) => void;
  clearEdges: () => void;

  // 데드락 존 정보 업데이트 (nodeStore.updateTopology 이후 호출)
  updateDeadlockZoneFlags: () => void;

  // Utility
  getEdgeByIndex: (index: number) => Edge | undefined;
}

export const useEdgeStore = create<EdgeState>((set, get) => ({
  edges: [],
  edgeNameToIndex: new Map(),

  // [핵심] 맵 로딩 시 이 함수만 호출하면 됨
  setEdges: (rawEdges) => {
    const nodeStore = useNodeStore.getState();
    const nodes = nodeStore.nodes;
    
    // Node Lookup Map 생성
    const nodeMap = new Map<string, Node>();
    for (const n of nodes) {
      nodeMap.set(n.node_name, n);
    }

    // 1. 빠른 조회를 위한 임시 맵 생성 (NodeName -> EdgeIndices[])
    const nodeIncoming = new Map<string, number[]>();
    const nodeOutgoing = new Map<string, number[]>();
    const nameToIndex = new Map<string, number>();

    // 1차 순회: 인덱싱 및 노드 연결 관계 수집
    // NOTE: Index starts from 1 (1-based). 0 is reserved as invalid/sentinel value.
    for (const [idx, edge] of rawEdges.entries()) {
      nameToIndex.set(edge.edge_name, idx + 1); // 1-based index

      // From Node (Outgoing) - 1-based index
      if (!nodeOutgoing.has(edge.from_node)) nodeOutgoing.set(edge.from_node, []);
      nodeOutgoing.get(edge.from_node)!.push(idx + 1);

      // To Node (Incoming) - 1-based index
      if (!nodeIncoming.has(edge.to_node)) nodeIncoming.set(edge.to_node, []);
      nodeIncoming.get(edge.to_node)!.push(idx + 1);
    }

    // 2차 순회: Edge 데이터에 토폴로지 정보 주입 (불변성 유지)
    const connectedEdges = rawEdges.map((edge) => {
      const incomingToStart = nodeIncoming.get(edge.from_node) || [];
      const outgoingFromStart = nodeOutgoing.get(edge.from_node) || [];

      const incomingToEnd = nodeIncoming.get(edge.to_node) || [];
      const outgoingFromEnd = nodeOutgoing.get(edge.to_node) || [];

      // [Curve Direction Auto-Calculation]
      let curveDirection: "left" | "right" | undefined = edge.curve_direction;

      if (!curveDirection && edge.vos_rail_type?.startsWith("C")) {
         // waypoints: [A, B, C, D] or at least [A, B, C]
         if (edge.waypoints && edge.waypoints.length >= 3) {
            const nA = nodeMap.get(edge.waypoints[0]);
            const nB = nodeMap.get(edge.waypoints[1]);
            const nC = nodeMap.get(edge.waypoints[2]);

            if (nA && nB && nC) {
               // Vector 1: A -> B
               const dx1 = nB.editor_x - nA.editor_x;
               const dy1 = nB.editor_y - nA.editor_y;

               // Vector 2: B -> C
               const dx2 = nC.editor_x - nB.editor_x;
               const dy2 = nC.editor_y - nB.editor_y;

               // Cross Product in 2D (Z-component)
               // cp = dx1 * dy2 - dy1 * dx2
               const crossProduct = dx1 * dy2 - dy1 * dx2;

               // +: Counter-Clockwise (Left), -: Clockwise (Right)
               // Note: This depends on coordinate system (Y-up vs Y-down).
               // Assuming Standard Math (Y-up): + is Left.
               // If Unity/Unreal style (Y-up, Left-Handed?): It varies. 
               // User said: "+ is Left" or similar implication. Let's assume CP > 0 is Left.
               if (crossProduct > 0.001) {
                  curveDirection = "left";
               } else if (crossProduct < -0.001) {
                  curveDirection = "right";
               }

            }
         }
      }

      return {
        ...edge,
        // [Topology Flags] - 4-Way State
        fromNodeIsMerge: incomingToStart.length > 1,
        fromNodeIsDiverge: outgoingFromStart.length > 1,
        toNodeIsMerge: incomingToEnd.length > 1,
        toNodeIsDiverge: outgoingFromEnd.length > 1,

        curve_direction: curveDirection,

        // [Indices]
        nextEdgeIndices: outgoingFromEnd, // 다음 갈 수 있는 엣지들
        prevEdgeIndices: incomingToEnd,   // 나와 합류 경쟁하는 엣지들

        // [Geometry]
        // axis: Already included in ...edge from config
      };
    });

    set({ 
      edges: connectedEdges, 
      edgeNameToIndex: nameToIndex 
    });
  },

  addEdge: (edge) => set((state) => {
    // *주의: 단일 추가 시에는 전체 토폴로지 재계산이 안 됨.
    // 런타임에 맵을 수정한다면 addEdge 후 별도의 재계산 로직이 필요할 수 있음.
    // 여기서는 단순 추가만 구현.
    const newIndex = state.edges.length + 1; // 1-based index
    const newMap = new Map(state.edgeNameToIndex);
    newMap.set(edge.edge_name, newIndex);
    return {
      edges: [...state.edges, edge],
      edgeNameToIndex: newMap
    };
  }),

  clearEdges: () => set({ edges: [], edgeNameToIndex: new Map() }),

  // 데드락 존 정보 업데이트 (nodeStore.updateTopology 이후 호출해야 함)
  updateDeadlockZoneFlags: () => {
    const { edges } = get();
    const nodeStore = useNodeStore.getState();
    const nodes = nodeStore.nodes;

    // Node Lookup Map 생성
    const nodeMap = new Map<string, Node>();
    for (const n of nodes) {
      nodeMap.set(n.node_name, n);
    }

    // Edge에 데드락 존 플래그 추가
    const updatedEdges = edges.map(edge => {
      const fromNode = nodeMap.get(edge.from_node);
      const toNode = nodeMap.get(edge.to_node);

      // 분기점 → 합류점: 존 내부 edge
      const isDeadlockZoneInside =
        fromNode?.isDeadlockBranchNode === true &&
        toNode?.isDeadlockMergeNode === true;

      // toNode가 분기점: 존으로 향하는 entry edge
      const isDeadlockZoneEntry =
        toNode?.isDeadlockBranchNode === true &&
        !fromNode?.isDeadlockMergeNode; // 합류점에서 나오는 건 entry 아님

      // 관련 존 ID (from 또는 to 중 하나에서)
      const deadlockZoneId =
        fromNode?.deadlockZoneId ?? toNode?.deadlockZoneId;

      return {
        ...edge,
        isDeadlockZoneInside: isDeadlockZoneInside || undefined,
        isDeadlockZoneEntry: isDeadlockZoneEntry || undefined,
        deadlockZoneId,
      };
    });

    set({ edges: updatedEdges });
  },

  // NOTE: index is 1-based. 0 is invalid sentinel.
  getEdgeByIndex: (index) => index >= 1 ? get().edges[index - 1] : undefined,
}));