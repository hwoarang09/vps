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
}

export default function InstancedText({
  groups = [],
  scale = 1,
  font = "bold 96px system-ui, Roboto, Arial",
  color = "#ffffff",
  bgColor = "transparent",
  zOffset = 0.5,
  lodDistance = 10,
  camHeightCutoff = 60,
}: Props) {
  // Render Phase에서 데이터 계산 (Buffer Overflow 방지)
  const prevGroupsLengthRef = React.useRef(0);
  const slotData = React.useMemo(() => {
    return buildSlotData(groups);
  }, [groups]);

  // Cleanup when text groups are deleted
  React.useEffect(() => {
    if (prevGroupsLengthRef.current > groups.length && groups.length === 0) {
      console.log("[InstancedText] Text groups deleted, cleaning up resources");
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

    // Early exit 1: Camera too high
    if (applyHighAltitudeCulling(cz, camHeightCutoff, D, instRefs.current)) {
      return;
    }

    // Grid-based LOD: 수십만개 전체 순회 → 근처 셀만 체크
    const visibleGroups = visibleGroupsRef.current;
    getVisibleGroupsFromGrid(spatialGrid, cx, cy, lodDistance, visibleGroups);

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

    // Update billboard rotation once per frame
    updateBillboardRotation(camera.quaternion);
    const quaternion = getBillboardQuaternion();
    const right = getBillboardRight();

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
      renderOrder={RENDER_ORDER_TEXT}
    />
  );
}