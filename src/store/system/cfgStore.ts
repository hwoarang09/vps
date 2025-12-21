import { create } from "zustand";
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

// 간단한 CSV 파싱 헬퍼
const parseCSVLine = (line: string): string[] => {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
};

// waypoints 파싱 헬퍼
const parseWaypoints = (waypointStr: string): string[] => {
  if (!waypointStr) return [];

  // 따옴표와 대괄호 제거
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

// nodes.cfg 파싱
const parseNodesCFG = (content: string): Node[] => {
  const lines = content.split("\n").map((line) => line.trim());
  const nodes: Node[] = [];

  // 헤더 찾기
  const headerIndex = lines.findIndex((line) => line.startsWith("node_name,"));
  if (headerIndex === -1) {
    throw new Error("nodes.cfg header not found");
  }

  // 데이터 라인 파싱
  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.startsWith("#")) continue;

    const parts = parseCSVLine(line);
    if (parts.length < 5) continue;

    try {
      const nodeName = parts[0];

      const node: Node = {
        node_name: nodeName,
        barcode: parseInt(parts[1]) || 0,
        editor_x: parseFloat(parts[2]) || 0,
        editor_y: parseFloat(parts[3]) || 0,
        editor_z: parseFloat(parts[4]) || 3.8,
        color: getNodeColor(nodeName), // 노드 이름에 따른 색상 적용
        size: 0.5,
        readonly: true,
        source: "config",
      };
      nodes.push(node);
    } catch (error) {
      console.warn(`Failed to parse node line: ${line}`, error);
    }
  }

  return nodes;
};

// vehicles.cfg 파싱
const parseVehiclesCFG = (content: string): VehicleConfig[] => {
  const lines = content.split("\n").map((line) => line.trim());
  const vehicles: VehicleConfig[] = [];

  // 헤더 찾기
  const headerIndex = lines.findIndex((line) => line.startsWith("vehId,"));
  if (headerIndex === -1) {
    console.warn("vehicles.cfg header not found");
    return [];
  }

  // 데이터 라인 파싱
  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.startsWith("#")) continue;

    const parts = parseCSVLine(line);
    if (parts.length < 3) continue;

    try {
      const vehicle: VehicleConfig = {
        vehId: parts[0],
        edgeName: parts[1],
        ratio: parseFloat(parts[2]) || 0,
      };
      vehicles.push(vehicle);
    } catch (error) {
      console.warn(`Failed to parse vehicle line: ${line}`, error);
    }
  }

  return vehicles;
};

