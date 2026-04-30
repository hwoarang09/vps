import React, { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { getMapRenderConfig as getRendererConfig, getNodeConfig, getEdgeConfig, getStationConfig } from "@/config/threejs/renderConfig";
import { getStationTextConfig } from "@/config/threejs/stationConfig";
import { useTextStore } from "@store/map/textStore";
import { useFabStore } from "@store/map/fabStore";
import { useEdgeStore } from "@store/map/edgeStore";
import { useNodeStore } from "@store/map/nodeStore";
import InstancedText, { TextGroup } from "./InstancedText";
import { textToDigits } from "./useDigitMaterials";
import { VehicleSystemType } from "@/types/vehicle";
import type { Edge, Node } from "@/types";

/** edge.bay_name 기반으로 노드 좌표를 그룹핑 */
function groupEdgesByBay(
  edges: Edge[],
  nodes: Node[]
): Record<string, { x: number; y: number }[]> {
  const nodeMap = new Map<string, { x: number; y: number }>();
  for (const node of nodes) {
    nodeMap.set(node.node_name, { x: node.editor_x, y: node.editor_y });
  }

  const result: Record<string, { x: number; y: number }[]> = {};
  for (const edge of edges) {
    if (!edge.bay_name) continue;
    const key = edge.bay_name;
    result[key] ??= [];
    const fnPos = nodeMap.get(edge.from_node);
    const tnPos = nodeMap.get(edge.to_node);
    if (fnPos) result[key].push(fnPos);
    if (tnPos) result[key].push(tnPos);
  }
  return result;
}

/** 각 bay의 centroid → TextGroup 변환 */
function computeBayCentroids(
  bayNodePositions: Record<string, { x: number; y: number }[]>
): TextGroup[] {
  const result: TextGroup[] = [];
  for (const [bayName, positions] of Object.entries(bayNodePositions)) {
    if (positions.length === 0) continue;
    const avgX = positions.reduce((s, p) => s + p.x, 0) / positions.length;
    const isOuter = /OUTER/i.test(bayName);
    const y = isOuter
      ? Math.max(...positions.map((p) => p.y))
      : positions.reduce((s, p) => s + p.y, 0) / positions.length;
    result.push({ x: avgX, y, z: 0.2, digits: textToDigits(bayName) });
  }
  return result;
}

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

  const { fabs, findNearestFab, setActiveFabIndex } = useFabStore();

  // Fab offset ref (InstancedText에 전달, useFrame 내에서 동적 변경)
  const fabOffsetRef = useRef({ x: 0, y: 0 });
  const lastFabIndexRef = useRef(0);
  // 카메라 위치에 따라 fab offset 업데이트 (React re-render 없음)
  useFrame(({ camera }) => {
    if (fabs.length <= 1) return;

    const nearestFabIndex = findNearestFab(camera.position.x, camera.position.y);

    if (nearestFabIndex === lastFabIndexRef.current) return;

    lastFabIndexRef.current = nearestFabIndex;

    // fab 0 기준 offset 계산
    const fab0 = fabs[0];
    const activeFab = fabs[nearestFabIndex];
    if (!fab0 || !activeFab) return;

    const offsetX = activeFab.centerX - fab0.centerX;
    const offsetY = activeFab.centerY - fab0.centerY;

    // KPI HUD 등 React UI 동기화
    setActiveFabIndex(nearestFabIndex);

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

  // Bay labels: edge.bay_name 기반 그룹핑 → fn/tn 좌표 평균 → centroid에 bay 이름 표시
  const edges = useEdgeStore((s) => s.edges);
  const nodes = useNodeStore((s) => s.nodes);

  const bayGroups = useMemo((): TextGroup[] => {
    if (edges.length === 0 || nodes.length === 0) return [];
    if (!edges.some((e) => e.bay_name)) return [];

    const bayNodePositions = groupEdgesByBay(edges, nodes);
    return computeBayCentroids(bayNodePositions);
  }, [edges, nodes]);

  const BAY_LABEL_SCALE = 5;
  const BAY_LABEL_COLOR = "#ffffff";
  const BAY_LOD_DISTANCE = 200;
  const BAY_CAM_HEIGHT_CUTOFF = 500;

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
      {bayGroups.length > 0 && (
        <InstancedText
          groups={bayGroups}
          scale={BAY_LABEL_SCALE}
          color={BAY_LABEL_COLOR}
          lodDistance={BAY_LOD_DISTANCE}
          camHeightCutoff={BAY_CAM_HEIGHT_CUTOFF}
          fabOffsetRef={fabOffsetRef}
          billboard={false}
          opacity={0.7}
        />
      )}
    </group>
  );
};

export default MapTextRenderer;