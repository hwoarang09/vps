import { useRef, useMemo, useEffect, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useShmSimulatorStore } from "@/store/vehicle/shmMode/shmSimulatorStore";
import { getVehicleConfigSync, waitForConfig } from "@/config/vehicleConfig";
import { ShmSensorDebugRenderer } from "./ShmSensorDebugRenderer";
import ShmVehicleTextRenderer from "@/components/three/entities/text/instanced/ShmVehicleTextRenderer";
import {
  VEHICLE_DATA_SIZE,
  MovementData,
} from "@/shmSimulator/memory/vehicleDataArray";

const Z_AXIS = new THREE.Vector3(0, 0, 1);

/**
 * VehicleSharedRenderer
 * - Renders vehicles for shared-memory mode (SHM Simulator)
 * - Reads from ShmSimulatorController's SharedArrayBuffer
 * - Uses InstancedMesh for performance
 */

interface VehicleSharedRendererProps {
  numVehicles: number;
}

const VehicleSharedRenderer: React.FC<VehicleSharedRendererProps> = ({
  numVehicles,
}) => {
  const bodyMeshRef = useRef<THREE.InstancedMesh>(null);

  // Get actual vehicle count from store
  const actualNumVehicles = useShmSimulatorStore((state) => state.actualNumVehicles);
  const isInitialized = useShmSimulatorStore((state) => state.isInitialized);

  // Use actual vehicle count if available, otherwise use prop
  const renderCount = isInitialized && actualNumVehicles > 0 ? actualNumVehicles : numVehicles;

  // Get vehicle config
  const [config, setConfig] = useState(() => getVehicleConfigSync());

  useEffect(() => {
    waitForConfig().then(loadedConfig => {
      setConfig(loadedConfig);
    });
  }, []);

  const {
    BODY: { LENGTH: bodyLength, WIDTH: bodyWidth, HEIGHT: bodyHeight },
    VEHICLE_COLOR: vehicleColor
  } = config;

  // Create body geometry
  const bodyGeometry = useMemo(() => {
    return new THREE.BoxGeometry(bodyLength, bodyWidth, bodyHeight);
  }, [bodyLength, bodyWidth, bodyHeight]);

  // Create material for body
  const bodyMaterial = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: new THREE.Color(vehicleColor),
    });
  }, [vehicleColor]);

  // Temporary objects for matrix calculations (Zero GC)
  const tempMatrix = useMemo(() => new THREE.Matrix4(), []);
  const tempPosition = useMemo(() => new THREE.Vector3(), []);
  const tempQuaternion = useMemo(() => new THREE.Quaternion(), []);
  const tempScale = useMemo(() => new THREE.Vector3(1, 1, 1), []);

  // Initialize instance matrices
  useEffect(() => {
    const bodyMesh = bodyMeshRef.current;
    if (!bodyMesh) return;

    for (let i = 0; i < renderCount; i++) {
      tempMatrix.identity();
      bodyMesh.setMatrixAt(i, tempMatrix);
    }
    bodyMesh.instanceMatrix.needsUpdate = true;
  }, [renderCount, tempMatrix]);

  // Update instance matrices every frame (Zero GC)
  useFrame(() => {
    const bodyMesh = bodyMeshRef.current;
    if (!bodyMesh) return;

    const data = useShmSimulatorStore.getState().getVehicleData();
    if (!data) return;

    for (let i = 0; i < renderCount; i++) {
      const ptr = i * VEHICLE_DATA_SIZE;

      const x = data[ptr + MovementData.X];
      const y = data[ptr + MovementData.Y];
      const z = data[ptr + MovementData.Z];
      const rotation = data[ptr + MovementData.ROTATION];

      tempPosition.set(x, y, z);

      const rotRad = (rotation * Math.PI) / 180;
      tempQuaternion.setFromAxisAngle(Z_AXIS, rotRad);

      tempMatrix.compose(tempPosition, tempQuaternion, tempScale);
      bodyMesh.setMatrixAt(i, tempMatrix);
    }

    bodyMesh.instanceMatrix.needsUpdate = true;
  });

  if (renderCount <= 0) {
    return null;
  }

  return (
    <>
      <instancedMesh
        ref={bodyMeshRef}
        args={[bodyGeometry, bodyMaterial, renderCount]}
        frustumCulled={false}
      />
      <ShmSensorDebugRenderer numVehicles={renderCount} />
      <ShmVehicleTextRenderer numVehicles={renderCount} />
    </>
  );
};

export default VehicleSharedRenderer;


