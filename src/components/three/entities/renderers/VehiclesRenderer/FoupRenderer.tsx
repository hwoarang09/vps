import { useRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useShmSimulatorStore } from "@/store/vehicle/shmMode/shmSimulatorStore";
import { VEHICLE_RENDER_SIZE } from "@/shmSimulator/MemoryLayoutManager";

const DEG_TO_RAD_GLSL = "0.017453292519943295";

const FOUP_SIZE = 0.4;
const FOUP_HEIGHT = 0.15;
const FOUP_COLOR = 0x00cc44;

const TRAY_HEIGHT = 0.05;
const TRAY_GAP = 0.02;

/** FOUP이 없을 때 화면 밖으로 보내는 좌표 */
const HIDE_POS = 99999;

interface FoupRendererProps {
  numVehicles: number;
  bodyHeight: number;
}

export const FoupRenderer: React.FC<FoupRendererProps> = ({
  numVehicles,
  bodyHeight,
}) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const instanceDataRef = useRef<THREE.InstancedBufferAttribute | null>(null);

  // FOUP sits on top of tray
  // trayTopZ = vehicleZ - bodyHeight/2 - gap - trayHeight/2 + trayHeight/2 = vehicleZ - bodyHeight/2 - gap
  // foupZ = trayTopZ + foupHeight/2
  const trayBaseZ = -(bodyHeight / 2) - TRAY_GAP - (TRAY_HEIGHT / 2);
  const foupOffsetZ = trayBaseZ + (TRAY_HEIGHT / 2) + (FOUP_HEIGHT / 2);

  const geometry = useMemo(() => {
    const geo = new THREE.BoxGeometry(FOUP_SIZE, FOUP_SIZE, FOUP_HEIGHT);
    const count = Math.max(numVehicles, 1000);
    const attr = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
    attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("instanceData", attr);
    instanceDataRef.current = attr;
    return geo;
  }, [numVehicles]);

  const material = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(FOUP_COLOR) });
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
      const hasFoup = data[src + 4]; // hasFoup from render buffer
      const trayOffsetZ = data[src + 5];

      if (hasFoup > 0) {
        arr[dst]     = data[src];     // x
        arr[dst + 1] = data[src + 1]; // y
        arr[dst + 2] = data[src + 2] + foupOffsetZ + trayOffsetZ; // z (follows tray)
        arr[dst + 3] = data[src + 3]; // rotation
      } else {
        // 화면 밖으로 숨김
        arr[dst]     = HIDE_POS;
        arr[dst + 1] = HIDE_POS;
        arr[dst + 2] = HIDE_POS;
        arr[dst + 3] = 0;
      }
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
