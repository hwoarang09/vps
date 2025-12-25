import React, { useCallback } from "react";
import { useVehicleRapierStore } from "../../../../../store/vehicle/rapierMode/vehicleStore";
import { getRapierModeConfig } from "../../../../../config/visualizationConfig";
import { BaseVehicleRenderer } from "./BaseVehicleRenderer";
import type { UpdateTransformFn } from "./BaseVehicleRenderer";

/**
 * VehicleRapierRenderer
 * - Renders vehicles for rapier-dict mode
 * - Reads directly from RigidBody (source of truth)
 * - Uses InstancedMesh for performance
 * - Sensor visibility controlled by visualizationConfig
 */

interface VehicleRapierRendererProps {
  actualNumVehicles: number;
}

const VehicleRapierRenderer: React.FC<VehicleRapierRendererProps> = ({
  actualNumVehicles,
}) => {
  const rapierStore = useVehicleRapierStore();

  // Get visualization config
  const vizConfig = getRapierModeConfig();
  const showSensor = vizConfig.SHOW_SENSOR_EDGES;

  // 자식 컴포넌트에게 전달할 업데이트 함수
  const onUpdate: UpdateTransformFn = useCallback(
    (index, position, quaternion) => {
      const rigidBody = rapierStore.getRigidBody(index);
      if (!rigidBody) return false;

      const translation = rigidBody.translation();
      const rotation = rigidBody.rotation();

      position.set(translation.x, translation.y, translation.z);
      quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
      return true;
    },
    [rapierStore]
  );

  return (
    <BaseVehicleRenderer
      numVehicles={actualNumVehicles}
      showSensor={showSensor}
      rendererName="Rapier"
      onUpdate={onUpdate}
    />
  );
};

export default VehicleRapierRenderer;


