import React, { useRef, useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useStationStore } from "@/store/map/stationStore";
import { getStationTypeConfig, getStationBoxConfig } from "@/config/stationConfig";

// Color mapping by station type
const getStationColor = (type: string): string => {
  const config = getStationTypeConfig(type);
  return config.COLOR;
};

const StationRenderer: React.FC = () => {
  const stations = useStationStore((state) => state.stations);

  // Group stations by type for efficient rendering
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

  return (
    <group name="stations">
      <StationTypeRenderer
        stations={stationsByType.OHB}
        color={getStationColor("OHB")}
        stationType="OHB"
      />
      <StationTypeRenderer
        stations={stationsByType.STK}
        color={getStationColor("STK")}
        stationType="STK"
      />
      <StationTypeRenderer
        stations={stationsByType.EQ}
        color={getStationColor("EQ")}
        stationType="EQ"
      />
      <StationTypeRenderer
        stations={stationsByType.OTHER}
        color={getStationColor("OTHER")}
        stationType="OTHER"
      />
    </group>
  );
};

interface StationTypeRendererProps {
  stations: ReturnType<typeof useStationStore>["stations"];
  color: string;
  stationType: string;
}

const StationTypeRenderer: React.FC<StationTypeRendererProps> = ({
  stations,
  color,
  stationType,
}) => {
  const instancedMeshRef = useRef<THREE.InstancedMesh>(null);
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

  // Initialize instance matrices
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

  // Animation frame (optional - can add pulsing effect later)
  useFrame((state) => {
    // Future: Add subtle animation based on station type
  });

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

