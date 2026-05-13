import React, { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
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

interface PerimeterSegment {
  x: number;
  y: number;
  w: number;
  h: number;
}

// L-shape bracket with arms extending +x (length D) and +y (length D), thickness t.
// Outer corner at (-r, -r), inner elbow softened with a small concave arc.
// Outer arm tips are rounded (semicircular caps). CCW winding from outer corner.
function makeCornerL(D: number, t: number): THREE.Shape {
  const r = t / 2;
  const iR = Math.min(r * 0.5, D * 0.3); // inner elbow round radius
  const shape = new THREE.Shape();
  shape.moveTo(-r, -r);
  shape.lineTo(D - r, -r);
  // Right cap of horizontal arm
  shape.absarc(D - r, 0, r, -Math.PI / 2, Math.PI / 2, false);
  shape.lineTo(r + iR, r);
  // Inner elbow (concave, CW since the polygon is CCW)
  shape.absarc(r + iR, r + iR, iR, -Math.PI / 2, Math.PI, true);
  shape.lineTo(r, D - r);
  // Top cap of vertical arm
  shape.absarc(0, D - r, r, 0, Math.PI, false);
  shape.lineTo(-r, -r);
  return shape;
}

// Stadium (rounded-pill) shape for thin perimeter lines.
function makeStadium(w: number, h: number): THREE.Shape {
  const shape = new THREE.Shape();
  if (w >= h) {
    const r = h / 2;
    const hr = Math.max(0, w / 2 - r);
    shape.moveTo(-hr, -r);
    shape.lineTo(hr, -r);
    shape.absarc(hr, 0, r, -Math.PI / 2, Math.PI / 2, false);
    shape.lineTo(-hr, r);
    shape.absarc(-hr, 0, r, Math.PI / 2, 3 * Math.PI / 2, false);
  } else {
    const r = w / 2;
    const hr = Math.max(0, h / 2 - r);
    shape.moveTo(-r, -hr);
    shape.absarc(0, -hr, r, Math.PI, 2 * Math.PI, false);
    shape.lineTo(r, hr);
    shape.absarc(0, hr, r, 0, Math.PI, false);
  }
  return shape;
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

  // One L-shape per layer (bright/glow), shared across 4 corners via mesh scale.
  const brightShape = useMemo(
    () => (bounds ? makeCornerL(bounds.cornerLen, CORNER_THICKNESS) : null),
    [bounds],
  );
  const glowShape = useMemo(
    () => (bounds ? makeCornerL(bounds.cornerLen, CORNER_GLOW_THICKNESS) : null),
    [bounds],
  );

  // 4 corner placements. scale flips the L's arm direction.
  const cornerConfigs = useMemo(() => {
    if (!bounds) return [];
    return [
      { key: "bl", x: bounds.xMin, y: bounds.yMin, sx: 1, sy: 1 },
      { key: "br", x: bounds.xMax, y: bounds.yMin, sx: -1, sy: 1 },
      { key: "tl", x: bounds.xMin, y: bounds.yMax, sx: 1, sy: -1 },
      { key: "tr", x: bounds.xMax, y: bounds.yMax, sx: -1, sy: -1 },
    ];
  }, [bounds]);

  const perimeterSegments = useMemo<PerimeterSegment[]>(() => {
    if (!bounds) return [];
    const { xMin, xMax, yMin, yMax, width, height, centerX, centerY } = bounds;
    const t = LINE_THICKNESS;
    const w = Math.max(0, width - LINE_INSET * 2);
    const h = Math.max(0, height - LINE_INSET * 2);
    return [
      { x: centerX, y: yMin, w, h: t },
      { x: centerX, y: yMax, w, h: t },
      { x: xMin, y: centerY, w: t, h },
      { x: xMax, y: centerY, w: t, h },
    ];
  }, [bounds]);

  const perimeterShapes = useMemo(
    () => perimeterSegments.map((s) => makeStadium(s.w, s.h)),
    [perimeterSegments],
  );

  const glowRef = useRef<THREE.Mesh[]>([]);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const pulse = 0.45 + Math.sin(t * 2.2) * 0.18;
    for (const mesh of glowRef.current) {
      if (!mesh) continue;
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = pulse;
    }
  });

  if (!bounds || !brightShape || !glowShape) return null;

  return (
    <group position={[0, 0, BORDER_Z]}>
      {/* Soft perimeter line (faint, stadium-shaped) */}
      {perimeterSegments.map((s, i) => (
        <mesh key={`p-${i}`} position={[s.x, s.y, 0]}>
          <shapeGeometry args={[perimeterShapes[i]]} />
          <meshBasicMaterial
            color={COLOR_GLOW}
            transparent
            opacity={LINE_OPACITY}
            toneMapped={false}
            depthWrite={false}
          />
        </mesh>
      ))}

      {/* Corner glow L (wide, soft, animated) */}
      {cornerConfigs.map((c, i) => (
        <mesh
          key={`g-${c.key}`}
          position={[c.x, c.y, 0.001]}
          scale={[c.sx, c.sy, 1]}
          ref={(el) => {
            if (el) glowRef.current[i] = el;
          }}
        >
          <shapeGeometry args={[glowShape]} />
          <meshBasicMaterial
            color={COLOR_GLOW}
            transparent
            opacity={0.5}
            toneMapped={false}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}

      {/* Corner bracket L (sharp, bright) */}
      {cornerConfigs.map((c) => (
        <mesh
          key={`c-${c.key}`}
          position={[c.x, c.y, 0.002]}
          scale={[c.sx, c.sy, 1]}
        >
          <shapeGeometry args={[brightShape]} />
          <meshBasicMaterial color={COLOR_BRIGHT} toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  );
};

export default ActiveFabBorder;
