import { create } from "zustand";
import { useMenuStore } from "./menuStore";

/**
 * 차량 단일 진실 ID — fab-local.
 * 모든 로그(snapshot.bin, edge_transit.bin, lock.bin 등)와 1:1 매칭.
 * Render index / worker index는 controller helper로만 변환해서 사용.
 *
 * Array mode (단일 fab 없는 모드): fabId="" 로 사용, localIndex = vehicle index 그대로.
 */
export interface SelectedVehicle {
  fabId: string;
  localIndex: number;
}

interface VehicleControlState {
  selectedVehicle: SelectedVehicle | null;
  isPanelOpen: boolean;

  selectVehicle: (sel: SelectedVehicle | null) => void;
  openPanel: () => void;
  closePanel: () => void;
  togglePanel: () => void;
}

export const useVehicleControlStore = create<VehicleControlState>((set) => ({
  selectedVehicle: null,
  isPanelOpen: false,

  selectVehicle: (sel) => {
    set({ selectedVehicle: sel, isPanelOpen: sel !== null });
    if (sel !== null) {
      const menuStore = useMenuStore.getState();
      menuStore.setActiveMainMenu("Search");
      menuStore.setActiveSubMenu("search-vehicle");
      menuStore.setRightPanelOpen(true);
    }
  },
  openPanel: () => set({ isPanelOpen: true }),
  closePanel: () => set({ isPanelOpen: false, selectedVehicle: null }),
  togglePanel: () => set((state) => ({ isPanelOpen: !state.isPanelOpen })),
}));
