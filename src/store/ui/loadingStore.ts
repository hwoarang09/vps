import { create } from "zustand";

interface LoadingStore {
  configReady: boolean;
  iconsLoaded: boolean;
  mapLoaded: boolean;
  fabsTotal: number;
  fabsInitialized: number;
  allReady: boolean;
  setConfigReady: () => void;
  setIconsLoaded: () => void;
  setMapLoaded: () => void;
  setFabsTotal: (n: number) => void;
  addFabsInitialized: (n: number) => void;
  setAllReady: () => void;
}

export const useLoadingStore = create<LoadingStore>((set) => ({
  configReady: false,
  iconsLoaded: false,
  mapLoaded: false,
  fabsTotal: 0,
  fabsInitialized: 0,
  allReady: false,
  setConfigReady: () => set({ configReady: true }),
  setIconsLoaded: () => set({ iconsLoaded: true }),
  setMapLoaded: () => set({ mapLoaded: true }),
  setFabsTotal: (n: number) => set({ fabsTotal: n }),
  addFabsInitialized: (n: number) =>
    set((s) => ({ fabsInitialized: s.fabsInitialized + n })),
  setAllReady: () => set({ allReady: true }),
}));
