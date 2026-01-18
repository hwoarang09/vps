import React from "react";
import { getMapRenderConfig, getVehicleRenderConfig } from "@/config/renderConfig";
import { VehicleSystemType } from "@/types/vehicle";
import { useVehicleTestStore } from "@store/vehicle/vehicleTestStore";
import { useShmSimulatorStore } from "@store/vehicle/shmMode/shmSimulatorStore";
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

  const {
    scale = mapConfig.scale,
    nodeColor = "#00ff00",
    edgeColor = "#0066ff",
    vehicleColor = vehicleConfig.text.color,
  } = props;

  // testMode from vehicleTestStore (actual running mode)
  const { testMode, isTestActive } = useVehicleTestStore();
  // actualNumVehicles from shmSimulatorStore (real initialized count)
  const shmActualNumVehicles = useShmSimulatorStore((state) => state.actualNumVehicles);

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
      />

      {/* Vehicle texts (SharedMemory mode) */}
      {showVehicleText && (
        <VehicleTextRenderer
          numVehicles={shmActualNumVehicles}
          mode={VehicleSystemType.SharedMemory}
          scale={vehicleConfig.text.scale}
          color={vehicleColor}
          zOffset={vehicleConfig.text.zOffset}
        />
      )}
    </group>
  );
};

export default TextRenderer;