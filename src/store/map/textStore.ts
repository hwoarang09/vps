import { create } from "zustand";
import { VehicleSystemType } from "@/types/vehicle";

// Text position data structure
export interface TextPosition {
  x: number;
  y: number;
  z: number;
}

// Text item with name and position
export interface TextItem {
  name: string;
  position: TextPosition;
}

// Text store interface
interface TextStore {
  // Mode: dict or array
  mode: VehicleSystemType;

  // Dict mode data
  nodeTexts: Record<string, TextPosition>;
  edgeTexts: Record<string, TextPosition>;
  stationTexts: Record<string, TextPosition>;

  // Array mode data
  nodeTextsArray: TextItem[];
  edgeTextsArray: TextItem[];
  stationTextsArray: TextItem[];

  // Force update trigger
  updateTrigger: number;

  // Mode initialization
  initDictMode: () => void;
  initArrayMode: () => void;

  // Dict mode actions
  setNodeTexts: (nodeTexts: Record<string, TextPosition>) => void;
  setEdgeTexts: (edgeTexts: Record<string, TextPosition>) => void;
  setStationTexts: (stationTexts: Record<string, TextPosition>) => void;
  addNodeText: (nodeName: string, position: TextPosition) => void;
  addEdgeText: (edgeName: string, position: TextPosition) => void;
  addStationText: (stationName: string, position: TextPosition) => void;
  removeNodeText: (nodeName: string) => void;
  removeEdgeText: (edgeName: string) => void;
  removeStationText: (stationName: string) => void;

  // Array mode actions
  setNodeTextsArray: (nodeTexts: TextItem[]) => void;
  setEdgeTextsArray: (edgeTexts: TextItem[]) => void;
  setStationTextsArray: (stationTexts: TextItem[]) => void;
  addNodeTextArray: (item: TextItem) => void;
  addEdgeTextArray: (item: TextItem) => void;
  addStationTextArray: (item: TextItem) => void;
  removeNodeTextArray: (nodeName: string) => void;
  removeEdgeTextArray: (edgeName: string) => void;
  removeStationTextArray: (stationName: string) => void;

  // Common actions
  clearAllTexts: () => void;
  forceUpdate: () => void;

  // Utility functions
  getAllTexts: () => Record<string, TextPosition>; // Combined node + edge texts (dict mode)
  getAllTextsArray: () => TextItem[]; // Combined node + edge texts (array mode)
}

// Create the text store
export const useTextStore = create<TextStore>((set, get) => ({
  mode: VehicleSystemType.ArraySingle,
  nodeTexts: {},
  edgeTexts: {},
  stationTexts: {},
  nodeTextsArray: [],
  edgeTextsArray: [],
  stationTextsArray: [],
  updateTrigger: 0,

  // Mode initialization
  initDictMode: () => {
    set({
      mode: VehicleSystemType.RapierDict,
      nodeTextsArray: [],
      edgeTextsArray: [],
      stationTextsArray: [],
    });
  },

  initArrayMode: () => {
    set({
      mode: VehicleSystemType.ArraySingle,
      nodeTexts: {},
      edgeTexts: {},
      stationTexts: {},
    });
  },

  // Dict mode actions
  setNodeTexts: (nodeTexts) =>
    set((state) => ({
      nodeTexts,
      updateTrigger: state.updateTrigger + 1,
    })),

  setEdgeTexts: (edgeTexts) =>
    set((state) => ({
      edgeTexts,
      updateTrigger: state.updateTrigger + 1,
    })),

  setStationTexts: (stationTexts) =>
    set((state) => ({
      stationTexts,
      updateTrigger: state.updateTrigger + 1,
    })),

  addNodeText: (nodeName, position) =>
    set((state) => ({
      nodeTexts: {
        ...state.nodeTexts,
        [nodeName]: position,
      },
      updateTrigger: state.updateTrigger + 1,
    })),

  addEdgeText: (edgeName, position) =>
    set((state) => ({
      edgeTexts: {
        ...state.edgeTexts,
        [edgeName]: position,
      },
      updateTrigger: state.updateTrigger + 1,
    })),

  addStationText: (stationName, position) =>
    set((state) => ({
      stationTexts: {
        ...state.stationTexts,
        [stationName]: position,
      },
      updateTrigger: state.updateTrigger + 1,
    })),

  removeNodeText: (nodeName) =>
    set((state) => {
      const { [nodeName]: removed, ...rest } = state.nodeTexts;
      return {
        nodeTexts: rest,
        updateTrigger: state.updateTrigger + 1,
      };
    }),

  removeEdgeText: (edgeName) =>
    set((state) => {
      const { [edgeName]: removed, ...rest } = state.edgeTexts;
      return {
        edgeTexts: rest,
        updateTrigger: state.updateTrigger + 1,
      };
    }),

  removeStationText: (stationName) =>
    set((state) => {
      const { [stationName]: removed, ...rest } = state.stationTexts;
      return {
        stationTexts: rest,
        updateTrigger: state.updateTrigger + 1,
      };
    }),

  // Array mode actions
  setNodeTextsArray: (nodeTexts) =>
    set((state) => ({
      nodeTextsArray: nodeTexts,
      updateTrigger: state.updateTrigger + 1,
    })),

  setEdgeTextsArray: (edgeTexts) =>
    set((state) => ({
      edgeTextsArray: edgeTexts,
      updateTrigger: state.updateTrigger + 1,
    })),

  setStationTextsArray: (stationTexts) =>
    set((state) => ({
      stationTextsArray: stationTexts,
      updateTrigger: state.updateTrigger + 1,
    })),

  addNodeTextArray: (item) =>
    set((state) => ({
      nodeTextsArray: [...state.nodeTextsArray, item],
      updateTrigger: state.updateTrigger + 1,
    })),

  addEdgeTextArray: (item) =>
    set((state) => ({
      edgeTextsArray: [...state.edgeTextsArray, item],
      updateTrigger: state.updateTrigger + 1,
    })),

  addStationTextArray: (item) =>
    set((state) => ({
      stationTextsArray: [...state.stationTextsArray, item],
      updateTrigger: state.updateTrigger + 1,
    })),

  removeNodeTextArray: (nodeName) =>
    set((state) => ({
      nodeTextsArray: state.nodeTextsArray.filter((item) => item.name !== nodeName),
      updateTrigger: state.updateTrigger + 1,
    })),

  removeEdgeTextArray: (edgeName) =>
    set((state) => ({
      edgeTextsArray: state.edgeTextsArray.filter((item) => item.name !== edgeName),
      updateTrigger: state.updateTrigger + 1,
    })),

  removeStationTextArray: (stationName) =>
    set((state) => ({
      stationTextsArray: state.stationTextsArray.filter((item) => item.name !== stationName),
      updateTrigger: state.updateTrigger + 1,
    })),

  // Common actions
  clearAllTexts: () =>
    set((state) => ({
      nodeTexts: {},
      edgeTexts: {},
      stationTexts: {},
      nodeTextsArray: [],
      edgeTextsArray: [],
      stationTextsArray: [],
      updateTrigger: state.updateTrigger + 1,
    })),

  forceUpdate: () =>
    set((state) => ({
      updateTrigger: state.updateTrigger + 1,
    })),

  // Utility functions
  getAllTexts: () => {
    const state = get();
    return {
      ...state.nodeTexts,
      ...state.edgeTexts,
      ...state.stationTexts,
    };
  },

  getAllTextsArray: () => {
    const state = get();
    return [...state.nodeTextsArray, ...state.edgeTextsArray, ...state.stationTextsArray];
  },
}));
