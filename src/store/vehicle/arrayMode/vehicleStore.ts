// vehicleStore.ts
// Zustand store wrapper for array-based vehicle management

import { create } from "zustand";
import { vehicleDataArray } from "./vehicleDataArray";
import { edgeVehicleQueue } from "./edgeVehicleQueue";
import type { IVehicleStore, IEdgeVehicleQueue } from "@/common/vehicle/initialize";
import * as ops from "@/common/vehicle/store";

export interface VehicleArrayStore extends IVehicleStore {
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

  // IVehicleStore interface methods
  getVehicleData: () => Float32Array;
  getEdgeVehicleQueue: () => IEdgeVehicleQueue;

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

    transferMode: TransferMode.RANDOM,
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
      ops.setVehiclePosition(vehicleDataArray, vehicleIndex, x, y, z);
    },

    // Set vehicle velocity
    setVehicleVelocity: (vehicleIndex, velocity) => {
      ops.setVehicleVelocity(vehicleDataArray, vehicleIndex, velocity);
    },

    // Set vehicle rotation
    setVehicleRotation: (vehicleIndex, rotation) => {
      ops.setVehicleRotation(vehicleDataArray, vehicleIndex, rotation);
    },

    // Set vehicle status
    setVehicleMovingStatus: (vehicleIndex, status) => {
      ops.setVehicleMovingStatus(vehicleDataArray, vehicleIndex, status);
    },

    // Set vehicle acceleration
    setVehicleAcceleration: (vehicleIndex, acceleration) => {
      ops.setVehicleAcceleration(vehicleDataArray, vehicleIndex, acceleration);
    },

    // Set vehicle deceleration
    setVehicleDeceleration: (vehicleIndex, deceleration) => {
      ops.setVehicleDeceleration(vehicleDataArray, vehicleIndex, deceleration);
    },

    // Set vehicle edge ratio
    setVehicleEdgeRatio: (vehicleIndex, edgeRatio) => {
      ops.setVehicleEdgeRatio(vehicleDataArray, vehicleIndex, edgeRatio);
    },

    // Set vehicle current edge
    setVehicleCurrentEdge: (vehicleIndex, edgeIndex) => {
      ops.setVehicleCurrentEdge(vehicleDataArray, vehicleIndex, edgeIndex);
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
      return ops.getVehicleMovingStatus(vehicleDataArray, vehicleIndex);
    },

    // Get vehicle current edge
    getVehicleCurrentEdge: (vehicleIndex) => {
      return ops.getVehicleCurrentEdge(vehicleDataArray, vehicleIndex);
    },

    // Get vehicle edge ratio
    getVehicleEdgeRatio: (vehicleIndex) => {
      return ops.getVehicleEdgeRatio(vehicleDataArray, vehicleIndex);
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

    // IVehicleStore interface methods
    getVehicleData: () => vehicleDataArray.getData(),
    getEdgeVehicleQueue: () => edgeVehicleQueue,

    // Add vehicle (integrated)
    addVehicle: (vehicleIndex, data) => {
      ops.addVehicle(vehicleDataArray, edgeVehicleQueue, vehicleIndex, data);
    },

    // Remove vehicle (integrated)
    removeVehicle: (vehicleIndex) => {
      ops.removeVehicle(vehicleDataArray, edgeVehicleQueue, vehicleIndex);
    },

    // Move vehicle to new edge
    moveVehicleToEdge: (vehicleIndex, newEdgeIndex, edgeRatio = 0) => {
      ops.moveVehicleToEdge(vehicleDataArray, edgeVehicleQueue, vehicleIndex, newEdgeIndex, edgeRatio);
    },

    // Clear all vehicles
    clearAllVehicles: () => {
      ops.clearAllVehicles(vehicleDataArray, edgeVehicleQueue, '[VehicleArrayStore]');
    },
  })
);

export enum TransferMode {
  LOOP = "LOOP",
  RANDOM = "RANDOM",
}
