import { create } from "zustand";
import { getMaxVehicles } from "@/config/vehicleConfig";
import type { RapierRigidBody } from "@react-three/rapier";

// Vehicle data structure matching shared memory layout
import {
  VEHICLE_DATA_SIZE,
  MovementData,
} from "@/common/vehicle/initialize/constants";

// Vehicle data interface for dict mode (Rapier)
interface VehicleRefData {
  movement: {
    x: number;
    y: number;
    z: number;
    rotation: number;
    velocity: number;
    acceleration: number;
    edgeRatio: number;
  };
  status: {
    status: number;
    currentEdge: number;
  };
  sensor: {
    presetIdx: number;
  };
  // Rapier RigidBody reference (only for dict mode)
  rigidBody?: RapierRigidBody | null;
}

interface VehicleRapierStore {
  // Mode selection: 'rapier' (dict with RigidBody), 'array_single' (single thread), 'array_shared' (multi thread with SharedArrayBuffer)
  mode: "rapier" | "array_single" | "array_shared";

  // Array-based approach (for array_single and array_shared modes)
  vehicleDataArray: Float32Array | null;
  maxVehicles: number;

  // Dict-based approach (rapier mode - always uses dictionary)
  vehicleDataDict: Map<number, VehicleRefData>;

  // Actual number of vehicles placed
  actualNumVehicles: number;

  // Maximum number of vehicles that can be placed
  maxPlaceableVehicles: number;
  setActualNumVehicles: (num: number) => void;
  setMaxPlaceableVehicles: (num: number) => void;

  // Initialize store
  initArraySingleMode: (maxVehicles?: number) => void;
  initArraySharedMode: (maxVehicles?: number) => void;
  initRapierMode: () => void;

  // Common operations
  setVehiclePosition: (
    vehicleIndex: number,
    x: number,
    y: number,
    z: number
  ) => void;
  getVehiclePosition: (vehicleIndex: number) => { x: number; y: number; z: number } | null;

  setVehicleVelocity: (vehicleIndex: number, velocity: number) => void;
  getVehicleVelocity: (vehicleIndex: number) => number | null;

  setVehicleRotation: (vehicleIndex: number, rotation: number) => void;
  getVehicleRotation: (vehicleIndex: number) => number | null;

  setVehicleStatus: (vehicleIndex: number, status: number) => void;
  getVehicleStatus: (vehicleIndex: number) => number | null;

  setCurrentEdge: (vehicleIndex: number, edgeIndex: number) => void;
  getCurrentEdge: (vehicleIndex: number) => number | null;

  setEdgeRatio: (vehicleIndex: number, ratio: number) => void;
  getEdgeRatio: (vehicleIndex: number) => number | null;

  // Batch add vehicles (rapier mode only)
  batchAddVehicles: (vehicles: Array<{
    index: number;
    x: number;
    y: number;
    z: number;
    velocity: number;
    edgeIndex: number;
    edgeRatio: number;
    status: number;
  }>) => void;

  // Add/remove vehicles
  addVehicle: (vehicleIndex: number) => void;
  removeVehicle: (vehicleIndex: number) => void;

  // RigidBody management
  setRigidBody: (vehicleIndex: number, rigidBody: RapierRigidBody) => void;
  getRigidBody: (vehicleIndex: number) => RapierRigidBody | null;

  // Clear all data
  clearAll: () => void;
}

