// WaitNodeMarkers.tsx
// 짧은 edge 앞 wait point relocation 시각화
// - waitRelocations에 있는 waitNode 위치마다 빨간 점 표시
// - 노드보다 살짝 큼

import React, { useMemo, useRef, useEffect } from "react";
import * as THREE from "three";
import { useNodeStore } from "@/store/map/nodeStore";
import { useFabStore } from "@/store/map/fabStore";
import { getMarkerConfig } from "@/config/threejs/renderConfig";

const MARKER_CONFIG = getMarkerConfig();
const MARKER_Z = MARKER_CONFIG.Z + 0.01; // 일반 노드 마커보다 살짝 위
const RADIUS = MARKER_CONFIG.NORMAL.RADIUS * 1.6; // 노드보다 1.6배 크게
const COLOR = "#ff0000"; // 새빨간색

const WaitNodeMarkers: React.FC = () => {
  const fabs = useFabStore((s) => s.fabs);
  const slots = useFabStore((s) => s.slots);

  if (fabs.length <= 1 || slots.length === 0) {
    return <WaitNodeMarkersCore />;
  }

  return (
    <group>
      {slots.map((slot) => (
        <group key={slot.slotId} position={[slot.offsetX, slot.offsetY, 0]}>
          <WaitNodeMarkersCore />
        </group>
      ))}
    </group>
  );
};

const WaitNodeMarkersCore: React.FC = () => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const waitRelocations = useNodeStore((s) => s.waitRelocations);
  const getNodeByName = useNodeStore((s) => s.getNodeByName);

  // waitNode set (중복 제거)
  const waitNodeNames = useMemo(() => {
    const set = new Set<string>();
    for (const r of waitRelocations.values()) {
      set.add(r.waitNode);
    }
    return [...set];
  }, [waitRelocations]);

  const count = waitNodeNames.length;

  const geometry = useMemo(
    () => new THREE.SphereGeometry(RADIUS, MARKER_CONFIG.SEGMENTS, MARKER_CONFIG.SEGMENTS),
    []
  );
  const material = useMemo(
    () => new THREE.MeshBasicMaterial({ color: COLOR }),
    []
  );

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || count === 0) return;
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);

    for (let i = 0; i < count; i++) {
      const node = getNodeByName(waitNodeNames[i]);
      if (!node) {
        // node 없으면 화면 밖으로
        position.set(0, 0, -9999);
      } else {
        position.set(node.editor_x, node.editor_y, MARKER_Z);
      }
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(i, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, [waitNodeNames, count, getNodeByName]);

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  if (count === 0) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, count]}
      frustumCulled={false}
    />
  );
};

export default WaitNodeMarkers;
