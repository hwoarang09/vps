import { create } from "zustand";

export type MapHoverKind = "node" | "edge" | "station";

interface MapHoverState {
  kind: MapHoverKind | null;
  name: string | null;       // node_name / edge_name / station_name
  fabIndex: number | null;   // hover 발생 시점의 active fab

  setHover: (kind: MapHoverKind, name: string, fabIndex: number) => void;
  clearHover: () => void;
}

// Map text → 해당 객체(node/edge/station) hover 상태.
// raycast가 일어나는 invisible hit plane에서 set/clear, 각 renderer가 구독해서
// aSelected attribute 업데이트. multi-fab은 한 세트의 text를 active fab으로
// shift시키는 구조라 hover 시점의 fabIndex 한 개만 저장하면 됨.
export const useMapHoverStore = create<MapHoverState>((set) => ({
  kind: null,
  name: null,
  fabIndex: null,

  setHover: (kind, name, fabIndex) => set({ kind, name, fabIndex }),
  clearHover: () => set({ kind: null, name: null, fabIndex: null }),
}));
