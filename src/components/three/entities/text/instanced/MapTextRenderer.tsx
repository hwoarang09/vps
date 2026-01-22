import React, { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { getMapRenderConfig as getRendererConfig, getNodeConfig, getEdgeConfig, getStationConfig } from "@/config/renderConfig";
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
  const mapConfig = getRendererConfig();
  const nodeConfig = getNodeConfig();
  const edgeConfig = getEdgeConfig();
  const stationConfig = getStationConfig();
  const stationTextConfig = getStationTextConfig();
  const {
    mode,
    scale = mapConfig.scale,
    nodeColor = nodeConfig.text.color,
    edgeColor = edgeConfig.text.color,
    stationColor = stationTextConfig.COLOR,
  } = props;

  // Text visibility flags from config
  const showNodeText = nodeConfig.text.visible;
  const showEdgeText = edgeConfig.text.visible;
  const showStationText = stationConfig.text.visible;
  const {
    nodeTexts, edgeTexts, stationTexts,
    nodeTextsArray, edgeTextsArray, stationTextsArray,
    updateTrigger,
  } = useTextStore();

  const { fabs, findNearestFab } = useFabStore();

  // Fab offset ref (InstancedText에 전달, useFrame 내에서 동적 변경)
  const fabOffsetRef = useRef({ x: 0, y: 0 });
  const lastFabIndexRef = useRef(0);
  const lastLogTimeRef = useRef(0);

  // 카메라 위치에 따라 fab offset 업데이트 (React re-render 없음)
  useFrame(({ camera, clock }) => {
    if (fabs.length <= 1) return;

    const nearestFabIndex = findNearestFab(camera.position.x, camera.position.y);

    // 1초에 한 번씩 현재 fab index 로그
    const now = clock.getElapsedTime();
    if (now - lastLogTimeRef.current >= 1) {
      lastLogTimeRef.current = now;
      console.log(`[MapText] nearestFabIndex: ${nearestFabIndex}, camera: (${camera.position.x.toFixed(0)}, ${camera.position.y.toFixed(0)})`);
    }

    if (nearestFabIndex === lastFabIndexRef.current) return;

    // fab index가 바뀔 때 로그
    const prevIndex = lastFabIndexRef.current;
    lastFabIndexRef.current = nearestFabIndex;

    // fab 0 기준 offset 계산
    const fab0 = fabs[0];
    const activeFab = fabs[nearestFabIndex];
    if (!fab0 || !activeFab) return;

    const offsetX = activeFab.centerX - fab0.centerX;
    const offsetY = activeFab.centerY - fab0.centerY;

    console.log(`[MapText] FAB CHANGED: ${prevIndex} → ${nearestFabIndex}`);
    console.log(`[MapText] Moving text offset to: (${offsetX.toFixed(0)}, ${offsetY.toFixed(0)})`);

    // offset ref 업데이트 (InstancedText의 useFrame에서 읽어서 적용)
    fabOffsetRef.current.x = offsetX;
    fabOffsetRef.current.y = offsetY;

    console.log(`[MapText] fabOffsetRef after: (${fabOffsetRef.current.x.toFixed(0)}, ${fabOffsetRef.current.y.toFixed(0)})`);
  });

  // SharedMemory와 ArraySingle 모두 array 데이터 사용
  const useArrayData = mode === VehicleSystemType.ArraySingle || mode === VehicleSystemType.SharedMemory;

  // 텍스트 데이터는 fab 0 기준으로 한 번만 계산 (fab 전환 시 재계산 없음)
  const nodeGroups = useMemo((): TextGroup[] => {
    if (useArrayData) {
      return nodeTextsArray.map(item => ({
        x: item.position.x,
        y: item.position.y,
        z: item.position.z,
        digits: textToDigits(item.name),
      }));
    }
    // Dict 모드 (Rapier)
    return Object.entries(nodeTexts).map(([name, pos]) => ({
      x: pos.x,
      y: pos.y,
      z: pos.z,
      digits: textToDigits(name),
    }));
  }, [useArrayData, nodeTexts, nodeTextsArray, updateTrigger]);

  const edgeGroups = useMemo((): TextGroup[] => {
    if (useArrayData) {
      return edgeTextsArray.map(item => ({
        x: item.position.x,
        y: item.position.y,
        z: item.position.z,
        digits: textToDigits(item.name),
      }));
    }
    // Dict 모드 (Rapier)
    return Object.entries(edgeTexts).map(([name, pos]) => ({
      x: pos.x,
      y: pos.y,
      z: pos.z,
      digits: textToDigits(name),
    }));
  }, [useArrayData, edgeTexts, edgeTextsArray, updateTrigger]);

  const stationGroups = useMemo((): TextGroup[] => {
    if (useArrayData) {
      return stationTextsArray.map(item => ({
        x: item.position.x,
        y: item.position.y,
        z: item.position.z,
        digits: textToDigits(item.name),
      }));
    }
    // Dict 모드 (Rapier)
    return Object.entries(stationTexts).map(([name, pos]) => ({
      x: pos.x,
      y: pos.y,
      z: pos.z,
      digits: textToDigits(name),
    }));
  }, [useArrayData, stationTexts, stationTextsArray, updateTrigger]);

  return (
    <group name="map-text">
      {showNodeText && nodeGroups.length > 0 && (
        <InstancedText groups={nodeGroups} scale={scale} color={nodeColor} fabOffsetRef={fabOffsetRef} />
      )}
      {showEdgeText && edgeGroups.length > 0 && (
        <InstancedText groups={edgeGroups} scale={scale} color={edgeColor} fabOffsetRef={fabOffsetRef} />
      )}
      {showStationText && stationGroups.length > 0 && (
        <InstancedText groups={stationGroups} scale={scale} color={stationColor} fabOffsetRef={fabOffsetRef} />
      )}
    </group>
  );
};

export default MapTextRenderer;