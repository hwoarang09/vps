import React, { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useEdgeStore } from "@/store/map/edgeStore";
import { useNodeStore } from "@/store/map/nodeStore";
import { useStationStore } from "@/store/map/stationStore";
import { useFabStore } from "@/store/map/fabStore";
import EdgeRenderer from "./EdgeRenderer";
import NodesRenderer from "./NodesRenderer";
import StationRenderer from "./StationRenderer";
import { useRenderCheck } from "@/utils/renderDebug";

// 카메라 위치 변화 감지 임계값 (이 거리 이상 이동해야 업데이트)
const CAMERA_MOVE_THRESHOLD = 100;

/**
 * MapRenderer component - Slot-based rendering for multi-fab
 * - Uses InstancedMesh for edges and nodes
 * - For multi-fab: uses originalMapData with slot offsets
 * - For single fab: uses store data directly
 * - Slots are updated based on camera position
 */
const MapRenderer: React.FC = () => {
  useRenderCheck("MapRenderer");

  // 단일 fab 또는 슬롯 미초기화 시 store 데이터 사용
  const storeEdges = useEdgeStore((state) => state.edges);
  const storeNodes = useNodeStore((state) => state.nodes);
  const storeStations = useStationStore((state) => state.stations);

  // 멀티 fab 시 원본 데이터 사용
  const originalMapData = useFabStore((state) => state.originalMapData);
  const fabs = useFabStore((state) => state.fabs);
  const slots = useFabStore((state) => state.slots);
  const updateSlots = useFabStore((state) => state.updateSlots);

  // 멀티 fab 여부
  const isMultiFab = fabs.length > 1 && slots.length > 0;

  // 렌더링할 데이터 선택 (멀티 fab이면 원본, 아니면 store)
  const edges = isMultiFab && originalMapData ? originalMapData.edges : storeEdges;
  const nodes = isMultiFab && originalMapData ? originalMapData.nodes : storeNodes;
  const stations = isMultiFab && originalMapData ? originalMapData.stations : storeStations;

  // 마지막 카메라 위치 (불필요한 업데이트 방지)
  const lastCameraPosRef = useRef({ x: 0, y: 0 });

  // 카메라 위치 변화 감지 및 슬롯 업데이트
  useFrame(({ camera }) => {
    // 멀티 fab이 아니면 스킵
    if (fabs.length <= 1) return;

    const { x: cx, y: cy } = camera.position;
    const { x: lastX, y: lastY } = lastCameraPosRef.current;

    // 임계값 이상 이동했을 때만 업데이트
    const dx = cx - lastX;
    const dy = cy - lastY;
    if (dx * dx + dy * dy > CAMERA_MOVE_THRESHOLD * CAMERA_MOVE_THRESHOLD) {
      lastCameraPosRef.current = { x: cx, y: cy };
      updateSlots(cx, cy);
    }
  });

  // Extract node IDs for NodesRenderer
  const nodeIds = useMemo(() => nodes.map((n) => n.node_name), [nodes]);

  return (
    <group>
      {/* Render all nodes - slot offset applied inside renderer */}
      <NodesRenderer nodeIds={nodeIds} />

      {/* Render all edges - slot offset applied inside renderer */}
      <EdgeRenderer edges={edges} />

      {/* Render all stations - slot offset applied inside renderer */}
      <StationRenderer stations={stations} />

      {/* Basic lighting for better visibility */}
      <ambientLight intensity={0.6} />
      <directionalLight position={[10, 10, 5]} intensity={0.8} />
    </group>
  );
};

export default MapRenderer;
