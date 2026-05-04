import React from "react";
import { getMapRenderConfig, getVehicleRenderConfig } from "@/config/threejs/renderConfig";
import { VehicleSystemType } from "@/types/vehicle";
import { useVehicleTestStore } from "@store/vehicle/vehicleTestStore";
import { useShmSimulatorStore } from "@store/vehicle/shmMode/shmSimulatorStore";
import { useThemeStore } from "@store/ui/themeStore";
import MapTextRenderer from "../text/instanced/MapTextRenderer";
import VehicleTextRenderer from "../text/instanced/VehicleTextRenderer";

interface Props {
  scale?: number;
  nodeColor?: string;
  edgeColor?: string;
  vehicleColor?: string;
}

const TextRenderer: React.FC<Props> = (props) => {
  const mapConfig = getMapRenderConfig();
  const vehicleConfig = getVehicleRenderConfig();
  const themeNode = useThemeStore((s) => s.theme.textNode);
  const themeEdge = useThemeStore((s) => s.theme.textEdge);
  const themeStation = useThemeStore((s) => s.theme.textStation);
  const themeVehicleTextColor = useThemeStore((s) => s.theme.textVehicleColor);

  const {
    scale = mapConfig.scale,
    nodeColor = themeNode,
    edgeColor = themeEdge,
    vehicleColor = themeVehicleTextColor,
  } = props;

  // testMode from vehicleTestStore (actual running mode)
  const { testMode, isTestActive } = useVehicleTestStore();
  // actualNumVehicles from shmSimulatorStore (real initialized count)
  const shmActualNumVehicles = useShmSimulatorStore((state) => state.actualNumVehicles);
  // fab 경계 — 라벨을 fab-local 인덱스로 reset해서 snapshot.bin과 매칭
  const shmController = useShmSimulatorStore((state) => state.controller);
  const fabAssignments = shmController?.getFabRenderAssignments();

  const isSharedMemoryMode = testMode === VehicleSystemType.SharedMemory;
  const showVehicleText = vehicleConfig.text.visible && shmActualNumVehicles > 0 && isTestActive && isSharedMemoryMode;

  return (
    <group name="text-renderer">
      {/* Map texts (Node/Edge) */}
      <MapTextRenderer
        mode={isSharedMemoryMode ? VehicleSystemType.SharedMemory : VehicleSystemType.ArraySingle}
        scale={scale}
        nodeColor={nodeColor}
        edgeColor={edgeColor}
        stationColor={themeStation}
      />

      {/* Vehicle texts (SharedMemory mode) */}
      {showVehicleText && (
        <VehicleTextRenderer
          numVehicles={shmActualNumVehicles}
          mode={VehicleSystemType.SharedMemory}
          scale={vehicleConfig.text.scale}
          color={vehicleColor}
          zOffset={vehicleConfig.text.zOffset}
          fabAssignments={fabAssignments}
        />
      )}
    </group>
  );
};

export default TextRenderer;