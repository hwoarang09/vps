// SensorDebugRenderer.tsx - Wireframe visualization of vehicle sensors

import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { sensorPointArray, SensorPoint, SENSOR_DATA_SIZE, SENSOR_POINT_SIZE } from "@/store/vehicle/arrayMode/sensorPointArray";
import { getShmSensorPointData } from "@/store/vehicle/shmMode/shmSimulatorStore";
import { getMarkerConfig } from "@/config/mapConfig";
import { VehicleSystemType } from "@/types/vehicle";

interface SensorDebugRendererProps {
  readonly numVehicles: number;
  readonly mode: VehicleSystemType;
}

/**
 * Render sensor wireframes for debugging
 * Shows 3-zone sensor quads (outer/approach, middle/brake, inner/stop) and body quad
 */
export function SensorDebugRenderer({ numVehicles, mode }: SensorDebugRendererProps) {
  const outerLinesRef = useRef<THREE.LineSegments>(null);
  const middleLinesRef = useRef<THREE.LineSegments>(null);
  const innerLinesRef = useRef<THREE.LineSegments>(null);
  const bodyLinesRef = useRef<THREE.LineSegments>(null);

  const isSharedMemory = mode === VehicleSystemType.SharedMemory;

  // Create geometry for sensor quads (4 lines per vehicle)
  const outerGeometry = useMemo(() => {
    const positions = new Float32Array(numVehicles * 4 * 2 * 3); // 4 lines, 2 points each, xyz
    return new THREE.BufferGeometry().setAttribute(
      "position",
      new THREE.BufferAttribute(positions, 3)
    );
  }, [numVehicles]);

  const middleGeometry = useMemo(() => {
    const positions = new Float32Array(numVehicles * 4 * 2 * 3);
    return new THREE.BufferGeometry().setAttribute(
      "position",
      new THREE.BufferAttribute(positions, 3)
    );
  }, [numVehicles]);

  const innerGeometry = useMemo(() => {
    const positions = new Float32Array(numVehicles * 4 * 2 * 3);
    return new THREE.BufferGeometry().setAttribute(
      "position",
      new THREE.BufferAttribute(positions, 3)
    );
  }, [numVehicles]);

  // Create geometry for body quads (4 lines per vehicle)
  const bodyGeometry = useMemo(() => {
    const positions = new Float32Array(numVehicles * 4 * 2 * 3);
    return new THREE.BufferGeometry().setAttribute(
      "position",
      new THREE.BufferAttribute(positions, 3)
    );
  }, [numVehicles]);

  // Update wireframes every frame
  useFrame(() => {
    const outerLines = outerLinesRef.current;
    const middleLines = middleLinesRef.current;
    const innerLines = innerLinesRef.current;
    const bodyLines = bodyLinesRef.current;
    if (!outerLines || !middleLines || !innerLines || !bodyLines) return;

    const data = isSharedMemory ? getShmSensorPointData() : sensorPointArray.getData();
    if (!data) return;

    const outerPositions = outerGeometry.attributes.position.array as Float32Array;
    const middlePositions = middleGeometry.attributes.position.array as Float32Array;
    const innerPositions = innerGeometry.attributes.position.array as Float32Array;
    const bodyPositions = bodyGeometry.attributes.position.array as Float32Array;

    const zHeight = getMarkerConfig().Z;

    for (let i = 0; i < numVehicles; i++) {
      const base = i * SENSOR_DATA_SIZE;
      const sensorIdx = i * 4 * 2 * 3; // 4 lines, 2 points, xyz
      const bodyIdx = i * 4 * 2 * 3;

      const writeZone = (zoneIndex: number, target: Float32Array) => {
        const offset = base + zoneIndex * SENSOR_POINT_SIZE;
        const flx = data[offset + SensorPoint.FL_X];
        const fly = data[offset + SensorPoint.FL_Y];
        const frx = data[offset + SensorPoint.FR_X];
        const fry = data[offset + SensorPoint.FR_Y];
        const slx = data[offset + SensorPoint.SL_X];
        const sly = data[offset + SensorPoint.SL_Y];
        const srx = data[offset + SensorPoint.SR_X];
        const sry = data[offset + SensorPoint.SR_Y];

        // Sensor quad: FL -> SL -> SR -> FR -> FL
        target[sensorIdx + 0] = flx;
        target[sensorIdx + 1] = fly;
        target[sensorIdx + 2] = zHeight;
        target[sensorIdx + 3] = slx;
        target[sensorIdx + 4] = sly;
        target[sensorIdx + 5] = zHeight;

        target[sensorIdx + 6] = slx;
        target[sensorIdx + 7] = sly;
        target[sensorIdx + 8] = zHeight;
        target[sensorIdx + 9] = srx;
        target[sensorIdx + 10] = sry;
        target[sensorIdx + 11] = zHeight;

        target[sensorIdx + 12] = srx;
        target[sensorIdx + 13] = sry;
        target[sensorIdx + 14] = zHeight;
        target[sensorIdx + 15] = frx;
        target[sensorIdx + 16] = fry;
        target[sensorIdx + 17] = zHeight;

        target[sensorIdx + 18] = frx;
        target[sensorIdx + 19] = fry;
        target[sensorIdx + 20] = zHeight;
        target[sensorIdx + 21] = flx;
        target[sensorIdx + 22] = fly;
        target[sensorIdx + 23] = zHeight;
      };

      // Zones: 0=outer(approach),1=middle(brake),2=inner(stop)
      writeZone(0, outerPositions);
      writeZone(1, middlePositions);
      writeZone(2, innerPositions);

      // Body quad from outer zone (index 0)
      const bodyOffset = base + 0 * SENSOR_POINT_SIZE;
      const flx = data[bodyOffset + SensorPoint.FL_X];
      const fly = data[bodyOffset + SensorPoint.FL_Y];
      const frx = data[bodyOffset + SensorPoint.FR_X];
      const fry = data[bodyOffset + SensorPoint.FR_Y];
      const blx = data[bodyOffset + SensorPoint.BL_X];
      const bly = data[bodyOffset + SensorPoint.BL_Y];
      const brx = data[bodyOffset + SensorPoint.BR_X];
      const bry = data[bodyOffset + SensorPoint.BR_Y];

      // Body quad: FL -> BL -> BR -> FR -> FL
      // Line 1: FL -> BL
      bodyPositions[bodyIdx + 0] = flx;
      bodyPositions[bodyIdx + 1] = fly;
      bodyPositions[bodyIdx + 2] = zHeight;
      bodyPositions[bodyIdx + 3] = blx;
      bodyPositions[bodyIdx + 4] = bly;
      bodyPositions[bodyIdx + 5] = zHeight;

      // Line 2: BL -> BR
      bodyPositions[bodyIdx + 6] = blx;
      bodyPositions[bodyIdx + 7] = bly;
      bodyPositions[bodyIdx + 8] = zHeight;
      bodyPositions[bodyIdx + 9] = brx;
      bodyPositions[bodyIdx + 10] = bry;
      bodyPositions[bodyIdx + 11] = zHeight;

      // Line 3: BR -> FR
      bodyPositions[bodyIdx + 12] = brx;
      bodyPositions[bodyIdx + 13] = bry;
      bodyPositions[bodyIdx + 14] = zHeight;
      bodyPositions[bodyIdx + 15] = frx;
      bodyPositions[bodyIdx + 16] = fry;
      bodyPositions[bodyIdx + 17] = zHeight;

      // Line 4: FR -> FL
      bodyPositions[bodyIdx + 18] = frx;
      bodyPositions[bodyIdx + 19] = fry;
      bodyPositions[bodyIdx + 20] = zHeight;
      bodyPositions[bodyIdx + 21] = flx;
      bodyPositions[bodyIdx + 22] = fly;
      bodyPositions[bodyIdx + 23] = zHeight;
    }

    outerGeometry.attributes.position.needsUpdate = true;
    middleGeometry.attributes.position.needsUpdate = true;
    innerGeometry.attributes.position.needsUpdate = true;
    bodyGeometry.attributes.position.needsUpdate = true;
  });

  return (
    <group renderOrder={999}>
      {/* Sensor wireframes */}
      <lineSegments ref={outerLinesRef} geometry={outerGeometry} frustumCulled={false} renderOrder={999}>
        <lineBasicMaterial color={"#ffff00"} linewidth={4} depthTest={false} transparent depthWrite={false} />
      </lineSegments>
      <lineSegments ref={middleLinesRef} geometry={middleGeometry} frustumCulled={false} renderOrder={999}>
        <lineBasicMaterial color="#ff8800" linewidth={2} depthTest={false} transparent depthWrite={false} />
      </lineSegments>
      <lineSegments ref={innerLinesRef} geometry={innerGeometry} frustumCulled={false} renderOrder={999}>
        <lineBasicMaterial color="#ff0000" linewidth={6} depthTest={false} transparent depthWrite={false} />
      </lineSegments>

      {/* Body wireframes (cyan) */}
      <lineSegments ref={bodyLinesRef} geometry={bodyGeometry} frustumCulled={false} renderOrder={999}>
        <lineBasicMaterial color="#00ffff" linewidth={1} depthTest={false} transparent depthWrite={false} />
      </lineSegments>
    </group>
  );
}
