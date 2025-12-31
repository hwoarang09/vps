import React, {useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { RENDER_ORDER_TEXT } from "@/utils/renderOrder";
import { CHAR_COUNT } from "./useDigitMaterials";
import {
  HIDE_MATRIX,
  buildSlotData,
  buildSpatialGrid,
  applyHighAltitudeCulling,
  getVisibleGroupsFromGrid,
  updateBillboardRotation,
  getBillboardQuaternion,
  getBillboardRight,
} from "./instancedTextUtils";
import { BaseInstancedText } from "./BaseInstancedText";

import type { TextGroup } from "./instancedTextUtils";
export type { TextGroup } from "./instancedTextUtils";

// Zero-GC: Module-level scratchpads (allocated once)
const _tempMatrix = new THREE.Matrix4();
const _tempScale = new THREE.Vector3();
const _tempOffset = new THREE.Vector3();
const _tempFinalPos = new THREE.Vector3();

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
  const slotData = React.useMemo(() => {
    return buildSlotData(groups);
  }, [groups]);

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

    const { slotDigit, slotIndex, slotPosition, groupStart } = D;
    const { x: cx, y: cy, z: cz } = camera.position;

    if (!groupStart) return;

    // Early exit 1: Camera too high
    if (applyHighAltitudeCulling(cz, camHeightCutoff, D, instRefs.current)) {
      return;
    }

    // Grid-based LOD: 수십만개 전체 순회 → 근처 셀만 체크
    const visibleGroups = visibleGroupsRef.current;
    getVisibleGroupsFromGrid(spatialGrid, cx, cy, lodDistance, visibleGroups);

    // Find newly culled groups (was visible last frame, now culled)
    const prevVisible = prevVisibleSetRef.current;
    const newlyCulled = newlyCulledRef.current;
    newlyCulled.length = 0;

    // Build current visible set and find newly culled
    const currentVisibleSet = new Set(visibleGroups);
    for (const groupIdx of prevVisible) {
      if (!currentVisibleSet.has(groupIdx)) {
        newlyCulled.push(groupIdx);
      }
    }

    // Update prevVisible for next frame
    prevVisible.clear();
    for (const groupIdx of visibleGroups) {
      prevVisible.add(groupIdx);
    }

    // Hide newly culled groups
    for (const groupIdx of newlyCulled) {
      const start = groupStart[groupIdx];
      const end = groupStart[groupIdx + 1];
      for (let i = start; i < end; i++) {
        const d = slotDigit[i];
        const slot = slotIndex[i];
        const mesh = instRefs.current[d];
        if (mesh) mesh.setMatrixAt(slot, HIDE_MATRIX);
      }
    }

    // Early exit if no visible groups (after hiding culled ones)
    if (visibleGroups.length === 0) {
      for (const msh of instRefs.current) {
        if (msh) msh.instanceMatrix.needsUpdate = true;
      }
      return;
    }

    // Zero-GC: Reuse scratchpads
    _tempScale.set(scale, scale, 1);
    const charSpacing = 0.2 * scale;

    // Zero-GC: Update billboard rotation once per frame
    updateBillboardRotation(camera.quaternion);
    const quaternion = getBillboardQuaternion();
    const right = getBillboardRight();

    // Only iterate over VISIBLE groups
    for (const groupIdx of visibleGroups) {
      const group = groups[groupIdx];
      const gx = group.x;
      const gy = group.y;
      const gz = group.z + zOffset;

      const start = groupStart[groupIdx];
      const end = groupStart[groupIdx + 1];

      for (let i = start; i < end; i++) {
        const d = slotDigit[i];
        const slot = slotIndex[i];
        const posIdx = slotPosition[i];
        const mesh = instRefs.current[d];
        if (!mesh) continue;

        const halfLen = (group.digits.length - 1) / 2;
        const offsetX = (posIdx - halfLen) * charSpacing;
        _tempOffset.copy(right).multiplyScalar(offsetX);
        _tempFinalPos.set(gx, gy, gz).add(_tempOffset);

        _tempMatrix.compose(_tempFinalPos, quaternion, _tempScale);
        mesh.setMatrixAt(slot, _tempMatrix);
      }
    }

    for (const msh of instRefs.current) {
      if (msh) msh.instanceMatrix.needsUpdate = true;
    }
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