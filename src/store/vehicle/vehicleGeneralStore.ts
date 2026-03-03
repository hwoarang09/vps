import { create } from "zustand";
import { JobState } from "@/common/vehicle/initialize/constants";

export type { JobState };

// Vehicle general data (metadata and non-physics data)
interface VehicleData {
  // Metadata
  id: string;
  name: string;
  color: string;

  // General data (not in SharedMemory)
  battery: number; // 0~100
  vehicleType: number; // 0=small, 1=medium, 2=large
  jobState: number; // JobState enum: IDLE, MOVE_TO_LOAD, LOADING, MOVE_TO_UNLOAD, UNLOADING, ERROR
}

interface VehicleGeneralStore {
  vehicles: Map<number, VehicleData>;

  // CRUD operations
  addVehicle: (vehicleIndex: number, data: VehicleData) => void;
  batchAddVehicles: (data: Map<number, VehicleData>) => void;
  removeVehicle: (vehicleIndex: number) => void;
  updateVehicle: (
    vehicleIndex: number,
    updates: Partial<VehicleData>
  ) => void;
  getVehicle: (vehicleIndex: number) => VehicleData | undefined;
  clearAll: () => void;

  // Specific updates
  setVehicleBattery: (vehicleIndex: number, battery: number) => void;
  setVehicleJobState: (vehicleIndex: number, jobState: number) => void;
}

export const useVehicleGeneralStore = create<VehicleGeneralStore>(
  (set, get) => ({
    vehicles: new Map(),

    // Add vehicle
    addVehicle: (vehicleIndex, data) =>
      set((state) => {
        const newMap = new Map(state.vehicles);
        newMap.set(vehicleIndex, data);
        return { vehicles: newMap };
      }),

    // Batch add vehicles
    batchAddVehicles: (data) =>
      set((state) => {
        const newMap = new Map(state.vehicles);
        for (const [key, value] of data) {
          newMap.set(key, value);
        }
        return { vehicles: newMap };
      }),

    // Remove vehicle
    removeVehicle: (vehicleIndex) =>
      set((state) => {
        const newMap = new Map(state.vehicles);
        newMap.delete(vehicleIndex);
        return { vehicles: newMap };
      }),

    // Update vehicle
    updateVehicle: (vehicleIndex, updates) =>
      set((state) => {
        const newMap = new Map(state.vehicles);
        const existing = newMap.get(vehicleIndex);
        if (existing) {
          newMap.set(vehicleIndex, { ...existing, ...updates });
        }
        return { vehicles: newMap };
      }),

    // Get vehicle
    getVehicle: (vehicleIndex) => get().vehicles.get(vehicleIndex),

    // Clear all
    clearAll: () => set({ vehicles: new Map() }),

    // Set battery
    setVehicleBattery: (vehicleIndex, battery) =>
      set((state) => {
        const newMap = new Map(state.vehicles);
        const existing = newMap.get(vehicleIndex);
        if (existing) {
          newMap.set(vehicleIndex, { ...existing, battery });
        }
        return { vehicles: newMap };
      }),

    // Set job state
    setVehicleJobState: (vehicleIndex, jobState) =>
      set((state) => {
        const newMap = new Map(state.vehicles);
        const existing = newMap.get(vehicleIndex);
        if (existing) {
          newMap.set(vehicleIndex, { ...existing, jobState });
        }
        return { vehicles: newMap };
      }),
  })
);

