import React, { useRef, useMemo, useEffect, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { getVehicleConfigSync, waitForConfig } from "@/config/threejs/vehicleConfig";
import { useThemeStore } from "@/store/ui/themeStore";

// 자식이 구현해야 할 데이터 주입 함수 타입
export type UpdateTransformFn = (
  index: number,
  position: THREE.Vector3,
  quaternion: THREE.Quaternion
) => boolean; // 데이터가 유효하면 true, 아니면 false 반환

interface BaseProps {
  numVehicles: number;
  showSensor: boolean;
  rendererName: string; // 로그용 (예: 'Rapier', 'Shared')
  onUpdate: UpdateTransformFn; // 매 프레임 호출될 콜백
}

export const BaseVehicleRenderer: React.FC<BaseProps> = ({
  numVehicles,
  showSensor,
  rendererName,
  onUpdate,
}) => {
  const bodyMeshRef = useRef<THREE.InstancedMesh>(null);
  const sensorMeshRef = useRef<THREE.InstancedMesh>(null);
  const prevNumVehiclesRef = useRef(0);

  // Config 로드 (공통) - useState로 관리하여 로딩 완료 시 리렌더링
  const [config, setConfig] = useState(() => getVehicleConfigSync());

  // Wait for config to load from JSON
  useEffect(() => {
    waitForConfig().then(loadedConfig => {
      setConfig(loadedConfig);
    });
  }, [rendererName]);

  const bodyLength = config.body.length;
  const bodyWidth = config.body.width;
  const bodyHeight = config.body.height;
  // Sensor dimensions are based on body dimensions
  const sensorLength = bodyLength + config.spacing.vehicleSpacing;
  const sensorWidth = bodyWidth;
  const sensorHeight = bodyHeight;

  const themeVehicleColor = useThemeStore((s) => s.theme.vehicleColor);
  const themeMetalness = useThemeStore((s) => s.theme.vehicleMetalness);
  const themeRoughness = useThemeStore((s) => s.theme.vehicleRoughness);
  const themeBracket = useThemeStore((s) => s.theme.vehicleBracket);
  const vehicleColor = themeVehicleColor;

  // Body geometry: solid box (default theme) or ㄷ-bracket (white theme).
  const bodyGeometry = useMemo(() => {
    if (!themeBracket) {
      const geo = new THREE.BoxGeometry(bodyLength, bodyWidth, bodyHeight);
      geo.translate(0, 0, -bodyHeight / 2);
      return geo;
    }

    const topThickness = bodyHeight * 0.35;
    const legHeight = bodyHeight - topThickness;
    const legLength = bodyLength * 0.18;
    const legCenterX = bodyLength * 0.5 - legLength * 0.5;
    const legCenterZ = -topThickness - legHeight * 0.5;

    const top = new THREE.BoxGeometry(bodyLength, bodyWidth, topThickness);
    top.translate(0, 0, -topThickness * 0.5);

    const front = new THREE.BoxGeometry(legLength, bodyWidth, legHeight);
    front.translate(legCenterX, 0, legCenterZ);

    const back = new THREE.BoxGeometry(legLength, bodyWidth, legHeight);
    back.translate(-legCenterX, 0, legCenterZ);

    const merged = mergeGeometries([top, front, back]);
    top.dispose();
    front.dispose();
    back.dispose();
    return merged;
  }, [bodyLength, bodyWidth, bodyHeight, themeBracket]);
  const sensorGeometry = useMemo(() => new THREE.BoxGeometry(sensorLength, sensorWidth, sensorHeight), [sensorLength, sensorWidth, sensorHeight]);

  // Created ONCE — theme-driven props updated in-place to avoid mesh recreation.
  const bodyMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    color: new THREE.Color(vehicleColor),
    metalness: themeMetalness,
    roughness: themeRoughness,
    // Stronger polygonOffset than curves (-1,-1) → vehicle wins depth test
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  useEffect(() => {
    bodyMaterial.color.set(vehicleColor);
    bodyMaterial.metalness = themeMetalness;
    bodyMaterial.roughness = themeRoughness;
  }, [vehicleColor, themeMetalness, themeRoughness, bodyMaterial]);
  const sensorMaterial = useMemo(() => new THREE.MeshBasicMaterial({ color: 0x00ff00, wireframe: true, transparent: true, opacity: 0.8 }), []);

  // Temp Objects (Zero-GC: 재사용)
  const tempMatrix = useMemo(() => new THREE.Matrix4(), []);
  const tempPosition = useMemo(() => new THREE.Vector3(), []);
  const tempQuaternion = useMemo(() => new THREE.Quaternion(), []);
  // tempScale: visual LOD scale for body. tempSensorScale: fixed (1,1,1) for sensor.
  const tempScale = useMemo(() => new THREE.Vector3(1, 1, 1), []);
  const tempSensorScale = useMemo(() => new THREE.Vector3(1, 1, 1), []);
  const tempSensorPos = useMemo(() => new THREE.Vector3(), []);
  const tempInitMatrix = useMemo(() => new THREE.Matrix4().identity(), []);

  const sensorOffsetX = (bodyLength + sensorLength) * 0.5 + 0.05;

  // Cleanup when vehicles are deleted (numVehicles decreases to 0)
  useEffect(() => {
    if (prevNumVehiclesRef.current > numVehicles && numVehicles === 0) {
      bodyGeometry.dispose();
      sensorGeometry.dispose();
      bodyMaterial.dispose();
      sensorMaterial.dispose();
    }
    prevNumVehiclesRef.current = numVehicles;
  }, [numVehicles, bodyGeometry, sensorGeometry, bodyMaterial, sensorMaterial, rendererName]);

  // Cleanup geometries and materials on unmount
  useEffect(() => {
    return () => {
      bodyGeometry.dispose();
      sensorGeometry.dispose();
      bodyMaterial.dispose();
      sensorMaterial.dispose();
    };
  }, [bodyGeometry, sensorGeometry, bodyMaterial, sensorMaterial]);

  // 초기화 로직 (Zero-GC: tempInitMatrix 재사용)
  useEffect(() => {
    if (!bodyMeshRef.current) return;

    for (let i = 0; i < numVehicles; i++) {
      bodyMeshRef.current.setMatrixAt(i, tempInitMatrix);
      if (showSensor && sensorMeshRef.current) {
        sensorMeshRef.current.setMatrixAt(i, tempInitMatrix);
      }
    }
    bodyMeshRef.current.instanceMatrix.needsUpdate = true;
    if (showSensor && sensorMeshRef.current) sensorMeshRef.current.instanceMatrix.needsUpdate = true;

  }, [numVehicles, showSensor, rendererName, tempInitMatrix]);

  // 렌더링 루프 (핵심)
  useFrame((state) => {
    const bodyMesh = bodyMeshRef.current;
    if (!bodyMesh || numVehicles === 0) return;

    // Visual-only LOD scale for body (sensor stays 1:1)
    const camZ = state.camera.position.z;
    const lod = Math.max(1, Math.min(3.5, 1 + (camZ - 50) / 200));
    tempScale.set(lod, lod, lod);

    const sensorMesh = showSensor ? sensorMeshRef.current : null;
    let updateCount = 0;

    for (let i = 0; i < numVehicles; i++) {
      // 1. 자식에게서 위치/회전값 받아오기 (Call by Reference로 성능 최적화)
      const isValid = onUpdate(i, tempPosition, tempQuaternion);

      if (isValid) {
        // 2. Body Matrix (with LOD scale)
        tempMatrix.compose(tempPosition, tempQuaternion, tempScale);
        bodyMesh.setMatrixAt(i, tempMatrix);

        // 3. Sensor Matrix (use fixed scale — sensor unaffected by LOD)
        if (sensorMesh) {
          tempSensorPos.set(sensorOffsetX, 0, 0)
            .applyQuaternion(tempQuaternion)
            .add(tempPosition);
          tempMatrix.compose(tempSensorPos, tempQuaternion, tempSensorScale);
          sensorMesh.setMatrixAt(i, tempMatrix);
        }
        updateCount++;
      }
    }

    bodyMesh.instanceMatrix.needsUpdate = true;
    if (sensorMesh) sensorMesh.instanceMatrix.needsUpdate = true;

    // Logging (60프레임마다)
    if (Math.floor(state.clock.elapsedTime * 60) % 60 === 0) {
      // Log logic removed
    }
  });

  if (numVehicles <= 0) return null;

  return (
    <>
      <instancedMesh
        ref={bodyMeshRef}
        args={[bodyGeometry, bodyMaterial, numVehicles]}
        frustumCulled={false}
        renderOrder={10}
      />
      {showSensor && (
        <instancedMesh
          ref={sensorMeshRef}
          args={[sensorGeometry, sensorMaterial, numVehicles]}
          frustumCulled={false}
        />
      )}
    </>
  );
};
