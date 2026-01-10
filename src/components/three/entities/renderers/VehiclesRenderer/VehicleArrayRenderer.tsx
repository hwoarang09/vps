import { useRef, useMemo, useEffect, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useVehicleArrayStore } from "@/store/vehicle/arrayMode/vehicleStore";
import { useShmSimulatorStore } from "@/store/vehicle/shmMode/shmSimulatorStore";
import { vehicleDataArray, VEHICLE_DATA_SIZE, MovementData } from "@/store/vehicle/arrayMode/vehicleDataArray";
import { getVehicleConfigSync, waitForConfig } from "@/config/vehicleConfig";
import { SensorDebugRenderer } from "./SensorDebugRenderer";
// import VehicleTextRenderer from "@/components/three/entities/text/instanced/VehicleTextRenderer";
import { VehicleSystemType } from "@/types/vehicle";

const Z_AXIS = new THREE.Vector3(0, 0, 1);

/**
 * VehicleArrayRenderer
 * - Unified renderer for array-single and shared-memory modes
 * - Reads from appropriate data source based on mode
 * - Uses InstancedMesh for performance
 */

interface VehicleArrayRendererProps {
  mode: VehicleSystemType;
}

const VehicleArrayRenderer: React.FC<VehicleArrayRendererProps> = ({
  mode,
}) => {
  const bodyMeshRef = useRef<THREE.InstancedMesh>(null);
  const prevNumVehiclesRef = useRef(0);

  const isSharedMemory = mode === VehicleSystemType.SharedMemory;

  // Get actualNumVehicles from appropriate store based on mode
  const arrayActualNumVehicles = useVehicleArrayStore((state) => state.actualNumVehicles);
  // 멀티 Fab: totalVehicleCount 사용, 단일 Fab: actualNumVehicles 사용
  const shmTotalVehicles = useShmSimulatorStore((state) => state.controller?.getTotalVehicleCount() ?? state.actualNumVehicles);
  const actualNumVehicles = isSharedMemory ? shmTotalVehicles : arrayActualNumVehicles;

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

    for (let i = 0; i < actualNumVehicles; i++) {
      tempMatrix.identity();
      bodyMesh.setMatrixAt(i, tempMatrix);
    }
    bodyMesh.instanceMatrix.needsUpdate = true;
  }, [actualNumVehicles, tempMatrix]);

  // Cleanup when vehicles are deleted (numVehicles decreases to 0)
  useEffect(() => {
    if (prevNumVehiclesRef.current > actualNumVehicles && actualNumVehicles === 0) {
      console.log("[VehicleArrayRenderer] Vehicles deleted, cleaning up resources");
      bodyGeometry.dispose();
      bodyMaterial.dispose();
    }
    prevNumVehiclesRef.current = actualNumVehicles;
  }, [actualNumVehicles, bodyGeometry, bodyMaterial]);

  // Cleanup geometry and material on unmount
  useEffect(() => {
    return () => {
      bodyGeometry.dispose();
      bodyMaterial.dispose();
    };
  }, [bodyGeometry, bodyMaterial]);

  // Update instance matrices every frame (Zero GC)
  useFrame(() => {
    const bodyMesh = bodyMeshRef.current;
    if (!bodyMesh) return;

    const data = isSharedMemory
      ? useShmSimulatorStore.getState().getVehicleData()
      : vehicleDataArray.getData();
    if (!data) return;

    for (let i = 0; i < actualNumVehicles; i++) {
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

  if (actualNumVehicles <= 0) {
    return null;
  }

  return (
    <>
      <instancedMesh
        ref={bodyMeshRef}
        args={[bodyGeometry, bodyMaterial, actualNumVehicles]}
        frustumCulled={false}
      />
      <SensorDebugRenderer numVehicles={actualNumVehicles} mode={mode} />
      {/* <VehicleTextRenderer numVehicles={actualNumVehicles} mode={mode} /> */}
    </>
  );
};

export default VehicleArrayRenderer;
