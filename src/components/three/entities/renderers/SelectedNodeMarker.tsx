// SelectedNodeMarker.tsx
// 검색으로 선택된 node에 노란색 큰 sphere 표시 (pulse 애니메이션)

import React, { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useNodeStore } from "@/store/map/nodeStore";
import { useNodeControlStore } from "@/store/ui/nodeControlStore";
import { useFabStore } from "@/store/map/fabStore";
import { getMarkerConfig } from "@/config/threejs/renderConfig";

const MARKER_CONFIG = getMarkerConfig();
const MARKER_Z = MARKER_CONFIG.Z + 0.05; // 다른 마커들보다 위
const RADIUS = MARKER_CONFIG.NORMAL.RADIUS * 3.0; // 일반 노드 마커의 3배
const COLOR = "#ffff00"; // 노랑

const SelectedNodeMarker: React.FC = () => {
  const fabs = useFabStore((s) => s.fabs);
  const slots = useFabStore((s) => s.slots);

  if (fabs.length <= 1 || slots.length === 0) {
    return <SelectedNodeMarkerCore />;
  }

  return (
    <group>
      {slots.map((slot) => (
        <group key={slot.slotId} position={[slot.offsetX, slot.offsetY, 0]}>
          <SelectedNodeMarkerCore />
        </group>
      ))}
    </group>
  );
};

const SelectedNodeMarkerCore: React.FC = () => {
  const meshRef = useRef<THREE.Mesh>(null);
  const selectedNodeName = useNodeControlStore((s) => s.selectedNodeName);
  const getNodeByName = useNodeStore((s) => s.getNodeByName);

  const node = selectedNodeName ? getNodeByName(selectedNodeName) : null;

  const geometry = useMemo(
    () => new THREE.SphereGeometry(RADIUS, MARKER_CONFIG.SEGMENTS, MARKER_CONFIG.SEGMENTS),
    []
  );
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: COLOR,
        transparent: true,
        opacity: 0.85,
      }),
    []
  );

  // pulse 애니메이션
  useFrame((state) => {
    if (!meshRef.current) return;
    const t = state.clock.elapsedTime;
    const pulse = 1 + 0.15 * Math.sin(t * 4); // ±15% scale
    meshRef.current.scale.set(pulse, pulse, pulse);
  });

  if (!node) return null;

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      material={material}
      position={[node.editor_x, node.editor_y, MARKER_Z]}
      frustumCulled={false}
    />
  );
};

export default SelectedNodeMarker;
