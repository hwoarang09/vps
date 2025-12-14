import { create } from "zustand";

interface VehicleControlState {
  selectedVehicleId: number | null;
  isPanelOpen: boolean;

  selectVehicle: (id: number) => void;
  closePanel: () => void;
  togglePanel: () => void;
}

export const useVehicleControlStore = create<VehicleControlState>((set) => ({
  selectedVehicleId: null,
  isPanelOpen: false,

  selectVehicle: (id: number) => set({ selectedVehicleId: id, isPanelOpen: true }),
  closePanel: () => set({ isPanelOpen: false, selectedVehicleId: null }),
  togglePanel: () => set((state) => ({ isPanelOpen: !state.isPanelOpen })),
}));
