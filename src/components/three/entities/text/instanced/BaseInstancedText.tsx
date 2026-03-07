import React, { useMemo, useEffect } from "react";
import * as THREE from "three";
import { useDigitMaterials, CHAR_COUNT, ALL_CHARS } from "./useDigitMaterials";
import { SlotData } from "./instancedTextUtils";

export interface BaseInstancedTextProps {
  data: SlotData | null;
  instRefs: React.MutableRefObject<(THREE.InstancedMesh | null)[]>;
  color?: string;
  bgColor?: string;
  font?: string;
  renderOrder?: number;
  depthTest?: boolean;
  opacity?: number;
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
}: BaseInstancedTextProps) => {
  const digitMaterials = useDigitMaterials({ color, bgColor, font, depthTest, opacity });
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

  // 2. Count update logic - count가 0인 메쉬는 visible=false로 draw call 제거
  useEffect(() => {
    if (!data) return;
    for (let d = 0; d < CHAR_COUNT; d++) {
      const mesh = instRefs.current[d];
      if (!mesh) continue;
      const cnt = data.counts[d];
      mesh.count = cnt;
      mesh.visible = cnt > 0;
      if (cnt > 0) {
        mesh.instanceMatrix.needsUpdate = true;
      }
    }
  }, [data?.counts, instRefs]);

  return <group>{meshes}</group>;
});
