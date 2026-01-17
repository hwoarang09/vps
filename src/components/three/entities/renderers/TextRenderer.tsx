import React from "react";
import { getMapRenderConfig as getRendererConfig } from "@/config/renderConfig";
import { useTextStore } from "@store/map/textStore";
import { VehicleSystemType } from "@/types/vehicle";
import { useVehicleTestStore } from "@store/vehicle/vehicleTestStore";
import MapTextRenderer from "../text/instanced/MapTextRenderer";
import VehicleTextRenderer from "../text/instanced/VehicleTextRenderer";

interface Props {
  scale?: number;
  nodeColor?: string;
  edgeColor?: string;
  vehicleColor?: string;
}

const TextRenderer: React.FC<Props> = (props) => {
  const config = getRendererConfig();
  
  const {
    scale = config.SCALE,
    nodeColor = config.NODE_COLOR,
    edgeColor = config.EDGE_COLOR,
    vehicleColor = config.VEHICLE_COLOR,
  } = props;
  const { mode } = useTextStore();
  const {  numVehicles } = useVehicleTestStore();

  const isArrayMode = mode === VehicleSystemType.ArraySingle;
  
  return (
    <group name="text-renderer">
      {/* Map texts (Node/Edge) */}
      <MapTextRenderer
        mode={isArrayMode ? VehicleSystemType.ArraySingle : VehicleSystemType.RapierDict}
        scale={scale}
        nodeColor={nodeColor}
        edgeColor={edgeColor}
      />

      {/* Vehicle texts (only in rapier mode - arrayMode renders its own) */}
      {!isArrayMode && numVehicles > 0 && (
        <VehicleTextRenderer
          numVehicles={numVehicles}
          mode={VehicleSystemType.RapierDict}
          scale={scale * 1.8}
          color={vehicleColor}
        />
      )}
    </group>
  );
};

export default TextRenderer;