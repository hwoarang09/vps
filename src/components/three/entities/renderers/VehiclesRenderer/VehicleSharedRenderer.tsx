import React, { useCallback } from "react";
import * as THREE from "three";
import { useShmSimulatorStore } from "@/store/vehicle/shmMode/shmSimulatorStore";
import { getSharedMemoryModeConfig } from "@/config/visualizationConfig";
import { BaseVehicleRenderer } from "./BaseVehicleRenderer";
import type { UpdateTransformFn } from "./BaseVehicleRenderer";
import { ShmSensorDebugRenderer } from "./ShmSensorDebugRenderer";
import ShmVehicleTextRenderer from "@/components/three/entities/text/instanced/ShmVehicleTextRenderer";
import {
  VEHICLE_DATA_SIZE,
  MovementData,
} from "@/shmSimulator/memory/vehicleDataArray";

/**
 * VehicleSharedRenderer
 * - Renders vehicles for shared-memory mode (SHM Simulator)
 * - Reads from ShmSimulatorController's SharedArrayBuffer
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

  // Get actual vehicle count from store
  const actualNumVehicles = useShmSimulatorStore((state) => state.actualNumVehicles);
  const isInitialized = useShmSimulatorStore((state) => state.isInitialized);

  const onUpdate: UpdateTransformFn = useCallback(
    (index, position, quaternion) => {
      // Get vehicle data directly from store (avoids re-render on every frame)
      const data = useShmSimulatorStore.getState().getVehicleData();
      if (!data) return false;

      const ptr = index * VEHICLE_DATA_SIZE;

      // Read position from Float32Array
      const x = data[ptr + MovementData.X];
      const y = data[ptr + MovementData.Y];
      const z = data[ptr + MovementData.Z];
      const rotation = data[ptr + MovementData.ROTATION];

      // Skip if position is zero (uninitialized vehicle)
      if (x === 0 && y === 0 && z === 0) return false;

      // Body position
      position.set(x, y, z);

      // Convert rotation from degrees to radians (Z-axis rotation)
      const rotRad = (rotation * Math.PI) / 180;
      quaternion.setFromEuler(new THREE.Euler(0, 0, rotRad));

      return true;
    },
    []
  );

  // Use actual vehicle count if available, otherwise use prop
  const renderCount = isInitialized && actualNumVehicles > 0 ? actualNumVehicles : numVehicles;

  return (
    <>
      <BaseVehicleRenderer
        numVehicles={renderCount}
        showSensor={showSensor}
        rendererName="SHM"
        onUpdate={onUpdate}
      />
      {/* Sensor Debug Wireframes */}
      <ShmSensorDebugRenderer numVehicles={renderCount} />
      {/* Vehicle ID Labels */}
      <ShmVehicleTextRenderer numVehicles={renderCount} />
    </>
  );
};

export default VehicleSharedRenderer;


