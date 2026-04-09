import { useRef, useMemo, useEffect, useState, useCallback } from "react";
import { useFrame, ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { useVehicleArrayStore } from "@/store/vehicle/arrayMode/vehicleStore";
import { useShmSimulatorStore } from "@/store/vehicle/shmMode/shmSimulatorStore";
import { vehicleDataArray, VEHICLE_DATA_SIZE, MovementData } from "@/store/vehicle/arrayMode/vehicleDataArray";
import { getVehicleConfigSync, waitForConfig } from "@/config/threejs/vehicleConfig";
import { SensorDebugRenderer } from "./SensorDebugRenderer";
import { VehicleSystemType } from "@/types/vehicle";
import { VEHICLE_RENDER_SIZE } from "@/shmSimulator/MemoryLayoutManager";
import { useVehicleControlStore } from "@/store/ui/vehicleControlStore";
import { useMenuStore } from "@/store/ui/menuStore";
import { useVisualizationStore } from "@/store/ui/visualizationStore";
import {
  VEHICLE_DATA_SIZE as SHM_VEHICLE_DATA_SIZE,
  LogicData as ShmLogicData,
  JobState,
} from "@/common/vehicle/initialize/constants";

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
  const vehicleColor = 0xffffff; // White base — actual color set per-instance via setColorAt

  // instanceData: vec4 (x, y, z, rotation_deg)
  const instanceDataRef = useRef<THREE.InstancedBufferAttribute | null>(null);

  const bodyGeometry = useMemo(() => {
    const geo = new THREE.BoxGeometry(bodyLength, bodyWidth, bodyHeight);
    geo.translate(0, 0, -bodyHeight / 2);

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
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
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

  // Job state → color 매핑 (tempColor 재사용으로 Zero-GC)
  const tempColor = useMemo(() => new THREE.Color(), []);

  const getJobStateColor = (jobState: number, pulse: number): THREE.Color => {
    switch (jobState) {
      case JobState.MOVE_TO_LOAD:
        return tempColor.setRGB(1.0, 0.0, 0.5);                      // 진분홍
      case JobState.LOADING:
        return tempColor.setRGB(1.0, pulse * 0.3, 0.5 + pulse * 0.5); // 분홍 깜빡
      case JobState.MOVE_TO_UNLOAD:
        return tempColor.setRGB(1.0, 0.6, 0.0);                      // 주황
      case JobState.UNLOADING:
        return tempColor.setRGB(1.0, 0.4 + pulse * 0.6, 0.0);        // 주황 깜빡
      case JobState.ERROR:
        return tempColor.setRGB(1.0, 0.0, 0.0);                      // 빨강
      default:
        return tempColor.setRGB(1.0, 1.0, 1.0);                      // 흰색 (IDLE)
    }
  };

  // Update instanced attributes every frame
  // SharedMemory 모드: 레이아웃이 동일하므로 set()으로 한 번에 복사
  useFrame((state) => {
    const instanceDataAttr = instanceDataRef.current;
    if (!instanceDataAttr) return;

    const data = isSharedMemory
      ? useShmSimulatorStore.getState().getVehicleData()
      : vehicleDataArray.getData();
    if (!data) return;

    const dataArr = instanceDataAttr.array as Float32Array;

    if (isSharedMemory) {
      dataArr.set(data.subarray(0, actualNumVehicles * VEHICLE_RENDER_SIZE));

      // JOB_STATE 기반 per-vehicle 색 업데이트
      const bodyMesh = bodyMeshRef.current;
      const fullData = useShmSimulatorStore.getState().getVehicleFullData();
      if (bodyMesh && fullData) {
        const pulse = (Math.sin(state.clock.elapsedTime * 6) + 1) * 0.5; // 0~1 깜빡임
        for (let i = 0; i < actualNumVehicles; i++) {
          const jobState = fullData[i * SHM_VEHICLE_DATA_SIZE + ShmLogicData.JOB_STATE];
          bodyMesh.setColorAt(i, getJobStateColor(jobState, pulse));
        }
        if (bodyMesh.instanceColor) bodyMesh.instanceColor.needsUpdate = true;
      }
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

  // Selection glow outline for selected vehicle (multi-layer fake bloom)
  const selectedVehicleId = useVehicleControlStore((s) => s.selectedVehicleId);
  const showSensorBox = useVisualizationStore((s) => s.showSensorBox);
  const glowGroupRef = useRef<THREE.Group>(null);

  // 15-layer glow: dense layers so individual lines blend seamlessly
  const GLOW_LAYER_COUNT = 15;
  const glowLayers = useMemo(() => {
    const pad = 1.35;
    const box = new THREE.BoxGeometry(bodyLength * pad, bodyWidth * pad, bodyHeight * pad);
    box.translate(0, 0, -bodyHeight / 2);
    const baseGeo = new THREE.EdgesGeometry(box);

    const layers: { geo: THREE.EdgesGeometry; mat: THREE.LineBasicMaterial }[] = [];
    for (let i = 0; i < GLOW_LAYER_COUNT; i++) {
      const t = i / (GLOW_LAYER_COUNT - 1);
      // 낮은 개별 opacity → 겹쳐서 자연스럽게 밝아짐
      const opacity = 0.5 * Math.pow(1 - t, 2);
      const g = Math.round(105 + t * 100);
      const b = Math.round(180 + t * 60);
      const color = (255 << 16) | (g << 8) | b;

      const mat = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: Math.max(opacity, 0.02),
        depthTest: false,
        blending: THREE.AdditiveBlending,
      });
      layers.push({ geo: baseGeo, mat });
    }
    return layers;
  }, [bodyLength, bodyWidth, bodyHeight]);

  const glowChildRefs = useRef<THREE.LineSegments[]>([]);
  const tempVec = useMemo(() => new THREE.Vector3(), []);

  useFrame(({ camera }) => {
    const group = glowGroupRef.current;
    if (!group) return;

    if (selectedVehicleId === null) {
      group.visible = false;
      return;
    }

    const instanceDataAttr = instanceDataRef.current;
    if (!instanceDataAttr) { group.visible = false; return; }

    const arr = instanceDataAttr.array as Float32Array;
    const ptr = selectedVehicleId * 4;
    const x = arr[ptr], y = arr[ptr + 1], z = arr[ptr + 2];
    const rotDeg = arr[ptr + 3];

    if (x === 0 && y === 0 && z === 0) { group.visible = false; return; }

    group.position.set(x, y, z);
    group.rotation.set(0, 0, rotDeg * Math.PI / 180);
    group.visible = true;

    // Distance-adaptive spread (3-tier)
    const dist = camera.position.distanceTo(tempVec.set(x, y, z));
    let spread: number;
    if (dist < 2) {
      // 초근접: 아주 타이트하게
      spread = 0.12;
    } else if (dist < 5) {
      // 근접: 살짝 느슨 (2m→0.12, 5m→0.4 선형 보간)
      spread = THREE.MathUtils.lerp(0.12, 0.4, (dist - 2) / 3);
    } else {
      // 일반~원거리
      spread = THREE.MathUtils.clamp(dist * 0.018, 0.4, 2.5);
    }

    const children = glowChildRefs.current;
    for (let i = 0; i < children.length; i++) {
      const t = i / (GLOW_LAYER_COUNT - 1);
      const s = 1 + spread * t * t; // quadratic: inner layers stay tight
      children[i].scale.set(s, s, s);
    }
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
      <group ref={glowGroupRef} visible={false} renderOrder={999}>
        {glowLayers.map((layer, i) => (
          <lineSegments
            key={layer.mat.uuid}
            ref={(el: THREE.LineSegments) => { if (el) glowChildRefs.current[i] = el; }}
            geometry={layer.geo}
            material={layer.mat}
            frustumCulled={false}
          />
        ))}
      </group>
      {showSensorBox && <SensorDebugRenderer numVehicles={actualNumVehicles} mode={mode} />}
    </>
  );
};

export default VehicleArrayRenderer;
