import { useRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useShmSimulatorStore } from "@/store/vehicle/shmMode/shmSimulatorStore";
import { VEHICLE_RENDER_SIZE } from "@/shmSimulator/MemoryLayoutManager";

const DEG_TO_RAD_GLSL = "0.017453292519943295";

const TRAY_HEIGHT = 0.05;
const TRAY_GAP = 0.02;
const TRAY_COLOR = 0x555555;

interface TrayRendererProps {
  numVehicles: number;
  bodyLength: number;
  bodyWidth: number;
  bodyHeight: number;
}

export const TrayRenderer: React.FC<TrayRendererProps> = ({
  numVehicles,
  bodyLength,
  bodyWidth,
  bodyHeight,
}) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const instanceDataRef = useRef<THREE.InstancedBufferAttribute | null>(null);

  // tray Z offset from vehicle center: below body bottom + gap
  const trayBaseZ = -(bodyHeight / 2) - TRAY_GAP - (TRAY_HEIGHT / 2);

  const geometry = useMemo(() => {
    const geo = new THREE.BoxGeometry(bodyLength * 0.8, bodyWidth * 0.8, TRAY_HEIGHT);
    const count = Math.max(numVehicles, 1000);
    const attr = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
    attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("instanceData", attr);
    instanceDataRef.current = attr;
    return geo;
  }, [bodyLength, bodyWidth, numVehicles]);

  const material = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(TRAY_COLOR) });
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace(
        "#include <common>",
        `#include <common>
        attribute vec4 instanceData;
        mat3 rotateZ(float angle) {
          float s = sin(angle);
          float c = cos(angle);
          return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0);
        }`
      );
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        float rotation = instanceData.w * ${DEG_TO_RAD_GLSL};
        transformed = rotateZ(rotation) * transformed;
        transformed += instanceData.xyz;`
      );
      shader.vertexShader = shader.vertexShader.replace(
        "#include <beginnormal_vertex>",
        `#include <beginnormal_vertex>
        float rotationNormal = instanceData.w * ${DEG_TO_RAD_GLSL};
        objectNormal = rotateZ(rotationNormal) * objectNormal;`
      );
    };
    return mat;
  }, []);

  const identityMatrix = useMemo(() => new THREE.Matrix4(), []);

  useEffect(() => {
    const mesh = meshRef.current;
    const attr = instanceDataRef.current;
    if (!attr) return;

    if (numVehicles > attr.count) {
      const newCount = Math.max(numVehicles, attr.count * 2);
      const newArr = new Float32Array(newCount * 4);
      newArr.set(attr.array as Float32Array);
      const newAttr = new THREE.InstancedBufferAttribute(newArr, 4);
      newAttr.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute("instanceData", newAttr);
      instanceDataRef.current = newAttr;
    }

    if (mesh) {
      for (let i = 0; i < numVehicles; i++) {
        mesh.setMatrixAt(i, identityMatrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  }, [numVehicles, geometry, identityMatrix]);

  useFrame(() => {
    const attr = instanceDataRef.current;
    if (!attr) return;

    const data = useShmSimulatorStore.getState().getVehicleData();
    if (!data) return;

    const arr = attr.array as Float32Array;

    for (let i = 0; i < numVehicles; i++) {
      const src = i * VEHICLE_RENDER_SIZE;
      const dst = i * 4;
      const trayOffsetZ = data[src + 5]; // trayOffsetZ from render buffer
      arr[dst]     = data[src];     // x
      arr[dst + 1] = data[src + 1]; // y
      arr[dst + 2] = data[src + 2] + trayBaseZ + trayOffsetZ; // z
      arr[dst + 3] = data[src + 3]; // rotation
    }

    attr.needsUpdate = true;
  });

  if (numVehicles <= 0) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, numVehicles]}
      frustumCulled={false}
    />
  );
};
