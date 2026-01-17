import { create } from "zustand";
import { useNodeStore } from "./nodeStore";
import { useEdgeStore } from "./edgeStore";
import type { StationRawData } from "@/types/station";
import { getStationTypeConfig } from "@/config/stationConfig";

// Station interface with computed position
export interface Station {
  // --- Raw CSV Data (All columns preserved) ---
  station_name: string;
  editor_x: string;
  editor_y: string;
  barcode_x: number;
  barcode_y: number;
  barcode_z: number;
  barcode_r: number;
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

  // --- Computed Data ---
  position: {
    x: number;
    y: number;
    z: number;
  };
}

interface StationStore {
  stations: Station[];
  loadStations: (rawData: StationRawData[]) => Station[];
  setStations: (stations: Station[]) => void;
  clearStations: () => void;
}

// Calculate Z coordinate based on station type
const getStationZ = (stationType: string): number => {
  const config = getStationTypeConfig(stationType);
  return config.Z_HEIGHT;
};

// Calculate position based on barcode and edge
const calculateStationPosition = (
  rawStation: StationRawData
): { x: number; y: number; z: number } => {
  const nodeStore = useNodeStore.getState();
  const edgeStore = useEdgeStore.getState();

  // Find the nearest edge
  const edge = edgeStore.edges.find(
    (e) => e.edge_name === rawStation.nearest_edge
  );

  if (!edge) {
    return { x: 0, y: 0, z: getStationZ(rawStation.station_type) };
  }

  // Find from_node and to_node
  const fromNode = nodeStore.getNodeByName(edge.from_node);
  const toNode = nodeStore.getNodeByName(edge.to_node);

  if (!fromNode || !toNode) {
    return { x: 0, y: 0, z: getStationZ(rawStation.station_type) };
  }

  // Calculate ratio (t) based on barcode
  const barcodeDiff = toNode.barcode - fromNode.barcode;
  if (barcodeDiff === 0) {
    return {
      x: fromNode.editor_x,
      y: fromNode.editor_y,
      z: getStationZ(rawStation.station_type),
    };
  }

  const t = (rawStation.barcode_x - fromNode.barcode) / barcodeDiff;

  // Calculate base position on edge
  const x_base = fromNode.editor_x + (toNode.editor_x - fromNode.editor_x) * t;
  const y_base = fromNode.editor_y + (toNode.editor_y - fromNode.editor_y) * t;

  // Calculate lateral offset based on barcode_y
  // barcode_y is in millimeters: +100 = right 0.1m, -100 = left 0.1m, 0 = center
  const offsetDistance = rawStation.barcode_y / 1000; // Convert mm to meters

  // Calculate perpendicular vector to edge direction
  const edgeDx = toNode.editor_x - fromNode.editor_x;
  const edgeDy = toNode.editor_y - fromNode.editor_y;
  const edgeLength = Math.hypot(edgeDx, edgeDy);

  let x_final = x_base;
  let y_final = y_base;

  if (edgeLength > 0.001 && offsetDistance !== 0) {
    // Normalize edge direction
    const edgeDirX = edgeDx / edgeLength;
    const edgeDirY = edgeDy / edgeLength;

    // Perpendicular vector (rotate 90 degrees counterclockwise)
    const perpX = -edgeDirY;
    const perpY = edgeDirX;

    // Apply offset
    x_final = x_base + perpX * offsetDistance;
    y_final = y_base + perpY * offsetDistance;
  }

  return {
    x: x_final,
    y: y_final,
    z: getStationZ(rawStation.station_type),
  };
};

export const useStationStore = create<StationStore>((set) => ({
  stations: [],

  loadStations: (rawData: StationRawData[]): Station[] => {
    const stations: Station[] = rawData.map((raw) => {
      const position = calculateStationPosition(raw);

      return {
        ...raw,
        position,
      };
    });

    set({ stations });
    return stations;
  },

  setStations: (stations: Station[]) => {
    set({ stations });
  },

  clearStations: () => set({ stations: [] }),
}));

