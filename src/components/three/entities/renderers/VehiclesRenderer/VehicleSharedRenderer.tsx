import React, { useCallback } from "react";
import * as THREE from "three";
import { vehicleSharedMovement } from "@/store/vehicle/sharedMode/vehicleMovement";
import { getSharedMemoryModeConfig } from "@/config/visualizationConfig";
import { BaseVehicleRenderer } from "./BaseVehicleRenderer";
import type { UpdateTransformFn } from "./BaseVehicleRenderer";

/**
 * VehicleSharedRenderer
 * - Renders vehicles for shared-memory mode
 * - Reads from vehicleSharedMovement (SharedArrayBuffer)
 * - Uses InstancedMesh for performance
 * - Sensor visibility controlled by visualizationConfig
 */

interface VehicleSharedRendererProps {
  numVehicles: number;
}

const VehicleSharedRenderer: React.FC<VehicleSharedRendererProps> = ({
  numVehicles,
}) => {
  // Get visualization config
  const vizConfig = getSharedMemoryModeConfig();
  const showSensor = vizConfig.SHOW_SENSOR_EDGES;

  const onUpdate: UpdateTransformFn = useCallback(
    (index, position, quaternion) => {
      const vehicle = vehicleSharedMovement.get(index);
      if (!vehicle) return false;

      // Body position
      position.set(vehicle.movement.x, vehicle.movement.y, vehicle.movement.z);

      // Convert rotation from degrees to radians (Z-axis rotation)
      const rotRad = (vehicle.movement.rotation * Math.PI) / 180;
      quaternion.setFromEuler(new THREE.Euler(0, 0, rotRad));
      
      return true;
    },
    []
  );

  return (
    <BaseVehicleRenderer
      numVehicles={numVehicles}
      showSensor={showSensor}
      rendererName="Shared"
      onUpdate={onUpdate}
    />
  );
};

export default VehicleSharedRenderer;


