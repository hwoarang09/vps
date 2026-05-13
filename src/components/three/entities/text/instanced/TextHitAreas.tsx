import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import type { TextGroup } from "./instancedTextUtils";
import { useMapHoverStore, type MapHoverKind } from "@/store/ui/mapHoverStore";
import { useFabStore } from "@/store/map/fabStore";

// InstancedText 와 동일 상수 (글자 한 칸 폭 = 0.2 * scale)
const CHAR_SPACING_FACTOR = 0.2;
const HEIGHT_FACTOR = 1.0;

interface Props {
  /** 객체 종류 */
  kind: MapHoverKind;
  /** InstancedText 와 동일한 group 배열 (fab 0 기준 좌표) */
  groups: TextGroup[];
  /** groups 와 1:1 길이. 각 group이 가리키는 객체 이름 (node_name/edge_name/station_name) */
  names: string[];
  /** InstancedText scale 과 동일하게 전달해야 hit zone 크기가 글자와 맞음 */
  scale?: number;
  /** 카메라 위치에 따라 active fab 으로 이동시키는 ref (text 와 공유) */
  fabOffsetRef?: React.MutableRefObject<{ x: number; y: number }>;
  /** Plane z (텍스트 zOffset 과 동일하게 두면 자연스러움) */
  zOffset?: number;
  /** bbox 여유 (1.2 = 글자 둘레 20% 더 큼) */
  paddingFactor?: number;
  /** 카메라가 너무 높으면 텍스트와 함께 hover 비활성화 */
  camHeightCutoff?: number;
}

const _matrix = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _quat = new THREE.Quaternion(); // identity → XY plane

/**
 * Map text(node/edge/station) hover 감지용 invisible InstancedMesh.
 *
 * - 글자 InstancedText 자체는 raycast 안 시키고 이 plane mesh 에서만 잡음
 *   → raycast cost 가 character 수가 아닌 group 수에 비례
 *   → 글자 사이 빈 공간도 hover 가능
 * - multi-fab: fabOffsetRef 공유로 text 와 동기 이동
 *   → fab 16개여도 hit plane 은 한 세트
 * - flat (XY plane) 으로 두고 paddingFactor 로 카메라 기울임 보정.
 *   billboard 가 필요하면 후속 단계에서 instance matrix 매 프레임 갱신.
 */
const TextHitAreas: React.FC<Props> = ({
  kind,
  groups,
  names,
  scale = 1,
  fabOffsetRef,
  zOffset = 0.5,
  paddingFactor = 1.2,
  camHeightCutoff = 60,
}) => {
  const meshRef = useRef<THREE.InstancedMesh | null>(null);
  const setHover = useMapHoverStore((s) => s.setHover);
  const clearHover = useMapHoverStore((s) => s.clearHover);

  const count = groups.length;

  // 초기 matrix 세팅 (group position + bbox scale). groups/scale 변경 시만 재계산.
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || count === 0) return;

    for (let i = 0; i < count; i++) {
      const g = groups[i];
      const w = Math.max(
        0.5,
        g.digits.length * CHAR_SPACING_FACTOR * scale * paddingFactor,
      );
      const h = scale * HEIGHT_FACTOR * paddingFactor;
      _pos.set(g.x, g.y, g.z + zOffset);
      _scale.set(w, h, 1);
      _matrix.compose(_pos, _quat, _scale);
      mesh.setMatrixAt(i, _matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, [groups, scale, paddingFactor, zOffset, count]);

  // fab offset / 고도 cull. instance matrix 는 그대로 두고 mesh.position 으로 균일 shift.
  useFrame(({ camera }) => {
    const mesh = meshRef.current;
    if (!mesh) return;

    if (camera.position.z > camHeightCutoff) {
      mesh.visible = false;
      return;
    }
    mesh.visible = true;

    if (fabOffsetRef) {
      mesh.position.x = fabOffsetRef.current.x;
      mesh.position.y = fabOffsetRef.current.y;
    }
  });

  const handlePointerOver = (e: ThreeEvent<PointerEvent>) => {
    const id = e.instanceId;
    if (id === undefined) return;
    const name = names[id];
    if (!name) return;
    const fabIdx = useFabStore.getState().activeFabIndex;
    setHover(kind, name, fabIdx);
    document.body.style.cursor = "pointer";
    e.stopPropagation();
  };

  const handlePointerOut = () => {
    clearHover();
    document.body.style.cursor = "auto";
  };

  if (count === 0) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, count]}
      onPointerOver={handlePointerOver}
      onPointerOut={handlePointerOut}
      frustumCulled={false}
    >
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial
        transparent
        opacity={0}
        depthWrite={false}
        colorWrite={false}
        side={THREE.DoubleSide}
      />
    </instancedMesh>
  );
};

export default TextHitAreas;
