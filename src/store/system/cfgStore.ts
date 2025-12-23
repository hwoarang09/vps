import { create } from "zustand";
import Papa from "papaparse";
import { useNodeStore } from "../map/nodeStore";
import { useEdgeStore } from "../map/edgeStore";
import { useTextStore, TextPosition } from "../map/textStore";
import { Node, Edge, VehicleConfig } from "../../types";
import { getNodeColor } from "../../utils/colors/nodeColors";
import { getEdgeColor } from "../../utils/colors/edgeColors";
import { PointsCalculator } from "../../components/three/entities/edge/points_calculator";
import { VehicleSystemType } from "../../types/vehicle";
import * as THREE from "three";

interface CFGStore {
  isLoading: boolean;
  error: string | null;
  vehicleConfigs: VehicleConfig[];
  loadCFGFiles: (mapFolder: string) => Promise<void>;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  getVehicleConfigs: () => VehicleConfig[];
}

// CSV 파싱 공통 헬퍼
const parseCSV = <T>(content: string): T[] => {
  // # 주석 라인 제거
  const cleanedContent = content
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");

  const result = Papa.parse<T>(cleanedContent, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
    transform: (value) => value.trim(),
  });

  if (result.errors.length > 0) {
    console.warn("CSV parsing warnings:", result.errors);
  }

  return result.data;
};

