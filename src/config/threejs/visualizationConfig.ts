// Visualization configuration (delegates to renderConfig)
// This file is kept for backward compatibility
import { getVehicleRenderConfig } from "./renderConfig";

// Synchronous getter for RAPIER mode
export const getRapierModeConfig = () => {
  const config = getVehicleRenderConfig();
  return {
    SHOW_PHYSICS_DEBUG: config.showPhysicsDebug.RAPIER_MODE,
    SHOW_SENSOR_EDGES: config.showSensorEdges.RAPIER_MODE,
  };
};

// Synchronous getter for ARRAY mode
export const getArrayModeConfig = () => {
  const config = getVehicleRenderConfig();
  return {
    SHOW_SENSOR_EDGES: config.showSensorEdges.ARRAY_MODE,
  };
};

// Synchronous getter for SHARED_MEMORY mode
export const getSharedMemoryModeConfig = () => {
  const config = getVehicleRenderConfig();
  return {
    SHOW_SENSOR_EDGES: config.showSensorEdges.SHARED_MEMORY_MODE,
  };
};
