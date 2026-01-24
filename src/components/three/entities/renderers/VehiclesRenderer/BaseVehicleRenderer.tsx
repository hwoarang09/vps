import React, { useRef, useMemo, useEffect, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { getVehicleConfigSync, waitForConfig } from "@/config/vehicleConfig";

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
  // Default vehicle color
  const vehicleColor = "#1a85ff";

  // Geometry & Material (공통 - 메모이제이션)
  const bodyGeometry = useMemo(() => new THREE.BoxGeometry(bodyLength, bodyWidth, bodyHeight), [bodyLength, bodyWidth, bodyHeight]);
  const sensorGeometry = useMemo(() => new THREE.BoxGeometry(sensorLength, sensorWidth, sensorHeight), [sensorLength, sensorWidth, sensorHeight]);
  
  const bodyMaterial = useMemo(() => new THREE.MeshStandardMaterial({ color: new THREE.Color(vehicleColor) }), [vehicleColor]);
  const sensorMaterial = useMemo(() => new THREE.MeshBasicMaterial({ color: 0x00ff00, wireframe: true, transparent: true, opacity: 0.8 }), []);

  // Temp Objects (Zero-GC: 재사용)
  const tempMatrix = useMemo(() => new THREE.Matrix4(), []);
  const tempPosition = useMemo(() => new THREE.Vector3(), []);
  const tempQuaternion = useMemo(() => new THREE.Quaternion(), []);
  const tempScale = useMemo(() => new THREE.Vector3(1, 1, 1), []);
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

    const sensorMesh = showSensor ? sensorMeshRef.current : null;
    let updateCount = 0;

    for (let i = 0; i < numVehicles; i++) {
      // 1. 자식에게서 위치/회전값 받아오기 (Call by Reference로 성능 최적화)
      const isValid = onUpdate(i, tempPosition, tempQuaternion);
      
      if (isValid) {
        // 2. Body Matrix
        tempMatrix.compose(tempPosition, tempQuaternion, tempScale);
        bodyMesh.setMatrixAt(i, tempMatrix);

        // 3. Sensor Matrix (옵션) - Zero-GC: tempSensorPos 재사용
        if (sensorMesh) {
          tempSensorPos.set(sensorOffsetX, 0, 0)
            .applyQuaternion(tempQuaternion)
            .add(tempPosition);
          tempMatrix.compose(tempSensorPos, tempQuaternion, tempScale);
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
