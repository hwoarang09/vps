import { create } from "zustand";
import Papa from "papaparse";
import { useNodeStore } from "../map/nodeStore";
import { useEdgeStore } from "../map/edgeStore";
import { useStationStore } from "../map/stationStore";
import { useTextStore, TextPosition } from "../map/textStore";
import { Node, Edge, VehicleConfig, EdgeType } from "@/types";
import { StationRawData } from "@/types/station";

import { getEdgeColor } from "@/utils/colors/edgeColors";
import { PointsCalculator } from "@/components/three/entities/edge/points_calculator";
import { VehicleSystemType } from "@/types/vehicle";
import * as THREE from "three";
import { getMarkerConfig } from "@/config/renderConfig";
import { getStationTextConfig } from "@/config/stationConfig";

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

  // Rule A.2: Remove empty block

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

interface StationRow {
  station_name: string;
  editor_x: string;
  editor_y: string;
  barcode_x: string;
  barcode_y: string;
  barcode_z: string;
  barcode_r: string;
  bay_name: string;
  station_type: string;
  port_id: string;
  port_type_code: string;
  direction_code: string;
  link_sc_id: string;
  buffer_size: string;
  mode_type: string;
  floor: string;
  zone_id: string;
  rail_index: string;
  sc_id: string;
  e84: string;
  teached: string;
  look_down: string;
  nearest_edge: string;
  nearest_edge_distance: string;
  eq_id: string;
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
      editor_z: Number.parseFloat(row.editor_z || String(getMarkerConfig().Z)) || getMarkerConfig().Z,
      color: row.node_name.startsWith("TMP_") ? getMarkerConfig().TMP.COLOR : getMarkerConfig().NORMAL.COLOR,
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
        vos_rail_type: railType as EdgeType,
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

// station.map 파싱
const parseStationMap = (content: string): StationRawData[] => {
  const rows = parseCSV<StationRow>(content);

  return rows
    .filter((row) => row.station_name)
    .map((row) => ({
      station_name: row.station_name,
      editor_x: row.editor_x,
      editor_y: row.editor_y,
      barcode_x: Number.parseFloat(row.barcode_x) || 0,
      barcode_y: Number.parseFloat(row.barcode_y) || 0,
      barcode_z: Number.parseFloat(row.barcode_z) || 0,
      barcode_r: Number.parseFloat(row.barcode_r) || 0,
      bay_name: row.bay_name,
      station_type: row.station_type,
      port_id: row.port_id,
      port_type_code: row.port_type_code,
      direction_code: row.direction_code,
      link_sc_id: row.link_sc_id,
      buffer_size: row.buffer_size,
      mode_type: row.mode_type,
      floor: row.floor,
      zone_id: row.zone_id,
      rail_index: row.rail_index,
      sc_id: row.sc_id,
      e84: row.e84,
      teached: row.teached,
      look_down: row.look_down,
      nearest_edge: row.nearest_edge,
      nearest_edge_distance: row.nearest_edge_distance,
      eq_id: row.eq_id,
    }));
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
  }
};

// renderingPoints 경로의 정확한 중간 지점 계산
const getEdgeMidpoint = (edge: Edge): TextPosition | null => {
  const points = edge.renderingPoints;
  if (!points || points.length === 0) return null;

  if (points.length === 1) {
    return { x: points[0].x, y: points[0].y, z: points[0].z };
  }

  // 총 경로 길이 계산
  let totalLength = 0;
  const segmentLengths: number[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const dx = points[i + 1].x - points[i].x;
    const dy = points[i + 1].y - points[i].y;
    const len = Math.hypot(dx, dy);
    segmentLengths.push(len);
    totalLength += len;
  }

  // 중간 지점 찾기
  const halfLength = totalLength / 2;
  let accumulated = 0;
  for (let i = 0; i < segmentLengths.length; i++) {
    if (accumulated + segmentLengths[i] >= halfLength) {
      const remaining = halfLength - accumulated;
      const t = remaining / segmentLengths[i];
      return {
        x: points[i].x + (points[i + 1].x - points[i].x) * t,
        y: points[i].y + (points[i + 1].y - points[i].y) * t,
        z: points[i].z + (points[i + 1].z - points[i].z) * t,
      };
    }
    accumulated += segmentLengths[i];
  }

  // 폴백: 마지막 점
  const last = points.at(-1)!;
  return { x: last.x, y: last.y, z: last.z };
};

