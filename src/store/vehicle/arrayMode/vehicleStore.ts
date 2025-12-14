// vehicleStore.ts
// Zustand store wrapper for array-based vehicle management

import { create } from "zustand";
import { vehicleDataArray } from "./vehicleDataArray";
import { edgeVehicleQueue } from "./edgeVehicleQueue";

export interface VehicleArrayStore {
  // Array references
  vehicleDataRef: Float32Array | null;
  edgeVehicleListRef: typeof edgeVehicleQueue | null;

  // Actual number of vehicles initialized
  actualNumVehicles: number;
  setActualNumVehicles: (num: number) => void;

  // Transfer Mode
  transferMode: TransferMode;
  setTransferMode: (mode: TransferMode) => void;

  // Initialize arrays (call once on app start)
  initArrayMemory: () => void;

  // Detailed methods
  setVehiclePosition: (
    vehicleIndex: number,
    x: number,
    y: number,
    z: number
  ) => void;
  setVehicleVelocity: (vehicleIndex: number, velocity: number) => void;
  setVehicleRotation: (vehicleIndex: number, rotation: number) => void;
  setVehicleMovingStatus: (vehicleIndex: number, status: number) => void;
  setVehicleAcceleration: (vehicleIndex: number, acceleration: number) => void;
  setVehicleDeceleration: (vehicleIndex: number, deceleration: number) => void;
  setVehicleEdgeRatio: (vehicleIndex: number, edgeRatio: number) => void;
  setVehicleCurrentEdge: (vehicleIndex: number, edgeIndex: number) => void;

  // Get methods
  getVehiclePosition: (vehicleIndex: number) => { x: number; y: number; z: number };
  getVehicleVelocity: (vehicleIndex: number) => number;
  getVehicleRotation: (vehicleIndex: number) => number;
  getVehicleMovingStatus: (vehicleIndex: number) => number;
  getVehicleCurrentEdge: (vehicleIndex: number) => number;
  getVehicleEdgeRatio: (vehicleIndex: number) => number;

  // Edge list methods
  addVehicleToEdgeList: (edgeIndex: number, vehicleIndex: number) => void;
  removeVehicleFromEdgeList: (edgeIndex: number, vehicleIndex: number) => void;
  getVehiclesInEdge: (edgeIndex: number) => number[];
  getEdgeVehicleCount: (edgeIndex: number) => number;

  clearVehicleData: (vehicleIndex: number) => void;
  clearAllVehicles: () => void;

  // Integrated methods
  addVehicle: (
    vehicleIndex: number,
    data: {
      x: number;
      y: number;
      z: number;
      edgeIndex: number;
      edgeRatio?: number;
      rotation?: number;
      velocity?: number;
      acceleration?: number;
      deceleration?: number;
      movingStatus?: number;
    }
  ) => void;

  removeVehicle: (vehicleIndex: number) => void;

  moveVehicleToEdge: (
    vehicleIndex: number,
    newEdgeIndex: number,
    edgeRatio?: number
  ) => void;
}

