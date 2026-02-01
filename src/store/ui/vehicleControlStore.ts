import { create } from "zustand";
import { useMenuStore } from "./menuStore";

interface VehicleControlState {
  selectedVehicleId: number | null;
  isPanelOpen: boolean;

  selectVehicle: (id: number) => void;
  openPanel: () => void;
  closePanel: () => void;
  togglePanel: () => void;
}

export const useVehicleControlStore = create<VehicleControlState>((set) => ({
  selectedVehicleId: null,
  isPanelOpen: false,

  selectVehicle: (id: number) => {
    set({ selectedVehicleId: id, isPanelOpen: true });
    // Open RightPanel with Vehicle Search
    const menuStore = useMenuStore.getState();
    menuStore.setActiveMainMenu("Search");
    menuStore.setActiveSubMenu("search-vehicle");
    menuStore.setRightPanelOpen(true);
  },
  openPanel: () => set({ isPanelOpen: true }),
  closePanel: () => set({ isPanelOpen: false, selectedVehicleId: null }),
  togglePanel: () => set((state) => ({ isPanelOpen: !state.isPanelOpen })),
}));
