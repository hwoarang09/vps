// common/vehicle/initialize/index.ts
// Re-export all initialization utilities

export type {
  VehiclePlacement,
  AddVehicleData,
  InitializationResult,
  IEdgeVehicleQueue,
  ILockMgr,
  IVehicleStore,
  VehicleInitConfig,
  InitializeVehiclesCommonParams,
} from "./types";
export * from "./constants";
export {
  buildEdgeNameToIndex,
  initializeSingleVehicle,
  initializeVehicleStates,
  sortVehiclesInEdges,
  processMergeEdgeLocks,
  initializeVehicles,
  type InitializeSingleVehicleParams,
  type InitializeVehicleStatesParams,
} from "./initializeVehicles";
