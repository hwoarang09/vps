import React from "react";
import { Canvas } from "@react-three/fiber";
import {
  OrbitControls,
  Environment,
} from "@react-three/drei";
import { Perf } from "r3f-perf";

import MapRenderer from "./entities/renderers/MapRenderer";
import Floor from "./scene/Floor";
import AxisHelper from "./scene/AxisHelper";
import TextRenderer from "./entities/renderers/TextRenderer";
import FabLabelRenderer from "./entities/renderers/FabLabelRenderer";
import VehicleSystem from "./entities/vehicle/VehicleSystem";

import CameraController from "./scene/Camera/cameraController";
import { useVehicleTestStore } from "@store/vehicle/vehicleTestStore";
import { PerformanceMonitorUI } from "./performance/PerformanceMonitor";
import { useVisualizationStore } from "@store/ui/visualizationStore";
import { useThemeStore } from "@store/ui/themeStore";

const ThemedSceneContent: React.FC = () => {
  const theme = useThemeStore((s) => s.theme);

  return (
    <>
      <color attach="background" args={[theme.background]} />

      {theme.envPreset && <Environment preset={theme.envPreset} />}

      <ambientLight intensity={theme.ambientIntensity} />
      <directionalLight
        position={[50, 50, 500]}
        intensity={theme.directionalIntensity}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />
      {theme.fillIntensity > 0 && (
        <directionalLight position={[-80, -40, 200]} intensity={theme.fillIntensity} />
      )}

      <Floor />
      <AxisHelper />
      <MapRenderer />
      <TextRenderer />
      <FabLabelRenderer />
      <VehicleSystemRenderer />
    </>
  );
};

const ThreeScene: React.FC = () => {
  const showPerfLeft = useVisualizationStore((s) => s.showPerfLeft);
  const showPerfRight = useVisualizationStore((s) => s.showPerfRight);

  return (
    <>
      <Canvas
        className="absolute inset-0"
        camera={{ up: [0, 0, 1], position: [-10, 10, 50] }}
      >
        <OrbitControls
          makeDefault
          enablePan
          enableZoom
          enableRotate
          zoomSpeed={3}
          screenSpacePanning={false}
          enableDamping={true}
          dampingFactor={0.1}
          maxPolarAngle={Math.PI / 2 - 0.05}
          minDistance={1}
          maxDistance={2000}
        />
        <CameraController />

        <ThemedSceneContent />

        {showPerfRight && <Perf position="bottom-left" deepAnalyze={true} style={{ bottom: "280px", left: "16px" }} />}
      </Canvas>

      {showPerfLeft && <PerformanceMonitorUI />}
    </>
  );
};

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
