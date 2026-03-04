import React, {useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { RENDER_ORDER_TEXT } from "@/utils/renderOrder";
import { CHAR_COUNT } from "./useDigitMaterials";
import {
  buildSlotData,
  buildSpatialGrid,
  applyHighAltitudeCulling,
  getVisibleGroupsFromGrid,
  findNewlyCulledGroups,
  hideGroupCharacters,
  updateInstanceMatrices,
  renderVisibleGroups,
  updateBillboardRotation,
  getBillboardQuaternion,
  getBillboardRight,
} from "./instancedTextUtils";
import { BaseInstancedText } from "./BaseInstancedText";

import type { TextGroup } from "./instancedTextUtils";
export type { TextGroup } from "./instancedTextUtils";

interface Props {
  readonly groups?: TextGroup[];
  readonly scale?: number;
  readonly font?: string;
  readonly color?: string;
  readonly bgColor?: string;
  readonly zOffset?: number;
  readonly lodDistance?: number;
  readonly camHeightCutoff?: number;
  readonly fabOffsetRef?: React.MutableRefObject<{ x: number; y: number }>;
  /** false면 billboard 회전 없이 바닥(XY평면)에 고정 */
  readonly billboard?: boolean;
  readonly opacity?: number;
}

// Flat 모드용 고정값 (XY 평면에 깔림, 글자는 X축 방향)
const _flatQuaternion = new THREE.Quaternion(); // identity
const _flatRight = new THREE.Vector3(1, 0, 0);

export default function InstancedText({
  groups = [],
  scale = 1,
  font = "bold 96px system-ui, Roboto, Arial",
  color = "#ffffff",
  bgColor = "transparent",
  zOffset = 0.5,
  lodDistance = 10,
  camHeightCutoff = 60,
  fabOffsetRef,
  billboard = true,
  opacity = 1,
}: Props) {
  // Render Phase에서 데이터 계산 (Buffer Overflow 방지)
  const prevGroupsLengthRef = React.useRef(0);
  const slotData = React.useMemo(() => {
    return buildSlotData(groups);
  }, [groups]);

  // Cleanup when text groups are deleted
  React.useEffect(() => {
    if (prevGroupsLengthRef.current > groups.length && groups.length === 0) {
      // Dispose InstancedMesh resources
      for (const mesh of instRefs.current) {
        if (mesh) {
          mesh.dispose();
        }
      }
    }
    prevGroupsLengthRef.current = groups.length;
  }, [groups.length]);

  // Spatial Grid 빌드 (LOD 최적화용 - 한 번만 계산)
  const spatialGrid = React.useMemo(() => {
    if (groups.length === 0) return null;
    return buildSpatialGrid(groups, lodDistance);
  }, [groups, lodDistance]);

  const instRefs = useRef<(THREE.InstancedMesh | null)[]>(new Array(CHAR_COUNT).fill(null));

  // Zero-GC: Persistent arrays (reused every frame)
  const visibleGroupsRef = useRef<number[]>([]);
  const prevVisibleSetRef = useRef<Set<number>>(new Set());
  const newlyCulledRef = useRef<number[]>([]);

  useFrame(({ camera }) => {
    const D = slotData;
    if (!D || groups.length === 0 || !spatialGrid) return;

    const { x: cx, y: cy, z: cz } = camera.position;

    // fab offset 적용 (카메라 위치를 fab 0 기준 좌표로 변환)
    const fabOffsetX = fabOffsetRef?.current.x ?? 0;
    const fabOffsetY = fabOffsetRef?.current.y ?? 0;
    const localCx = cx - fabOffsetX;
    const localCy = cy - fabOffsetY;

    // Early exit 1: Camera too high
    if (applyHighAltitudeCulling(cz, camHeightCutoff, D, instRefs.current)) {
      return;
    }

    // Grid-based LOD: 수십만개 전체 순회 → 근처 셀만 체크 (fab 0 기준 좌표 사용)
    const visibleGroups = visibleGroupsRef.current;
    getVisibleGroupsFromGrid(spatialGrid, localCx, localCy, lodDistance, visibleGroups);

    // Find newly culled groups
    const prevVisible = prevVisibleSetRef.current;
    const newlyCulled = newlyCulledRef.current;
    findNewlyCulledGroups(prevVisible, visibleGroups, newlyCulled);

    // Update prevVisible for next frame
    prevVisible.clear();
    for (const groupIdx of visibleGroups) {
      prevVisible.add(groupIdx);
    }

    // Hide newly culled groups
    hideGroupCharacters(newlyCulled, D, instRefs.current);

    // Early exit if no visible groups
    if (visibleGroups.length === 0) {
      updateInstanceMatrices(instRefs.current);
      return;
    }

    // Billboard vs Flat: 회전 계산
    let quaternion: THREE.Quaternion;
    let right: THREE.Vector3;
    if (billboard) {
      updateBillboardRotation(camera.quaternion);
      quaternion = getBillboardQuaternion();
      right = getBillboardRight();
    } else {
      quaternion = _flatQuaternion;
      right = _flatRight;
    }

    // Render visible groups
    renderVisibleGroups(
      visibleGroups,
      groups,
      D,
      instRefs.current,
      {
        scale,
        charSpacing: 0.2 * scale,
        zOffset,
        quaternion,
        right,
        fabOffsetX,
        fabOffsetY,
      }
    );

    updateInstanceMatrices(instRefs.current);
  });

  return (
    <BaseInstancedText
      data={slotData}
      instRefs={instRefs}
      color={color}
      bgColor={bgColor}
      font={font}
      renderOrder={billboard ? RENDER_ORDER_TEXT : 0}
      depthTest={!billboard}
      opacity={opacity}
    />
  );
}