// waypoints 파싱 헬퍼
const parseWaypoints = (waypointStr: string | undefined): string[] => {
  if (!waypointStr) return [];

  const cleaned = waypointStr
    .replace(/^["']/, "")
    .replace(/["']$/, "")
    .replace(/^\[/, "")
    .replace(/\]$/, "");

  if (!cleaned) return [];

  return cleaned
    .split(",")
    .map((w) => w.trim())
    .filter((w) => w.length > 0);
};

// Raw CSV row 타입 정의
interface NodeRow {
  node_name: string;
  barcode: string;
  editor_x: string;
  editor_y: string;
  editor_z?: string;
}

interface EdgeRow {
  edge_name: string;
  from_node: string;
  to_node: string;
  distance: string;
  vos_rail_type: string;
  radius?: string;
  rotation?: string;
  waypoints?: string;
  axis?: string;
}

interface VehicleRow {
  vehId: string;
  edgeName: string;
  ratio: string;
}

// nodes.cfg 파싱
const parseNodesCFG = (content: string): Node[] => {
  const rows = parseCSV<NodeRow>(content);

  return rows
    .filter((row) => row.node_name)
    .map((row) => ({
      node_name: row.node_name,
      barcode: Number.parseInt(row.barcode) || 0,
      editor_x: Number.parseFloat(row.editor_x) || 0,
      editor_y: Number.parseFloat(row.editor_y) || 0,
      editor_z: Number.parseFloat(row.editor_z || "3.8") || 3.8,
      color: getNodeColor(row.node_name),
      size: 0.5,
      readonly: true,
      source: "config" as const,
    }));
};

// vehicles.cfg 파싱
const parseVehiclesCFG = (content: string): VehicleConfig[] => {
  const rows = parseCSV<VehicleRow>(content);

  return rows
    .filter((row) => row.vehId)
    .map((row) => ({
      vehId: row.vehId,
      edgeName: row.edgeName,
      ratio: Number.parseFloat(row.ratio) || 0,
    }));
};

// rendering points 계산 헬퍼
const calculateEdgeRenderingPoints = (
  railType: string,
  radius: number | undefined,
  rotation: number | undefined,
  edgeName: string,
  fromNode: string,
  toNode: string,
  waypoints: string[]
): THREE.Vector3[] => {
  try {
    const edgeRowData = {
      vos_rail_type: railType,
      radius: radius || (railType.startsWith("C") ? 0.5 : undefined),
      rotation: rotation,
      edge_name: edgeName,
      from_node: fromNode,
      to_node: toNode,
      waypoints: waypoints,
    };

    return PointsCalculator.calculateRenderingPoints(edgeRowData);
  } catch (error) {
    console.warn(
      `Failed to calculate rendering points for edge ${edgeName}:`,
      error
    );
    return [];
  }
};

// axis 계산 헬퍼
const calculateEdgeAxis = (
  axisRaw: string | undefined,
  fromNode: string,
  toNode: string,
  nodeMap: Map<string, Node>
): "x" | "y" | "z" | undefined => {
  const axis = axisRaw?.toLowerCase();

  if (axis === "x" || axis === "y" || axis === "z") {
    return axis;
  }

  // config에 없으면 노드 좌표 기반 자동 계산
  const nFrom = nodeMap.get(fromNode);
  const nTo = nodeMap.get(toNode);
  if (nFrom && nTo) {
    const dx = Math.abs(nTo.editor_x - nFrom.editor_x);
    const dy = Math.abs(nTo.editor_y - nFrom.editor_y);
    return dx >= dy ? "x" : "y";
  }

  return undefined;
};

// edges.cfg 파싱
const parseEdgesCFG = (content: string, nodes: Node[]): Edge[] => {
  const rows = parseCSV<EdgeRow>(content);
  const nodeMap = new Map(nodes.map((n) => [n.node_name, n]));

  return rows
    .filter((row) => row.edge_name && row.from_node && row.to_node)
    .map((row) => {
      const railType = row.vos_rail_type;
      const radius = row.radius ? Number.parseFloat(row.radius) : undefined;
      const rotation = row.rotation ? Number.parseFloat(row.rotation) : undefined;

      // waypoints 파싱
      let waypoints = parseWaypoints(row.waypoints);
      if (waypoints.length === 0) {
        waypoints = [row.from_node, row.to_node];
      }

      // axis 계산
      const axis = calculateEdgeAxis(row.axis, row.from_node, row.to_node, nodeMap);

      // rendering points 계산
      const renderingPoints = calculateEdgeRenderingPoints(
        railType,
        radius,
        rotation,
        row.edge_name,
        row.from_node,
        row.to_node,
        waypoints
      );

      const edge: Edge = {
        edge_name: row.edge_name,
        from_node: row.from_node,
        to_node: row.to_node,
        waypoints: waypoints,
        vos_rail_type: railType,
        distance: Number.parseFloat(row.distance) || 0,
        radius: radius || (railType.startsWith("C") ? 0.5 : undefined),
        rotation: rotation || 0,
        axis: axis,
        color: getEdgeColor(railType),
        opacity: 1,
        readonly: true,
        source: "config",
        rendering_mode: "normal",
        renderingPoints: renderingPoints,
      };

      return edge;
    });
};

// 노드 텍스트 생성 및 업데이트 헬퍼
const processNodeTexts = (nodes: Node[], textStore: any) => {
  if (textStore.mode === VehicleSystemType.RapierDict) {
    const nodeTexts: Record<string, TextPosition> = {};
    for (const node of nodes) {
      if (!node.node_name.startsWith("TMP_")) {
        nodeTexts[node.node_name] = {
          x: node.editor_x,
          y: node.editor_y,
          z: node.editor_z,
        };
      }
    }
    textStore.setNodeTexts(nodeTexts);
    console.log("CFG Store - Generated nodeTexts (dict):", nodeTexts);
  } else {
    const nodeTextsArray = nodes
      .filter((node) => !node.node_name.startsWith("TMP_"))
      .map((node) => ({
        name: node.node_name,
        position: {
          x: node.editor_x,
          y: node.editor_y,
          z: node.editor_z,
        },
      }));
    textStore.setNodeTextsArray(nodeTextsArray);
    console.log("CFG Store - Generated nodeTexts (array):", nodeTextsArray.length);
  }
};

// 엣지 텍스트 생성 (Dict Mode)
const processEdgeTextsDict = (edges: Edge[], nodes: Node[], textStore: any) => {
  const edgeTexts: Record<string, TextPosition> = {};
  for (const edge of edges) {
    if (!edge.edge_name.startsWith("TMP_")) {
      const waypoints = edge.waypoints || [];
      let node1, node2;

      if (waypoints.length >= 4) {
        node1 = nodes.find((n) => n.node_name === waypoints[1]);
        node2 = nodes.find((n) => n.node_name === waypoints.at(-2));
      } else {
        node1 = nodes.find((n) => n.node_name === edge.from_node);
        node2 = nodes.find((n) => n.node_name === edge.to_node);
      }

      if (node1 && node2) {
        edgeTexts[edge.edge_name] = {
          x: (node1.editor_x + node2.editor_x) / 2,
          y: (node1.editor_y + node2.editor_y) / 2,
          z: (node1.editor_z + node2.editor_z) / 2,
        };
      }
    }
  }
  textStore.setEdgeTexts(edgeTexts);
  console.log("CFG Store - Generated edgeTexts (dict):", edgeTexts);
};

// 엣지 텍스트 생성 (Array Mode)
const processEdgeTextsArray = (edges: Edge[], nodes: Node[], textStore: any) => {
  const edgeTextsArray = edges
    .filter((edge) => !edge.edge_name.startsWith("TMP_"))
    .map((edge) => {
      const waypoints = edge.waypoints || [];
      let node1, node2;

      if (waypoints.length >= 4) {
        node1 = nodes.find((n) => n.node_name === waypoints[1]);
        node2 = nodes.find((n) => n.node_name === waypoints.at(-2));
      } else {
        node1 = nodes.find((n) => n.node_name === edge.from_node);
        node2 = nodes.find((n) => n.node_name === edge.to_node);
      }

      if (node1 && node2) {
        return {
          name: edge.edge_name,
          position: {
            x: (node1.editor_x + node2.editor_x) / 2,
            y: (node1.editor_y + node2.editor_y) / 2,
            z: (node1.editor_z + node2.editor_z) / 2,
          },
        };
      }
      return null;
    })
    .filter((item): item is { name: string; position: TextPosition } => item !== null);

  textStore.setEdgeTextsArray(edgeTextsArray);
  console.log("CFG Store - Generated edgeTexts (array):", edgeTextsArray.length);
};

// Load CFG file from specified map folder
const loadCFGFile = async (mapFolder: string, filename: string): Promise<string> => {
  const response = await fetch(`/railConfig/${mapFolder}/${filename}`);
  if (!response.ok) {
    throw new Error(`Failed to load ${filename}: ${response.statusText}`);
  }
  return response.text();
};

// CFG Store
export const useCFGStore = create<CFGStore>((set, get) => ({
  isLoading: false,
  error: null,
  vehicleConfigs: [],

  loadCFGFiles: async (mapFolder: string) => {
    set({ isLoading: true, error: null });

    try {
      // 1. Load and parse nodes.cfg
      const nodesContent = await loadCFGFile(mapFolder, "nodes.cfg");
      const nodes = parseNodesCFG(nodesContent);

      // 2. Set nodes to store FIRST
      const nodeStore = useNodeStore.getState();
      nodeStore.setNodes(nodes);

      // 3. Load and parse edges.cfg
      const edgesContent = await loadCFGFile(mapFolder, "edges.cfg");
      const edges = parseEdgesCFG(edgesContent, nodes);

      const edgesWithPoints = edges.filter((e) => e.renderingPoints && e.renderingPoints.length > 0);
      console.log(`[CFGStore] Parsed ${edges.length} edges, ${edgesWithPoints.length} have renderingPoints`);

      // 4. Load and parse vehicles.cfg (optional)
      let vehicleConfigs: VehicleConfig[] = [];
      try {
        const vehiclesContent = await loadCFGFile(mapFolder, "vehicles.cfg");
        vehicleConfigs = parseVehiclesCFG(vehiclesContent);
        console.log(`[CFGStore] Loaded ${vehicleConfigs.length} vehicle configurations`);
      } catch (error) {
        console.warn("[CFGStore] No vehicles.cfg found or failed to parse, skipping vehicle configs ", error);
      }

      // 5. Set edges to store
      const edgeStore = useEdgeStore.getState();
      edgeStore.setEdges(edges);

      // 6. Update node topology
      const calculatedEdges = edgeStore.edges;
      nodeStore.updateTopology(calculatedEdges);

      // 7. 텍스트 데이터 생성 및 업데이트
      const textStore = useTextStore.getState();
      textStore.clearAllTexts();

      processNodeTexts(nodes, textStore);

      if (textStore.mode === VehicleSystemType.RapierDict) {
        processEdgeTextsDict(edges, nodes, textStore);
      } else {
        processEdgeTextsArray(edges, nodes, textStore);
      }

      setTimeout(() => {
        textStore.forceUpdate();
        console.log("CFG Store - Force update triggered");
      }, 100);

      set({ vehicleConfigs, isLoading: false });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      set({ error: errorMessage, isLoading: false });
      console.error("Failed to load CFG files:", error);
      throw error;
    }
  },

  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),
  getVehicleConfigs: () => get().vehicleConfigs,
}));