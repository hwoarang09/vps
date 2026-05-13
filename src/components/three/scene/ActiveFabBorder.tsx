import React, { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { Mesh, MeshBasicMaterial } from "three";
import { useFabStore } from "@/store/map/fabStore";

const COLOR_BRIGHT = "#ffa726";
const COLOR_GLOW = "#ff7043";
const BORDER_PADDING = 2;
const BORDER_Z = 3.8;

const CORNER_RATIO = 0.12;
const CORNER_THICKNESS = 0.5;
const CORNER_GLOW_THICKNESS = 1.6;

const LINE_THICKNESS = 0.12;
const LINE_OPACITY = 0.22;
const LINE_INSET = 1.0;

interface SegmentSpec {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface CornerBounds {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  cornerLen: number;
}

// Each L-arm reaches exactly D from the corner along both axes, regardless of t.
// Vertical: spans y[corner-t/2, corner+D]  (sticks out by t/2 to form clean corner)
// Horizontal: spans x[corner+t/2, corner+D] (shortened to avoid overlap with vertical)
function buildCornerSegments(b: CornerBounds, t: number): SegmentSpec[] {
  const { xMin, xMax, yMin, yMax, cornerLen: D } = b;
  const vH = D + t / 2; // vertical arm length (extends slightly past corner edge)
  const hW = D - t / 2; // horizontal arm length (shortened to start past vertical)
  return [
    // bottom-left @ (xMin, yMin)
    { x: xMin + D / 2 + t / 4, y: yMin, w: hW, h: t },
    { x: xMin, y: yMin + D / 2 - t / 4, w: t, h: vH },
    // bottom-right @ (xMax, yMin)
    { x: xMax - D / 2 - t / 4, y: yMin, w: hW, h: t },
    { x: xMax, y: yMin + D / 2 - t / 4, w: t, h: vH },
    // top-left @ (xMin, yMax)
    { x: xMin + D / 2 + t / 4, y: yMax, w: hW, h: t },
    { x: xMin, y: yMax - D / 2 + t / 4, w: t, h: vH },
    // top-right @ (xMax, yMax)
    { x: xMax - D / 2 - t / 4, y: yMax, w: hW, h: t },
    { x: xMax, y: yMax - D / 2 + t / 4, w: t, h: vH },
  ];
}

const ActiveFabBorder: React.FC = () => {
  const fabs = useFabStore((s) => s.fabs);
  const activeFabIndex = useFabStore((s) => s.activeFabIndex);

  const bounds = useMemo(() => {
    if (fabs.length === 0 || activeFabIndex < 0) return null;
    const fab = fabs.find((f) => f.fabIndex === activeFabIndex);
    if (!fab) return null;

    const xMin = fab.xMin - BORDER_PADDING;
    const xMax = fab.xMax + BORDER_PADDING;
    const yMin = fab.yMin - BORDER_PADDING;
    const yMax = fab.yMax + BORDER_PADDING;
    const width = xMax - xMin;
    const height = yMax - yMin;
    const centerX = (xMin + xMax) / 2;
    const centerY = (yMin + yMax) / 2;
    const cornerLen = Math.min(width, height) * CORNER_RATIO;

    return { width, height, centerX, centerY, xMin, xMax, yMin, yMax, cornerLen };
  }, [fabs, activeFabIndex]);

  const cornerSegments = useMemo<SegmentSpec[]>(() => {
    if (!bounds) return [];
    return buildCornerSegments(bounds, CORNER_THICKNESS);
  }, [bounds]);

  const glowSegments = useMemo<SegmentSpec[]>(() => {
    if (!bounds) return [];
    return buildCornerSegments(bounds, CORNER_GLOW_THICKNESS);
  }, [bounds]);

  const perimeterSegments = useMemo<SegmentSpec[]>(() => {
    if (!bounds) return [];
    const { xMin, xMax, yMin, yMax, width, height, centerX, centerY } = bounds;
    const t = LINE_THICKNESS;
    const w = Math.max(0, width - LINE_INSET * 2);
    const h = Math.max(0, height - LINE_INSET * 2);
    return [
      { x: centerX, y: yMin, w, h: t }, // bottom
      { x: centerX, y: yMax, w, h: t }, // top
      { x: xMin, y: centerY, w: t, h }, // left
      { x: xMax, y: centerY, w: t, h }, // right
    ];
  }, [bounds]);

  const glowRef = useRef<Mesh[]>([]);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const pulse = 0.45 + Math.sin(t * 2.2) * 0.18; // 0.27 ~ 0.63
    for (const mesh of glowRef.current) {
      if (!mesh) continue;
      const mat = mesh.material as MeshBasicMaterial;
      mat.opacity = pulse;
    }
  });

  if (!bounds) return null;

  return (
    <group position={[0, 0, BORDER_Z]}>
      {/* Soft perimeter line (faint) */}
      {perimeterSegments.map((s, i) => (
        <mesh key={`p-${i}`} position={[s.x, s.y, 0]}>
          <planeGeometry args={[s.w, s.h]} />
          <meshBasicMaterial
            color={COLOR_GLOW}
            transparent
            opacity={LINE_OPACITY}
            toneMapped={false}
            depthWrite={false}
          />
        </mesh>
      ))}

      {/* Corner glow (wide, soft, animated) */}
      {glowSegments.map((s, i) => (
        <mesh
          key={`g-${i}`}
          position={[s.x, s.y, 0.001]}
          ref={(el) => {
            if (el) glowRef.current[i] = el;
          }}
        >
          <planeGeometry args={[s.w, s.h]} />
          <meshBasicMaterial
            color={COLOR_GLOW}
            transparent
            opacity={0.5}
            toneMapped={false}
            depthWrite={false}
          />
        </mesh>
      ))}

      {/* Corner bracket (sharp, bright) */}
      {cornerSegments.map((s, i) => (
        <mesh key={`c-${i}`} position={[s.x, s.y, 0.002]}>
          <planeGeometry args={[s.w, s.h]} />
          <meshBasicMaterial color={COLOR_BRIGHT} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
};

export default ActiveFabBorder;
