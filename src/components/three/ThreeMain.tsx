import React from "react";
import { Canvas } from "@react-three/fiber";
import {
  OrbitControls,
} from "@react-three/drei";
import { Perf } from "r3f-perf";
import * as THREE from "three";

import MapRenderer from "./entities/renderers/MapRenderer";
import Floor from "./scene/Floor";
import AxisHelper from "./scene/AxisHelper";
// import TextRenderer from "./entities/renderers/TextRenderer";
import VehicleSystem from "./entities/vehicle/VehicleSystem";

import CameraController from "./scene/Camera/cameraController";
import { useVehicleTestStore } from "@store/vehicle/vehicleTestStore";
import { PerformanceMonitorUI } from "./performance/PerformanceMonitor";

const ThreeScene: React.FC = () => {

  return (
    <>
      <Canvas
        className="absolute inset-0"
        scene={{ background: new THREE.Color("#1a1a1a") }}
        camera={{ up: [0, 0, 1], position: [-10, 10, 50] }}
      >
        <OrbitControls 
           makeDefault 
           enablePan 
           enableZoom 
           enableRotate 
           zoomSpeed={3}
           screenSpacePanning={false} // Pan on XY plane (ground) instead of screen space
           enableDamping={true}       // Smooth motion
           dampingFactor={0.1}
           maxPolarAngle={Math.PI / 2 - 0.05} // Limit rotation to above ground
           minDistance={1}            // Prevent going too close
           maxDistance={2000}         // Limit far zoom
         />
        <CameraController />

        {/* Basic lighting for factory environment */}
        <ambientLight intensity={0.4} />
        <directionalLight
          position={[50, 50, 500]}
          intensity={0.8}
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
        />

        {/* Factory floor */}
        <Floor />

        {/* Coordinate axes for orientation */}
        <AxisHelper />

        {/* Map rendering - displays the actual 3D objects */}
        <MapRenderer />

        {/* Text rendering - displays node and edge labels */}
        {/* <TextRenderer scale={0.2} nodeColor="#00e5ff" edgeColor="#ff9800" /> */}

        {/* Vehicle System - Conditionally rendered when test is active */}
        <VehicleSystemRenderer />

        {/* Development tools */}
        <Perf position="bottom-right"  deepAnalyze={true}  />
      </Canvas>

      {/* Performance Monitor - 5-second average CPU usage */}
      <PerformanceMonitorUI />
    </>
  );
};

/**
 * VehicleSystemRenderer
 * - Conditionally renders VehicleSystem based on test state
 */
const VehicleSystemRenderer: React.FC = () => {
  const { isTestActive, testMode, numVehicles } = useVehicleTestStore();

  if (!isTestActive || !testMode) {
    return null;
  }

  return (
    <VehicleSystem
      mode={testMode}
      numVehicles={numVehicles}
    />
  );
};

export default ThreeScene;