export const useVehicleRapierStore = create<VehicleRapierStore>(
  (set, get) => ({
    mode: "array_single",
    vehicleDataArray: null,
    maxVehicles: getMaxVehicles(),
    vehicleDataDict: new Map(),
    actualNumVehicles: 0,
    maxPlaceableVehicles: 0,

    // Set actual number of vehicles
    setActualNumVehicles: (num) => {
      set({ actualNumVehicles: num });
    },

    // Set maximum placeable vehicles
    setMaxPlaceableVehicles: (num) => {
      set({ maxPlaceableVehicles: num });
    },

    // Initialize array single thread mode
    initArraySingleMode: (maxVehicles = getMaxVehicles()) => {
      const data = new Float32Array(maxVehicles * VEHICLE_DATA_SIZE);
      set({
        mode: "array_single",
        vehicleDataArray: data,
        maxVehicles,
        vehicleDataDict: new Map(),
      });
    },

    // Initialize array shared mode (multi-thread with SharedArrayBuffer)
    initArraySharedMode: (maxVehicles = getMaxVehicles()) => {
      const data = new Float32Array(maxVehicles * VEHICLE_DATA_SIZE);
      set({
        mode: "array_shared",
        vehicleDataArray: data,
        maxVehicles,
        vehicleDataDict: new Map(),
      });
    },

    // Initialize rapier mode (always uses dictionary)
    initRapierMode: () => {
      set({
        mode: "rapier",
        vehicleDataArray: null,
        vehicleDataDict: new Map(),
      });
    },

    // Batch add vehicles (rapier mode only) - SINGLE RE-RENDER
    batchAddVehicles: (vehicles) => {
      set((state) => {
        const newDict = new Map(state.vehicleDataDict);
        for (const v of vehicles) {
          newDict.set(v.index, {
            movement: {
              x: v.x,
              y: v.y,
              z: v.z,
              rotation: 0,
              velocity: v.velocity,
              acceleration: 0,
              edgeRatio: v.edgeRatio,
            },
            status: {
              status: v.status,
              currentEdge: v.edgeIndex,
            },
            sensor: {
              presetIdx: 0, // Default to STRAIGHT
            },
          });
        }
        return { vehicleDataDict: newDict };
      });
    },

    // Set vehicle position
    setVehiclePosition: (vehicleIndex, x, y, z) => {
      const { mode, vehicleDataArray, vehicleDataDict } = get();

      if (mode === "array_single" || mode === "array_shared") {
        if (vehicleDataArray) {
          const offset = vehicleIndex * VEHICLE_DATA_SIZE;
          vehicleDataArray[offset + MovementData.X] = x;
          vehicleDataArray[offset + MovementData.Y] = y;
          vehicleDataArray[offset + MovementData.Z] = z;
        }
      } else if (mode === "rapier") {
        const vehicle = vehicleDataDict.get(vehicleIndex);
        if (vehicle) {
          vehicle.movement.x = x;
          vehicle.movement.y = y;
          vehicle.movement.z = z;
        }
      }
    },

    // Get vehicle position
    getVehiclePosition: (vehicleIndex) => {
      const { mode, vehicleDataArray, vehicleDataDict } = get();

      if (mode === "array_single" || mode === "array_shared") {
        if (vehicleDataArray) {
          const offset = vehicleIndex * VEHICLE_DATA_SIZE;
          return {
            x: vehicleDataArray[offset + MovementData.X],
            y: vehicleDataArray[offset + MovementData.Y],
            z: vehicleDataArray[offset + MovementData.Z],
          };
        }
      } else if (mode === "rapier") {
        const vehicle = vehicleDataDict.get(vehicleIndex);
        if (vehicle) {
          return {
            x: vehicle.movement.x,
            y: vehicle.movement.y,
            z: vehicle.movement.z,
          };
        }
      }
      return null;
    },

    // Set vehicle velocity
    setVehicleVelocity: (vehicleIndex, velocity) => {
      const { mode, vehicleDataArray, vehicleDataDict } = get();

      if (mode === "array_single" || mode === "array_shared") {
        if (vehicleDataArray) {
          const offset = vehicleIndex * VEHICLE_DATA_SIZE;
          vehicleDataArray[offset + MovementData.VELOCITY] = velocity;
        }
      } else if (mode === "rapier") {
        const vehicle = vehicleDataDict.get(vehicleIndex);
        if (vehicle) {
          vehicle.movement.velocity = velocity;
        }
      }
    },

    // Get vehicle velocity
    getVehicleVelocity: (vehicleIndex) => {
      const { mode, vehicleDataArray, vehicleDataDict } = get();

      if (mode === "array_single" || mode === "array_shared") {
        if (vehicleDataArray) {
          const offset = vehicleIndex * VEHICLE_DATA_SIZE;
          return vehicleDataArray[offset + MovementData.VELOCITY];
        }
      } else if (mode === "rapier") {
        const vehicle = vehicleDataDict.get(vehicleIndex);
        if (vehicle) {
          return vehicle.movement.velocity;
        }
      }
      return null;
    },

    // Set vehicle rotation
    setVehicleRotation: (vehicleIndex, rotation) => {
      const { mode, vehicleDataArray, vehicleDataDict } = get();

      if (mode === "array_single" || mode === "array_shared") {
        if (vehicleDataArray) {
          const offset = vehicleIndex * VEHICLE_DATA_SIZE;
          vehicleDataArray[offset + MovementData.ROTATION] = rotation;
        }
      } else if (mode === "rapier") {
        const vehicle = vehicleDataDict.get(vehicleIndex);
        if (vehicle) {
          vehicle.movement.rotation = rotation;
        }
      }
    },

    // Get vehicle rotation
    getVehicleRotation: (vehicleIndex) => {
      const { mode, vehicleDataArray, vehicleDataDict } = get();

      if (mode === "array_single" || mode === "array_shared") {
        if (vehicleDataArray) {
          const offset = vehicleIndex * VEHICLE_DATA_SIZE;
          return vehicleDataArray[offset + MovementData.ROTATION];
        }
      } else if (mode === "rapier") {
        const vehicle = vehicleDataDict.get(vehicleIndex);
        if (vehicle) {
          return vehicle.movement.rotation;
        }
      }
      return null;
    },

    // Set vehicle status
    setVehicleStatus: (vehicleIndex, status) => {
      const { mode, vehicleDataArray, vehicleDataDict } = get();

      if (mode === "array_single" || mode === "array_shared") {
        if (vehicleDataArray) {
          const offset = vehicleIndex * VEHICLE_DATA_SIZE;
          vehicleDataArray[offset + MovementData.MOVING_STATUS] = status;
        }
      } else if (mode === "rapier") {
        const vehicle = vehicleDataDict.get(vehicleIndex);
        if (vehicle) {
          vehicle.status.status = status;
        }
      }
    },

    // Get vehicle status
    getVehicleStatus: (vehicleIndex) => {
      const { mode, vehicleDataArray, vehicleDataDict } = get();

      if (mode === "array_single" || mode === "array_shared") {
        if (vehicleDataArray) {
          const offset = vehicleIndex * VEHICLE_DATA_SIZE;
          return vehicleDataArray[offset + MovementData.MOVING_STATUS];
        }
      } else if (mode === "rapier") {
        const vehicle = vehicleDataDict.get(vehicleIndex);
        if (vehicle) {
          return vehicle.status.status;
        }
      }
      return null;
    },

    // Set current edge
    setCurrentEdge: (vehicleIndex, edgeIndex) => {
      const { mode, vehicleDataArray, vehicleDataDict } = get();

      if (mode === "array_single" || mode === "array_shared") {
        if (vehicleDataArray) {
          const offset = vehicleIndex * VEHICLE_DATA_SIZE;
          vehicleDataArray[offset + MovementData.CURRENT_EDGE] = edgeIndex;
        }
      } else if (mode === "rapier") {
        const vehicle = vehicleDataDict.get(vehicleIndex);
        if (vehicle) {
          vehicle.status.currentEdge = edgeIndex;
        }
      }
    },

    // Get current edge
    getCurrentEdge: (vehicleIndex) => {
      const { mode, vehicleDataArray, vehicleDataDict } = get();

      if (mode === "array_single" || mode === "array_shared") {
        if (vehicleDataArray) {
          const offset = vehicleIndex * VEHICLE_DATA_SIZE;
          return vehicleDataArray[offset + MovementData.CURRENT_EDGE];
        }
      } else if (mode === "rapier") {
        const vehicle = vehicleDataDict.get(vehicleIndex);
        if (vehicle) {
          return vehicle.status.currentEdge;
        }
      }
      return null;
    },

    // Set edge ratio
    setEdgeRatio: (vehicleIndex, ratio) => {
      const { mode, vehicleDataArray, vehicleDataDict } = get();

      if (mode === "array_single" || mode === "array_shared") {
        if (vehicleDataArray) {
          const offset = vehicleIndex * VEHICLE_DATA_SIZE;
          vehicleDataArray[offset + MovementData.EDGE_RATIO] = ratio;
        }
      } else if (mode === "rapier") {
        const vehicle = vehicleDataDict.get(vehicleIndex);
        if (vehicle) {
          vehicle.movement.edgeRatio = ratio;
        }
      }
    },

    // Get edge ratio
    getEdgeRatio: (vehicleIndex) => {
      const { mode, vehicleDataArray, vehicleDataDict } = get();

      if (mode === "array_single" || mode === "array_shared") {
        if (vehicleDataArray) {
          const offset = vehicleIndex * VEHICLE_DATA_SIZE;
          return vehicleDataArray[offset + MovementData.EDGE_RATIO];
        }
      } else if (mode === "rapier") {
        const vehicle = vehicleDataDict.get(vehicleIndex);
        if (vehicle) {
          return vehicle.movement.edgeRatio;
        }
      }
      return null;
    },

    // Add vehicle (dict mode only)
    addVehicle: (vehicleIndex) => {
      set((state) => {
        const newDict = new Map(state.vehicleDataDict);
        newDict.set(vehicleIndex, {
          movement: {
            x: 0,
            y: 0,
            z: 0,
            rotation: 0,
            velocity: 0,
            acceleration: 0,
            edgeRatio: 0,
          },
          status: {
            status: 0,
            currentEdge: -1,
          },
          sensor: {
            presetIdx: 0, // Default to STRAIGHT
          },
        });
        return { vehicleDataDict: newDict };
      });
    },

    // Remove vehicle (dict mode only)
    removeVehicle: (vehicleIndex) => {
      set((state) => {
        const newDict = new Map(state.vehicleDataDict);
        newDict.delete(vehicleIndex);
        return { vehicleDataDict: newDict };
      });
    },

    // Set RigidBody reference (dict mode only)
    setRigidBody: (vehicleIndex, rigidBody) => {
      const { vehicleDataDict } = get();
      const vehicle = vehicleDataDict.get(vehicleIndex);
      if (vehicle) {
        vehicle.rigidBody = rigidBody;
      }
    },

    // Get RigidBody reference (dict mode only)
    getRigidBody: (vehicleIndex) => {
      const { vehicleDataDict } = get();
      const vehicle = vehicleDataDict.get(vehicleIndex);
      return vehicle?.rigidBody || null;
    },

    // Clear all data
    clearAll: () => {
      const { mode, vehicleDataArray } = get();

      if (mode === "array_single" || mode === "array_shared") {
        if (vehicleDataArray) {
          vehicleDataArray.fill(0);
        }
      } else if (mode === "rapier") {
        set({ vehicleDataDict: new Map() });
      }
    },
  })
);