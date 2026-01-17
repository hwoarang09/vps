import { useRef, useMemo, useEffect, useState, useCallback } from "react";
import { useFrame, ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { useVehicleArrayStore } from "@/store/vehicle/arrayMode/vehicleStore";
import { useShmSimulatorStore } from "@/store/vehicle/shmMode/shmSimulatorStore";
import { vehicleDataArray, VEHICLE_DATA_SIZE, MovementData } from "@/store/vehicle/arrayMode/vehicleDataArray";
import { getVehicleConfigSync, waitForConfig } from "@/config/vehicleConfig";
import { SensorDebugRenderer } from "./SensorDebugRenderer";
import { VehicleSystemType } from "@/types/vehicle";
import { VEHICLE_RENDER_SIZE } from "@/shmSimulator/MemoryLayoutManager";
import { useVehicleControlStore } from "@/store/ui/vehicleControlStore";
import { useMenuStore } from "@/store/ui/menuStore";

// GLSL에서 사용할 DEG_TO_RAD 상수 (Math.PI / 180)
const DEG_TO_RAD_GLSL = "0.017453292519943295";

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
  const shmTotalVehicles = useShmSimulatorStore((state) => state.actualNumVehicles);
  const actualNumVehicles = isSharedMemory ? shmTotalVehicles : arrayActualNumVehicles;

  const [config, setConfig] = useState(() => getVehicleConfigSync());

  useEffect(() => {
    waitForConfig().then(loadedConfig => {
      setConfig(loadedConfig);
    });
  }, []);

  const bodyLength = config.body?.length ?? 1.2;
  const bodyWidth = config.body?.width ?? 0.6;
  const bodyHeight = config.body?.height ?? 0.3;
  const vehicleColor = 0x00ff00; // Green color

  // instanceData: vec4 (x, y, z, rotation_deg)
  const instanceDataRef = useRef<THREE.InstancedBufferAttribute | null>(null);

  const bodyGeometry = useMemo(() => {
    const geo = new THREE.BoxGeometry(bodyLength, bodyWidth, bodyHeight);

    const initialCount = Math.max(actualNumVehicles, 1000);

    // vec4: x, y, z, rotation_deg (SharedMemory 레이아웃과 동일)
    const instanceDataAttr = new THREE.InstancedBufferAttribute(
      new Float32Array(initialCount * 4), 4
    );
    instanceDataAttr.setUsage(THREE.DynamicDrawUsage);

    geo.setAttribute('instanceData', instanceDataAttr);
    instanceDataRef.current = instanceDataAttr;

    return geo;
  }, [bodyLength, bodyWidth, bodyHeight, actualNumVehicles]);

  const bodyMaterial = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(vehicleColor),
    });

    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `#include <common>
        attribute vec4 instanceData; // x, y, z, rotation_deg

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

      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float rotation = instanceData.w * ${DEG_TO_RAD_GLSL};
        transformed = rotateZ(rotation) * transformed;
        transformed += instanceData.xyz;`
      );

      shader.vertexShader = shader.vertexShader.replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
        float rotationNormal = instanceData.w * ${DEG_TO_RAD_GLSL};
        objectNormal = rotateZ(rotationNormal) * objectNormal;`
      );
    };

    return mat;
  }, [vehicleColor]);

  const identityMatrix = useMemo(() => new THREE.Matrix4(), []);

  useEffect(() => {
    const bodyMesh = bodyMeshRef.current;
    const instanceDataAttr = instanceDataRef.current;
    if (!instanceDataAttr) return;

    const currentCount = instanceDataAttr.count;
    if (actualNumVehicles > currentCount) {
      const newCount = Math.max(actualNumVehicles, currentCount * 2);

      const newDataArray = new Float32Array(newCount * 4);
      newDataArray.set(instanceDataAttr.array as Float32Array);
      const newDataAttr = new THREE.InstancedBufferAttribute(newDataArray, 4);
      newDataAttr.setUsage(THREE.DynamicDrawUsage);

      bodyGeometry.setAttribute('instanceData', newDataAttr);
      instanceDataRef.current = newDataAttr;
    }

    if (bodyMesh) {
      for (let i = 0; i < actualNumVehicles; i++) {
        bodyMesh.setMatrixAt(i, identityMatrix);
      }
      bodyMesh.instanceMatrix.needsUpdate = true;
    }
  }, [actualNumVehicles, bodyGeometry, identityMatrix]);

  useEffect(() => {
    if (prevNumVehiclesRef.current > actualNumVehicles && actualNumVehicles === 0) {
      bodyGeometry.dispose();
      bodyMaterial.dispose();
    }
    prevNumVehiclesRef.current = actualNumVehicles;
  }, [actualNumVehicles, bodyGeometry, bodyMaterial]);

  useEffect(() => {
    return () => {
      bodyGeometry.dispose();
      bodyMaterial.dispose();
    };
  }, [bodyGeometry, bodyMaterial]);

  // Update instanced attributes every frame
  // SharedMemory 모드: 레이아웃이 동일하므로 set()으로 한 번에 복사
  useFrame(() => {
    const instanceDataAttr = instanceDataRef.current;
    if (!instanceDataAttr) return;

    const data = isSharedMemory
      ? useShmSimulatorStore.getState().getVehicleData()
      : vehicleDataArray.getData();
    if (!data) return;

    const dataArr = instanceDataAttr.array as Float32Array;

    if (isSharedMemory) {
      // SharedMemory 모드: 레이아웃이 동일 (4 floats per vehicle)
      // for 루프 없이 한 번에 복사
      dataArr.set(data.subarray(0, actualNumVehicles * VEHICLE_RENDER_SIZE));
    } else {
      // Array 모드: 22 floats per vehicle → 4 floats per vehicle 변환 필요
      for (let i = 0; i < actualNumVehicles; i++) {
        const srcPtr = i * VEHICLE_DATA_SIZE;
        const dstPtr = i * 4;

        dataArr[dstPtr] = data[srcPtr + MovementData.X];
        dataArr[dstPtr + 1] = data[srcPtr + MovementData.Y];
        dataArr[dstPtr + 2] = data[srcPtr + MovementData.Z];
        dataArr[dstPtr + 3] = data[srcPtr + MovementData.ROTATION]; // deg (셰이더에서 변환)
      }
    }

    instanceDataAttr.needsUpdate = true;
  });

  // Vehicle click handler - opens IndividualControlPanel
  const handleVehicleClick = useCallback((e: ThreeEvent<PointerEvent>) => {
    // instanceId is the index of the clicked instance
    const instanceId = e.instanceId;
    if (instanceId === undefined) return;

    // Stop propagation to prevent camera controls from interfering
    e.stopPropagation();

    // Select vehicle and open panel
    useVehicleControlStore.getState().selectVehicle(instanceId);
    useMenuStore.getState().setRightPanelOpen(true);
  }, []);

  if (actualNumVehicles <= 0) {
    return null;
  }

  return (
    <>
      <instancedMesh
        ref={bodyMeshRef}
        args={[bodyGeometry, bodyMaterial, actualNumVehicles]}
        frustumCulled={false}
        onPointerDown={handleVehicleClick}
      />
      <SensorDebugRenderer numVehicles={actualNumVehicles} mode={mode} />
    </>
  );
};

export default VehicleArrayRenderer;