export const useVehicleArrayStore = create<VehicleArrayStore>(
  (set, get) => ({
    vehicleDataRef: null,
    edgeVehicleListRef: null,
    actualNumVehicles: 0,

    // Set actual number of vehicles
    setActualNumVehicles: (num) => {
      set({ actualNumVehicles: num });
    },

    transferMode: TransferMode.LOOP,
    setTransferMode: (mode) => set({ transferMode: mode }),

    // Initialize array memory
    initArrayMemory: () => {
      set({
        vehicleDataRef: vehicleDataArray.getData(),
        edgeVehicleListRef: edgeVehicleQueue,
      });
    },

    // Set vehicle position
    setVehiclePosition: (vehicleIndex, x, y, z) => {
      const vehicle = vehicleDataArray.get(vehicleIndex);
      vehicle.movement.x = x;
      vehicle.movement.y = y;
      vehicle.movement.z = z;
    },

    // Set vehicle velocity
    setVehicleVelocity: (vehicleIndex, velocity) => {
      const vehicle = vehicleDataArray.get(vehicleIndex);
      vehicle.movement.velocity = velocity;
    },

    // Set vehicle rotation
    setVehicleRotation: (vehicleIndex, rotation) => {
      const vehicle = vehicleDataArray.get(vehicleIndex);
      vehicle.movement.rotation = rotation;
    },

    // Set vehicle status
    setVehicleMovingStatus: (vehicleIndex, status) => {
      const vehicle = vehicleDataArray.get(vehicleIndex);
      vehicle.movement.movingStatus = status;
    },

    // Set vehicle acceleration
    setVehicleAcceleration: (vehicleIndex, acceleration) => {
      const vehicle = vehicleDataArray.get(vehicleIndex);
      vehicle.movement.acceleration = acceleration;
    },

    // Set vehicle deceleration
    setVehicleDeceleration: (vehicleIndex, deceleration) => {
      const vehicle = vehicleDataArray.get(vehicleIndex);
      vehicle.movement.deceleration = deceleration;
    },

    // Set vehicle edge ratio
    setVehicleEdgeRatio: (vehicleIndex, edgeRatio) => {
      const vehicle = vehicleDataArray.get(vehicleIndex);
      vehicle.movement.edgeRatio = edgeRatio;
    },

    // Set vehicle current edge
    setVehicleCurrentEdge: (vehicleIndex, edgeIndex) => {
      const vehicle = vehicleDataArray.get(vehicleIndex);
      vehicle.movement.currentEdge = edgeIndex;
    },

    // Get vehicle position
    getVehiclePosition: (vehicleIndex) => {
      return vehicleDataArray.getPosition(vehicleIndex);
    },

    // Get vehicle velocity
    getVehicleVelocity: (vehicleIndex) => {
      return vehicleDataArray.getVelocity(vehicleIndex);
    },

    // Get vehicle rotation
    getVehicleRotation: (vehicleIndex) => {
      return vehicleDataArray.getRotation(vehicleIndex);
    },

    // Get vehicle status
    getVehicleMovingStatus: (vehicleIndex) => {
      const vehicle = vehicleDataArray.get(vehicleIndex);
      return vehicle.movement.movingStatus;
    },

    // Get vehicle current edge
    getVehicleCurrentEdge: (vehicleIndex) => {
      const vehicle = vehicleDataArray.get(vehicleIndex);
      return vehicle.movement.currentEdge;
    },

    // Get vehicle edge ratio
    getVehicleEdgeRatio: (vehicleIndex) => {
      const vehicle = vehicleDataArray.get(vehicleIndex);
      return vehicle.movement.edgeRatio;
    },

    // Add vehicle to edge list
    addVehicleToEdgeList: (edgeIndex, vehicleIndex) => {
      edgeVehicleQueue.addVehicle(edgeIndex, vehicleIndex);
    },

    // Remove vehicle from edge list
    removeVehicleFromEdgeList: (edgeIndex, vehicleIndex) => {
      edgeVehicleQueue.removeVehicle(edgeIndex, vehicleIndex);
    },

    // Get vehicles in edge
    getVehiclesInEdge: (edgeIndex) => {
      return edgeVehicleQueue.getVehicles(edgeIndex);
    },

    // Get edge vehicle count
    getEdgeVehicleCount: (edgeIndex) => {
      return edgeVehicleQueue.getCount(edgeIndex);
    },

    // Clear vehicle data
    clearVehicleData: (vehicleIndex) => {
      vehicleDataArray.clearVehicle(vehicleIndex);
    },

    // Add vehicle (integrated)
    addVehicle: (vehicleIndex, data) => {
      const vehicle = vehicleDataArray.get(vehicleIndex);

      // Set movement data
      vehicle.movement.x = data.x;
      vehicle.movement.y = data.y;
      vehicle.movement.z = data.z;
      vehicle.movement.rotation = data.rotation ?? 0;
      vehicle.movement.velocity = data.velocity ?? 0;
      vehicle.movement.acceleration = data.acceleration ?? 0;
      vehicle.movement.deceleration = data.deceleration ?? 0;
      vehicle.movement.edgeRatio = data.edgeRatio ?? 0;

      // Set status data
      vehicle.movement.movingStatus = data.movingStatus ?? 0;
      vehicle.movement.currentEdge = data.edgeIndex;
      vehicle.sensor.hitZone = -1;

      // Add to edge list
      edgeVehicleQueue.addVehicle(data.edgeIndex, vehicleIndex);
    },

    // Remove vehicle (integrated)
    removeVehicle: (vehicleIndex) => {
      const store = get();
      const currentEdge = vehicleDataArray.get(vehicleIndex).movement.currentEdge;

      // Remove from edge list
      if (currentEdge !== -1) {
        store.removeVehicleFromEdgeList(currentEdge, vehicleIndex);
      }

      // Clear data
      store.clearVehicleData(vehicleIndex);
    },

    // Move vehicle to new edge
    moveVehicleToEdge: (vehicleIndex, newEdgeIndex, edgeRatio = 0) => {
      const store = get();
      const vehicle = vehicleDataArray.get(vehicleIndex);
      const oldEdge = vehicle.movement.currentEdge;

      // Remove from old edge
      if (oldEdge !== -1) {
        store.removeVehicleFromEdgeList(oldEdge, vehicleIndex);
      }

      // Add to new edge
      store.addVehicleToEdgeList(newEdgeIndex, vehicleIndex);
      vehicle.movement.currentEdge = newEdgeIndex;
      vehicle.movement.edgeRatio = edgeRatio;
    },

    // Clear all vehicles
    clearAllVehicles: () => {
      // Clear all edge lists
      edgeVehicleQueue.clearAll();

      // Clear all vehicle data
      vehicleDataArray.clearAll();

      console.log('[VehicleArrayStore] All vehicles cleared');
    },
  })
);

export enum TransferMode {
  LOOP = "LOOP",
  RANDOM = "RANDOM",
}
