import React, { useMemo } from "react";
import { getRendererConfig } from "@/config/mapConfig";
import { useTextStore } from "@store/map/textStore";
import InstancedText, { TextGroup } from "./InstancedText";
import { textToDigits } from "./useDigitMaterials";
import { VehicleSystemType } from "../../../../../types/vehicle";

interface Props {
  mode: VehicleSystemType;
  scale?: number;
  nodeColor?: string;
  edgeColor?: string;
}

const MapTextRenderer: React.FC<Props> = (props) => {
  const config = getRendererConfig();
  const {
    mode,
    scale = config.SCALE,
    nodeColor = config.NODE_COLOR,
    edgeColor = config.EDGE_COLOR,
  } = props;
  const {
    nodeTexts, edgeTexts,
    nodeTextsArray, edgeTextsArray,
    updateTrigger,
  } = useTextStore();

  const nodeGroups = useMemo((): TextGroup[] => {
    if (mode === VehicleSystemType.ArraySingle) {
      return nodeTextsArray.map(item => ({
        x: item.position.x,
        y: item.position.y,
        z: item.position.z,
        digits: textToDigits(item.name),
      }));
    }
    return Object.entries(nodeTexts).map(([name, pos]) => ({
      x: pos.x,
      y: pos.y,
      z: pos.z,
      digits: textToDigits(name),
    }));
  }, [mode, nodeTexts, nodeTextsArray, updateTrigger]);

  const edgeGroups = useMemo((): TextGroup[] => {
    if (mode === VehicleSystemType.ArraySingle) {
      return edgeTextsArray.map(item => ({
        x: item.position.x,
        y: item.position.y,
        z: item.position.z,
        digits: textToDigits(item.name),
      }));
    }
    return Object.entries(edgeTexts).map(([name, pos]) => ({
      x: pos.x,
      y: pos.y,
      z: pos.z,
      digits: textToDigits(name),
    }));
  }, [mode, edgeTexts, edgeTextsArray, updateTrigger]);

  return (
    <group name="map-text">
      {nodeGroups.length > 0 && (
        <InstancedText groups={nodeGroups} scale={scale} color={nodeColor} />
      )}
      {edgeGroups.length > 0 && (
        <InstancedText groups={edgeGroups} scale={scale} color={edgeColor} />
      )}
    </group>
  );
};

export default MapTextRenderer;