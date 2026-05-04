import React, { useMemo, useEffect, useRef } from "react";
import * as THREE from "three";
import type { Edge } from "@/types";
import { useFabStore } from "@/store/map/fabStore";
import { RENDER_ORDER_RAIL_LINEAR } from "@/utils/renderOrder";

const LINE_Z = 0.03;
const DASH_COLOR = "#c66a2a";
const DASH_SIZE = 0.25;
const GAP_SIZE = 0.3;
const OPACITY = 0.7;

interface Props {
  edges: Edge[];
}

const EdgeFloorDashRenderer: React.FC<Props> = ({ edges }) => {
  const slots = useFabStore((s) => s.slots);
  const fabs = useFabStore((s) => s.fabs);

  if (fabs.length <= 1 || slots.length === 0) {
    return <DashLines edges={edges} />;
  }

  return (
    <group name="edge-floor-dash">
      {slots.map((slot) => (
        <group key={slot.slotId} position={[slot.offsetX, slot.offsetY, 0]}>
          <DashLines edges={edges} />
        </group>
      ))}
    </group>
  );
};

const DashLines: React.FC<{ edges: Edge[] }> = ({ edges }) => {
  const lineRef = useRef<THREE.LineSegments>(null);

  const geometry = useMemo(() => {
    const positions: number[] = [];

    for (const edge of edges) {
      const pts = edge.renderingPoints;
      if (!pts || pts.length < 2) continue;

      // each consecutive pair becomes one LineSegments segment
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        positions.push(a.x, a.y, LINE_Z);
        positions.push(b.x, b.y, LINE_Z);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    return geo;
  }, [edges]);

  const material = useMemo(
    () =>
      new THREE.LineDashedMaterial({
        color: DASH_COLOR,
        dashSize: DASH_SIZE,
        gapSize: GAP_SIZE,
        transparent: true,
        opacity: OPACITY,
      }),
    []
  );

  useEffect(() => {
    if (lineRef.current) {
      lineRef.current.computeLineDistances();
    }
  }, [geometry]);

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  if (geometry.attributes.position.count === 0) return null;

  return (
    <lineSegments
      ref={lineRef}
      args={[geometry, material]}
      renderOrder={RENDER_ORDER_RAIL_LINEAR + 1}
    />
  );
};

export default EdgeFloorDashRenderer;
