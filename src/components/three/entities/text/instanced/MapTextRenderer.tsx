import React, { useMemo, useState, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { getRendererConfig } from "@/config/mapConfig";
import { getStationTextConfig } from "@/config/stationConfig";
import { useTextStore } from "@store/map/textStore";
import { useFabStore } from "@store/map/fabStore";
import InstancedText, { TextGroup } from "./InstancedText";
import { textToDigits } from "./useDigitMaterials";
import { VehicleSystemType } from "@/types/vehicle";

interface Props {
  mode: VehicleSystemType;
  scale?: number;
  nodeColor?: string;
  edgeColor?: string;
  stationColor?: string;
}

const MapTextRenderer: React.FC<Props> = (props) => {
  const config = getRendererConfig();
  const stationTextConfig = getStationTextConfig();
  const {
    mode,
    scale = config.SCALE,
    nodeColor = config.NODE_COLOR,
    edgeColor = config.EDGE_COLOR,
    stationColor = stationTextConfig.COLOR,
  } = props;
  const {
    nodeTexts, edgeTexts, stationTexts,
    nodeTextsArray, edgeTextsArray, stationTextsArray,
    textsByFab,
    updateTrigger,
  } = useTextStore();

  const { fabs, findNearestFab } = useFabStore();

  // 활성 fab index (카메라 위치 기반)
  const [activeFabIndex, setActiveFabIndex] = useState(0);
  const lastFabIndexRef = useRef(0);

  // 카메라 위치에 따라 활성 fab 업데이트
  useFrame(({ camera }) => {
    if (fabs.length <= 1) return; // fab이 1개 이하면 스킵

    const nearestFab = findNearestFab(camera.position.x, camera.position.y);
    if (nearestFab !== lastFabIndexRef.current) {
      lastFabIndexRef.current = nearestFab;
      setActiveFabIndex(nearestFab);
    }
  });

  // Fab 모드: textsByFab이 있으면 활성 fab만 렌더링
  const useFabMode = textsByFab.length > 0;

  // 활성 fab의 텍스트 그룹
  const activeFabData = useFabMode ? textsByFab[activeFabIndex] : null;

  const nodeGroups = useMemo((): TextGroup[] => {
    // Fab 모드
    if (useFabMode && activeFabData) {
      return activeFabData.nodeTexts.map(item => ({
        x: item.position.x,
        y: item.position.y,
        z: item.position.z,
        digits: textToDigits(item.name),
      }));
    }

    // 기존 모드
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
  }, [mode, nodeTexts, nodeTextsArray, updateTrigger, useFabMode, activeFabData]);

  const edgeGroups = useMemo((): TextGroup[] => {
    // Fab 모드
    if (useFabMode && activeFabData) {
      return activeFabData.edgeTexts.map(item => ({
        x: item.position.x,
        y: item.position.y,
        z: item.position.z,
        digits: textToDigits(item.name),
      }));
    }

    // 기존 모드
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
  }, [mode, edgeTexts, edgeTextsArray, updateTrigger, useFabMode, activeFabData]);

  const stationGroups = useMemo((): TextGroup[] => {
    // Fab 모드
    if (useFabMode && activeFabData) {
      return activeFabData.stationTexts.map(item => ({
        x: item.position.x,
        y: item.position.y,
        z: item.position.z,
        digits: textToDigits(item.name),
      }));
    }

    // 기존 모드
    if (mode === VehicleSystemType.ArraySingle) {
      return stationTextsArray.map(item => ({
        x: item.position.x,
        y: item.position.y,
        z: item.position.z,
        digits: textToDigits(item.name),
      }));
    }
    return Object.entries(stationTexts).map(([name, pos]) => ({
      x: pos.x,
      y: pos.y,
      z: pos.z,
      digits: textToDigits(name),
    }));
  }, [mode, stationTexts, stationTextsArray, updateTrigger, useFabMode, activeFabData]);

  return (
    <group name="map-text">
      {nodeGroups.length > 0 && (
        <InstancedText groups={nodeGroups} scale={scale} color={nodeColor} />
      )}
      {edgeGroups.length > 0 && (
        <InstancedText groups={edgeGroups} scale={scale} color={edgeColor} />
      )}
      {stationGroups.length > 0 && (
        <InstancedText groups={stationGroups} scale={scale} color={stationColor} />
      )}
    </group>
  );
};

export default MapTextRenderer;