// 엣지 텍스트 생성 (Dict Mode)
const processEdgeTextsDict = (edges: Edge[], nodes: Node[], textStore: any) => {
  const edgeTexts: Record<string, TextPosition> = {};
  for (const edge of edges) {
    if (!edge.edge_name.startsWith("TMP_")) {
      // renderingPoints가 있으면 경로의 정확한 중간점 사용
      const midpoint = getEdgeMidpoint(edge);
      if (midpoint) {
        edgeTexts[edge.edge_name] = midpoint;
      } else {
        // 폴백: from_node와 to_node의 중간점
        const node1 = nodes.find((n) => n.node_name === edge.from_node);
        const node2 = nodes.find((n) => n.node_name === edge.to_node);
        if (node1 && node2) {
          edgeTexts[edge.edge_name] = {
            x: (node1.editor_x + node2.editor_x) / 2,
            y: (node1.editor_y + node2.editor_y) / 2,
            z: (node1.editor_z + node2.editor_z) / 2,
          };
        }
      }
    }
  }
  textStore.setEdgeTexts(edgeTexts);
};

// 엣지 텍스트 생성 (Array Mode)
const processEdgeTextsArray = (edges: Edge[], nodes: Node[], textStore: any) => {
  const edgeTextsArray = edges
    .filter((edge) => !edge.edge_name.startsWith("TMP_"))
    .map((edge) => {
      // renderingPoints가 있으면 경로의 정확한 중간점 사용
      const midpoint = getEdgeMidpoint(edge);
      if (midpoint) {
        return {
          name: edge.edge_name,
          position: midpoint,
        };
      }

      // 폴백: from_node와 to_node의 중간점
      const node1 = nodes.find((n) => n.node_name === edge.from_node);
      const node2 = nodes.find((n) => n.node_name === edge.to_node);
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
};

// Station texts 생성 및 업데이트 (Array mode)
const processStationTextsArray = (stations: any[], textStore: any) => {
  const textConfig = getStationTextConfig();
  const stationTextsArray = stations.map((station) => ({
    name: station.station_name,
    position: {
      x: station.position.x,
      y: station.position.y,
      z: station.position.z + textConfig.Z_OFFSET,
    },
  }));

  textStore.setStationTextsArray(stationTextsArray);
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

      // Rule A.1: Remove useless assignment - edgesWithPoints not used

      // 4. Load and parse vehicles.cfg (optional)
      let vehicleConfigs: VehicleConfig[] = [];
      try {
        const vehiclesContent = await loadCFGFile(mapFolder, "vehicles.cfg");
        vehicleConfigs = parseVehiclesCFG(vehiclesContent);
      } catch (error) {
      }

      // 5. Load and parse station.map (optional)
      let stationRawData: StationRawData[] = [];
      try {
        const stationContent = await loadCFGFile(mapFolder, "station.map");
        stationRawData = parseStationMap(stationContent);
      } catch (error) {
      }

      // 6. Set edges to store
      const edgeStore = useEdgeStore.getState();
      edgeStore.setEdges(edges);

      // 7. Update node topology (merge/diverge + deadlock zone detection)
      const calculatedEdges = edgeStore.edges;
      nodeStore.updateTopology(calculatedEdges);

      // 8. Update edge deadlock zone flags (after node topology is ready)
      edgeStore.updateDeadlockZoneFlags();

      // 9. Load stations to stationStore (if data exists)
      let stations: any[] = [];
      if (stationRawData.length > 0) {
        const stationStore = useStationStore.getState();
        stations = stationStore.loadStations(stationRawData);
      }

      // 9. 텍스트 데이터 생성 및 업데이트
      const textStore = useTextStore.getState();
      textStore.clearAllTexts();

      processNodeTexts(nodes, textStore);

      if (textStore.mode === VehicleSystemType.RapierDict) {
        processEdgeTextsDict(edges, nodes, textStore);
      } else {
        processEdgeTextsArray(edges, nodes, textStore);
      }

      // Process station texts
      if (stations.length > 0) {
        processStationTextsArray(stations, textStore);
      }

      setTimeout(() => {
        textStore.forceUpdate();
      }, 100);

      set({ vehicleConfigs, isLoading: false });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      set({ error: errorMessage, isLoading: false });
      throw error;
    }
  },

  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),
  getVehicleConfigs: () => get().vehicleConfigs,
}));