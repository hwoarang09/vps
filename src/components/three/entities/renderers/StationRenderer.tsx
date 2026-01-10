import React, { useRef, useEffect, useMemo } from "react";
import * as THREE from "three";
import type { Station } from "@/store/map/stationStore";
import { useFabStore } from "@/store/map/fabStore";
import { getStationTypeConfig, getStationBoxConfig } from "@/config/stationConfig";

// Color mapping by station type
const getStationColor = (type: string): string => {
  const config = getStationTypeConfig(type);
  return config.COLOR;
};

interface StationRendererProps {
  stations: Station[];
}

const StationRenderer: React.FC<StationRendererProps> = ({ stations }) => {
  const slots = useFabStore((state) => state.slots);
  const fabs = useFabStore((state) => state.fabs);

  // Group stations by type for efficient rendering (전체 스테이션 사용)
  const stationsByType = useMemo(() => {
    const grouped: Record<string, typeof stations> = {
      OHB: [],
      STK: [],
      EQ: [],
      OTHER: [],
    };

    for (const station of stations) {
      const type = station.station_type;
      if (type === "OHB" || type === "STK" || type === "EQ") {
        grouped[type].push(station);
      } else {
        grouped.OTHER.push(station);
      }
    }

    return grouped;
  }, [stations]);

  // 단일 fab이거나 슬롯이 없으면 기본 렌더링
  if (fabs.length <= 1 || slots.length === 0) {
    return (
      <group name="stations">
        <StationTypeRenderer
          stations={stationsByType.OHB}
          color={getStationColor("OHB")}
        />
        <StationTypeRenderer
          stations={stationsByType.STK}
          color={getStationColor("STK")}
        />
        <StationTypeRenderer
          stations={stationsByType.EQ}
          color={getStationColor("EQ")}
        />
        <StationTypeRenderer
          stations={stationsByType.OTHER}
          color={getStationColor("OTHER")}
        />
      </group>
    );
  }

  // 멀티 fab: 슬롯 기반 렌더링 (각 슬롯마다 offset 적용)
  return (
    <group name="stations">
      {slots.map((slot) => (
        <group key={slot.slotId} position={[slot.offsetX, slot.offsetY, 0]}>
          <StationTypeRenderer
            stations={stationsByType.OHB}
            color={getStationColor("OHB")}
          />
          <StationTypeRenderer
            stations={stationsByType.STK}
            color={getStationColor("STK")}
          />
          <StationTypeRenderer
            stations={stationsByType.EQ}
            color={getStationColor("EQ")}
          />
          <StationTypeRenderer
            stations={stationsByType.OTHER}
            color={getStationColor("OTHER")}
          />
        </group>
      ))}
    </group>
  );
};

interface StationTypeRendererProps {
  stations: Station[];
  color: string;
}

const StationTypeRenderer: React.FC<StationTypeRendererProps> = ({
  stations,
  color,
}) => {
  const instancedMeshRef = useRef<THREE.InstancedMesh>(null);
  const prevInstanceCountRef = useRef(0);
  const instanceCount = stations.length;

  // Geometry and material from config
  const boxConfig = getStationBoxConfig();
  const geometry = useMemo(
    () => new THREE.BoxGeometry(boxConfig.WIDTH, boxConfig.DEPTH, 0.1),
    []
  );
  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(color),
        metalness: 0.3,
        roughness: 0.7,
      }),
    [color]
  );

  // Initialize instance matrices (원본 데이터만 처리)
  useEffect(() => {
    const mesh = instancedMeshRef.current;
    if (!mesh || instanceCount === 0) return;

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);

    for (let i = 0; i < stations.length; i++) {
      const station = stations[i];

      // Set position
      position.set(
        station.position.x,
        station.position.y,
        station.position.z
      );

      // Set rotation (Z-axis rotation from barcode_r in degrees)
      const rotationRad = THREE.MathUtils.degToRad(station.barcode_r);
      quaternion.setFromEuler(new THREE.Euler(0, 0, rotationRad));

      // Compose matrix
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(i, matrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
  }, [stations, instanceCount]);

  // Cleanup when stations are deleted (instanceCount decreases to 0)
  useEffect(() => {
    if (prevInstanceCountRef.current > instanceCount && instanceCount === 0) {
      console.log("[StationTypeRenderer] Stations deleted, cleaning up resources");
      geometry.dispose();
      material.dispose();
    }
    prevInstanceCountRef.current = instanceCount;
  }, [instanceCount, geometry, material]);

  // Cleanup geometry and material on unmount
  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  if (instanceCount === 0) {
    return null;
  }

  return (
    <instancedMesh
      ref={instancedMeshRef}
      args={[geometry, material, instanceCount]}
      frustumCulled={false}
    />
  );
};

export default StationRenderer;

