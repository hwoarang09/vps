// Vehicle configuration (delegates to simulationConfig)
// This file is kept for backward compatibility
import {
  getBodyLength as getSimBodyLength,
  getBodyWidth as getSimBodyWidth,
  getBodyHeight as getSimBodyHeight,
  getVehicleZOffset as getSimVehicleZOffset,
  getVehicleSpacing as getSimVehicleSpacing,
  getEdgeMargin as getSimEdgeMargin,
  getCrossEdgeSafeDistance as getSimCrossEdgeSafeDistance,
} from "./simulationConfig";

export interface VehicleConfig {
  body: {
    length: number;
    width: number;
    height: number;
    zOffset: number;
  };
  spacing: {
    vehicleSpacing: number;
    edgeMargin: number;
    crossEdgeSafeDistance: number;
  };
  label: {
    textHeight: number;
    zOffset: number;
  };
}

// Delegate to simulationConfig
export const getVehicleConfig = (): VehicleConfig => {
  return {
    body: {
      length: getSimBodyLength(),
      width: getSimBodyWidth(),
      height: getSimBodyHeight(),
      zOffset: getSimVehicleZOffset(),
    },
    spacing: {
      vehicleSpacing: getSimVehicleSpacing(),
      edgeMargin: getSimEdgeMargin(),
      crossEdgeSafeDistance: getSimCrossEdgeSafeDistance(),
    },
    label: {
      textHeight: 0.6, // Not in simulationConfig, hardcoded
      zOffset: 0.9,
    },
  };
};

// Individual getters (delegate)
export const getBodyLength = getSimBodyLength;
export const getBodyWidth = getSimBodyWidth;
export const getBodyHeight = getSimBodyHeight;
export const getVehicleZOffset = getSimVehicleZOffset;
export const getVehicleSpacing = getSimVehicleSpacing;
export const getEdgeMargin = getSimEdgeMargin;
export const getCrossEdgeSafeDistance = getSimCrossEdgeSafeDistance;

// Backward compatibility
export const getVehicleConfigSync = getVehicleConfig;
export const waitForConfig = () => Promise.resolve(getVehicleConfig());
export const getMaxVehicles = () => 200000; // Moved to simulationConfig
