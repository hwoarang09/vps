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

const DEG_TO_RAD = Math.PI / 180;

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
  // 멀티 Fab: fabVehicleCounts 합산 사용 (selector에서 메서드 호출 금지 - re-render 안됨)
  const shmTotalVehicles = useShmSimulatorStore((state) => {
    const total = Object.values(state.fabVehicleCounts).reduce((sum, count) => sum + count, 0);
    return total > 0 ? total : state.actualNumVehicles;
  });
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

  // Refs for instanced attributes
  const positionAttrRef = useRef<THREE.InstancedBufferAttribute | null>(null);
  const rotationAttrRef = useRef<THREE.InstancedBufferAttribute | null>(null);

  // Create body geometry with instanced attributes
  const bodyGeometry = useMemo(() => {
    const geo = new THREE.BoxGeometry(bodyLength, bodyWidth, bodyHeight);

    // Pre-allocate with reasonable initial size, will resize if needed
    const initialCount = Math.max(actualNumVehicles, 1000);

    const positionAttr = new THREE.InstancedBufferAttribute(
      new Float32Array(initialCount * 3), 3
    );
    positionAttr.setUsage(THREE.DynamicDrawUsage);

    const rotationAttr = new THREE.InstancedBufferAttribute(
      new Float32Array(initialCount), 1
    );
    rotationAttr.setUsage(THREE.DynamicDrawUsage);

    geo.setAttribute('instancePosition', positionAttr);
    geo.setAttribute('instanceRotation', rotationAttr);

    positionAttrRef.current = positionAttr;
    rotationAttrRef.current = rotationAttr;

    return geo;
  }, [bodyLength, bodyWidth, bodyHeight, actualNumVehicles]);

  // Create material with custom vertex shader injection
  const bodyMaterial = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(vehicleColor),
    });

    mat.onBeforeCompile = (shader) => {
      // Add instanced attributes
      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `#include <common>
        attribute vec3 instancePosition;
        attribute float instanceRotation;

        mat3 rotateZ(float angle) {
          float s = sin(angle);
          float c = cos(angle);
          return mat3(
            c, s, 0.0,
            -s, c, 0.0,
            0.0, 0.0, 1.0
          );
        }`
      );

      // Replace instance matrix transform with our custom transform
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        transformed = rotateZ(instanceRotation) * transformed;
        transformed += instancePosition;`
      );

      // Also need to transform normals
      shader.vertexShader = shader.vertexShader.replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
        objectNormal = rotateZ(instanceRotation) * objectNormal;`
      );
    };

    return mat;
  }, [vehicleColor]);

  // Identity matrix for nullifying InstancedMesh's default instanceMatrix
  const identityMatrix = useMemo(() => new THREE.Matrix4(), []);

  // Resize instanced attributes and set identity matrices
  useEffect(() => {
    const bodyMesh = bodyMeshRef.current;
    const positionAttr = positionAttrRef.current;
    const rotationAttr = rotationAttrRef.current;
    if (!positionAttr || !rotationAttr) return;

    const currentCount = positionAttr.count;
    if (actualNumVehicles > currentCount) {
      // Need to resize - create new larger arrays
      const newCount = Math.max(actualNumVehicles, currentCount * 2);

      const newPosArray = new Float32Array(newCount * 3);
      newPosArray.set(positionAttr.array as Float32Array);
      const newPosAttr = new THREE.InstancedBufferAttribute(newPosArray, 3);
      newPosAttr.setUsage(THREE.DynamicDrawUsage);

      const newRotArray = new Float32Array(newCount);
      newRotArray.set(rotationAttr.array as Float32Array);
      const newRotAttr = new THREE.InstancedBufferAttribute(newRotArray, 1);
      newRotAttr.setUsage(THREE.DynamicDrawUsage);

      bodyGeometry.setAttribute('instancePosition', newPosAttr);
      bodyGeometry.setAttribute('instanceRotation', newRotAttr);

      positionAttrRef.current = newPosAttr;
      rotationAttrRef.current = newRotAttr;
    }

    // Set all instanceMatrix to identity (nullifies default InstancedMesh transform)
    if (bodyMesh) {
      for (let i = 0; i < actualNumVehicles; i++) {
        bodyMesh.setMatrixAt(i, identityMatrix);
      }
      bodyMesh.instanceMatrix.needsUpdate = true;
    }
  }, [actualNumVehicles, bodyGeometry, identityMatrix]);

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

  // Update instanced attributes every frame (Zero GC, no CPU matrix compute)
  useFrame(() => {
    const positionAttr = positionAttrRef.current;
    const rotationAttr = rotationAttrRef.current;
    if (!positionAttr || !rotationAttr) return;

    const data = isSharedMemory
      ? useShmSimulatorStore.getState().getVehicleData()
      : vehicleDataArray.getData();
    if (!data) return;

    const posArr = positionAttr.array as Float32Array;
    const rotArr = rotationAttr.array as Float32Array;

    for (let i = 0; i < actualNumVehicles; i++) {
      const ptr = i * VEHICLE_DATA_SIZE;
      const i3 = i * 3;

      posArr[i3] = data[ptr + MovementData.X];
      posArr[i3 + 1] = data[ptr + MovementData.Y];
      posArr[i3 + 2] = data[ptr + MovementData.Z];
      rotArr[i] = data[ptr + MovementData.ROTATION] * DEG_TO_RAD;
    }

    positionAttr.needsUpdate = true;
    rotationAttr.needsUpdate = true;
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