// edges.cfg 파싱
const parseEdgesCFG = (content: string, nodes: Node[]): Edge[] => {
  const lines = content.split("\n").map((line) => line.trim());
  const nodeMap = new Map(nodes.map((n) => [n.node_name, n]));
  const edges: Edge[] = [];

  // 헤더 찾기
  const headerIndex = lines.findIndex((line) => line.startsWith("edge_name,"));
  if (headerIndex === -1) {
    throw new Error("edges.cfg header not found");
  }

  // 헤더 컬럼 파싱
  const headers = parseCSVLine(lines[headerIndex]);
  const waypointsIndex = headers.indexOf("waypoints");

  // 데이터 라인 파싱
  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.startsWith("#")) continue;

    const parts = parseCSVLine(line);
    if (parts.length < 5) continue;

    try {
      const edgeName = parts[0];
      const fromNode = parts[1];
      const toNode = parts[2];
      const distance = parseFloat(parts[3]) || 0;
      const railType = parts[4];
      const radius = parts[5] ? parseFloat(parts[5]) : undefined;
      const rotation = parts[6] ? parseFloat(parts[6]) : undefined;

      // waypoints 파싱 - 인덱스가 유효하면 해당 컬럼에서, 없으면 기본값
      let waypoints: string[] = [fromNode, toNode]; // 기본값

      if (waypointsIndex >= 0 && parts[waypointsIndex]) {
        const parsed = parseWaypoints(parts[waypointsIndex]);
        if (parsed.length > 0) {
          waypoints = parsed;
        }
      }

      // axis 파싱 및 자동 계산
      const axisIndex = headers.indexOf("axis");
      let axis: "x" | "y" | "z" | undefined;

      const axisRaw =
        axisIndex >= 0 && parts[axisIndex]
          ? parts[axisIndex].trim().toLowerCase()
          : undefined;

      if (axisRaw === "x" || axisRaw === "y" || axisRaw === "z") {
        axis = axisRaw;
      } else {
        // config에 없으면 노드 좌표 기반 자동 계산
        const nFrom = nodeMap.get(fromNode);
        const nTo = nodeMap.get(toNode);
        if (nFrom && nTo) {
          const dx = Math.abs(nTo.editor_x - nFrom.editor_x);
          const dy = Math.abs(nTo.editor_y - nFrom.editor_y);
          axis = dx >= dy ? "x" : "y";
        }
      }

      // rendering points 계산
      let renderingPoints: THREE.Vector3[] = [];
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

        renderingPoints =
          PointsCalculator.calculateRenderingPoints(edgeRowData);
      } catch (error) {
        console.warn(
          `Failed to calculate rendering points for edge ${edgeName}:`,
          error
        );
      }

      const edge: Edge = {
        edge_name: edgeName,
        from_node: fromNode,
        to_node: toNode,
        waypoints: waypoints,
        vos_rail_type: railType,
        distance: distance,
        radius: radius || (railType.startsWith("C") ? 0.5 : undefined),
        rotation: rotation || 0,
        axis: axis,
        color: getEdgeColor(railType), // VOS rail type에 따른 색상 적용
        opacity: 1,
        readonly: true,
        source: "config",
        rendering_mode: "normal",
        renderingPoints: renderingPoints,
      };
      edges.push(edge);
    } catch (error) {
      console.warn(`Failed to parse edge line: ${line}`, error);
    }
  }

  return edges;
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

      // 2. Set nodes to store FIRST (needed for edge renderingPoints calculation)
      const nodeStore = useNodeStore.getState();
      nodeStore.setNodes(nodes);

      // 3. Load and parse edges.cfg (now nodes are available for PointsCalculator)
      const edgesContent = await loadCFGFile(mapFolder, "edges.cfg");
      const edges = parseEdgesCFG(edgesContent, nodes);

      // Log edges with renderingPoints for debugging
      const edgesWithPoints = edges.filter(e => e.renderingPoints && e.renderingPoints.length > 0);
      console.log(`[CFGStore] Parsed ${edges.length} edges, ${edgesWithPoints.length} have renderingPoints`);

      // 4. Load and parse vehicles.cfg (optional - may not exist)
      let vehicleConfigs: VehicleConfig[] = [];
      try {
        const vehiclesContent = await loadCFGFile(mapFolder, "vehicles.cfg");
        vehicleConfigs = parseVehiclesCFG(vehiclesContent);
        console.log(`[CFGStore] Loaded ${vehicleConfigs.length} vehicle configurations`);
      } catch (error) {
        console.warn("[CFGStore] No vehicles.cfg found or failed to parse, skipping vehicle configs");
      }

      // 4. Set edges to store (Topology calculation happens here)
      const edgeStore = useEdgeStore.getState();
      edgeStore.setEdges(edges);

      // 5. Update node topology based on calculated edges
      const calculatedEdges = edgeStore.edges;
      nodeStore.updateTopology(calculatedEdges);

      // 6. 텍스트 데이터 생성 및 업데이트
      const textStore = useTextStore.getState();
      textStore.clearAllTexts();

      if (textStore.mode === VehicleSystemType.RapierDict) {
        // Dict mode: { 'N001': [x, y, z], ... } (TMP_ 제외)
        const nodeTexts: Record<string, TextPosition> = {};
        nodes.forEach((node) => {
          // TMP_로 시작하는 노드는 제외
          if (!node.node_name.startsWith("TMP_")) {
            nodeTexts[node.node_name] = {
              x: node.editor_x,
              y: node.editor_y,
              z: node.editor_z,
            };
          }
        });
        textStore.setNodeTexts(nodeTexts);
        console.log("CFG Store - Generated nodeTexts (dict):", nodeTexts);
      } else {
        // Array mode: [{ name: 'N001', position: {x, y, z} }, ...] (TMP_ 제외)
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

      // 엣지 텍스트 생성 (TMP_ 제외)
      if (textStore.mode === VehicleSystemType.RapierDict) {
        // Dict mode: { 'E001': [midpoint_x, midpoint_y, midpoint_z], ... }
        const edgeTexts: Record<string, TextPosition> = {};
        edges.forEach((edge) => {
          // TMP_로 시작하는 엣지는 제외
          if (!edge.edge_name.startsWith("TMP_")) {
            // waypoints 배열에서 적절한 노드 선택
            const waypoints = edge.waypoints || [];

            let node1, node2;

            if (waypoints.length >= 4) {
              // 곡선 엣지: waypoints[1]과 waypoints[-2] 사용
              const node1Name = waypoints[1];
              const node2Name = waypoints[waypoints.length - 2];
              node1 = nodes.find((n) => n.node_name === node1Name);
              node2 = nodes.find((n) => n.node_name === node2Name);
            } else {
              // 직선 엣지: from_node와 to_node 사용
              node1 = nodes.find((n) => n.node_name === edge.from_node);
              node2 = nodes.find((n) => n.node_name === edge.to_node);
            }

            if (node1 && node2) {
              // 중점 계산
              edgeTexts[edge.edge_name] = {
                x: (node1.editor_x + node2.editor_x) / 2,
                y: (node1.editor_y + node2.editor_y) / 2,
                z: (node1.editor_z + node2.editor_z) / 2,
              };
            }
          }
        });
        textStore.setEdgeTexts(edgeTexts);
        console.log("CFG Store - Generated edgeTexts (dict):", edgeTexts);
      } else {
        // Array mode: [{ name: 'E001', position: {x, y, z} }, ...]
        const edgeTextsArray = edges
          .filter((edge) => !edge.edge_name.startsWith("TMP_"))
          .map((edge) => {
            const waypoints = edge.waypoints || [];
            let node1, node2;

            if (waypoints.length >= 4) {
              // 곡선 엣지: waypoints[1]과 waypoints[-2] 사용
              const node1Name = waypoints[1];
              const node2Name = waypoints[waypoints.length - 2];
              node1 = nodes.find((n) => n.node_name === node1Name);
              node2 = nodes.find((n) => n.node_name === node2Name);
            } else {
              // 직선 엣지: from_node와 to_node 사용
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
          .filter((item) => item !== null) as Array<{
            name: string;
            position: TextPosition;
          }>;
        textStore.setEdgeTextsArray(edgeTextsArray);
        console.log("CFG Store - Generated edgeTexts (array):", edgeTextsArray.length);
      }

      // 강제 업데이트 트리거 (렌더링 확실히 하기 위해)
      setTimeout(() => {
        textStore.forceUpdate();
        console.log("CFG Store - Force update triggered");
      }, 100);

      // Save vehicle configs to store
      set({ vehicleConfigs, isLoading: false });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      set({ error: errorMessage, isLoading: false });
      console.error("Failed to load CFG files:", error);
      throw error;
    }
  },

  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),
  getVehicleConfigs: () => get().vehicleConfigs,
}));
