import React, { useMemo, useEffect } from "react";
import * as THREE from "three";
import { useDigitMaterials, CHAR_COUNT, ALL_CHARS } from "./useDigitMaterials";
import { SlotData } from "./instancedTextUtils";

// Zero-scale matrix → vertices collapse to a point with zero area, no fragments.
// (Distinct from a default zero matrix, which gives w=0 and undefined behavior.)
const HIDE_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);

export interface BaseInstancedTextProps {
  data: SlotData | null;
  instRefs: React.MutableRefObject<(THREE.InstancedMesh | null)[]>;
  color?: string;
  bgColor?: string;
  font?: string;
  renderOrder?: number;
  depthTest?: boolean;
  opacity?: number;
  strokeColor?: string;
  strokeWidth?: number;
}

export const BaseInstancedText = React.memo(({
  data,
  instRefs,
  color = "#ffffff",
  bgColor = "transparent",
  font,
  renderOrder,
  depthTest = false,
  opacity = 1,
  strokeColor,
  strokeWidth,
}: BaseInstancedTextProps) => {
  const digitMaterials = useDigitMaterials({ color, bgColor, font, depthTest, opacity, strokeColor, strokeWidth });
  const quad = useMemo(() => new THREE.PlaneGeometry(1, 1), []);

  // Cleanup quad geometry
  useEffect(() => {
    return () => {
      quad.dispose();
    };
  }, [quad]);

  // 1. Mesh creation logic
  const meshes = useMemo(() => {
    if (!data) return null;
    return digitMaterials.map((mat, d) => {
      const cnt = Math.max(1, data.counts[d]);
      const char = ALL_CHARS[d]; // Use character for key
      return (
        <instancedMesh
          key={`base-digit-${char}`}
          ref={(el) => {//NOSONAR
              instRefs.current[d] = el; //NOSONAR
              return () => { instRefs.current[d] = null; };//NOSONAR
            }}//NOSONAR
          args={[quad, mat, cnt]}
          frustumCulled={false}
          renderOrder={renderOrder}
        />
      );
    });
  }, [digitMaterials, quad, data?.counts, renderOrder, instRefs]);

  // 2. Count update logic
  useEffect(() => {
    if (!data) return;
    for (let d = 0; d < CHAR_COUNT; d++) {
      const mesh = instRefs.current[d];
      if (!mesh) continue;
      // counts=0 chars allocate args=[..., 1] (Math.max above), so the lone
      // instance with zero-matrix transform renders at origin. Force count=0
      // so it draws nothing.
      if (data.counts[d] > 0) {
        mesh.count = data.counts[d];
        // Initialize every slot to HIDE_MATRIX. Visible groups overwrite their
        // own slots in renderVisibleGroups; any slot that is never assigned
        // (LOD-culled / not yet processed) stays hidden instead of rendering
        // as a default zero-matrix glyph at world origin.
        for (let i = 0; i < data.counts[d]; i++) {
          mesh.setMatrixAt(i, HIDE_MATRIX);
        }
        mesh.instanceMatrix.needsUpdate = true;
      } else {
        mesh.count = 0;
      }
    }
  }, [data?.counts, instRefs]);

  return <group>{meshes}</group>;
});
