/**
 * VehicleEdgeOverlay - 선택된 vehicle의 currentEdge 위에 색칠된 오버레이를 그린다.
 * 기존 edge를 수정하지 않고, 동일한 위치에 z+0.001 높이로 새 quad를 그린다.
 * LINEAR edge: 1개 quad, CURVE edge: renderingPoints 세그먼트만큼 quad.
 */
import React, { useRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useEdgeStore } from "@/store/map/edgeStore";
import { useVehicleEdgeHighlightStore } from "@/store/ui/vehicleEdgeHighlightStore";
import { EdgeType } from "@/types";

/** 오버레이 Z 오프셋 */
const Z_OFFSET = 0.002;
/** quad 두께 (edge width) */
const QUAD_WIDTH = 0.3;
/** 최대 세그먼트 수 (curve edge: DEFAULT_SEGMENTS=100 → 101 points → 100 segments) */
const MAX_SEGMENTS = 128;

// 오버레이 색상
const CURRENT_EDGE_COLOR = new THREE.Color("#4cff72");

// vertex shader: 단순 instanced quad
const overlayVertexShader = /* glsl */ `
uniform float uTime;
varying float vProgress;

void main() {
    vProgress = uv.x;
    vec4 instancePosition = instanceMatrix * vec4(position, 1.0);
    vec4 mvPosition = modelViewMatrix * instancePosition;
    gl_Position = projectionMatrix * mvPosition;
}
`;

// fragment shader: pulse glow
const overlayFragmentShader = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;

varying float vProgress;

void main() {
    float pulse = 0.75 + 0.25 * sin(uTime * 4.0);
    gl_FragColor = vec4(uColor * pulse, 0.9);
}
`;

const VehicleEdgeOverlay: React.FC = () => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const prevEdgeIndexRef = useRef<number | null>(null);

  const geometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  const material = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: CURRENT_EDGE_COLOR },
      uTime: { value: 0 },
    },
    vertexShader: overlayVertexShader,
    fragmentShader: overlayFragmentShader,
    transparent: true,
    side: THREE.DoubleSide,
    depthTest: true,
    depthWrite: false,
    depthFunc: THREE.LessEqualDepth,
  }), []);

  // Reusable Three.js objects
  const ctx = useMemo(() => ({
    matrix: new THREE.Matrix4(),
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    scale: new THREE.Vector3(),
    euler: new THREE.Euler(),
  }), []);

  // Cleanup
  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  // Subscribe to store via useFrame (no React re-render)
  useFrame((state) => {
    material.uniforms.uTime.value = state.clock.elapsedTime;

    const mesh = meshRef.current;
    if (!mesh) return;

    const { currentEdgeIndex } = useVehicleEdgeHighlightStore.getState();

    // 변화 없으면 skip
    if (currentEdgeIndex === prevEdgeIndexRef.current) return;
    prevEdgeIndexRef.current = currentEdgeIndex;

    // 하이라이트 없으면 숨기기
    if (currentEdgeIndex === null || currentEdgeIndex < 1) {
      mesh.count = 0;
      return;
    }

    // edge 조회 (1-based → 0-based)
    const edges = useEdgeStore.getState().edges;
    const edge = edges[currentEdgeIndex - 1];
    if (!edge || !edge.renderingPoints || edge.renderingPoints.length === 0) {
      mesh.count = 0;
      return;
    }

    const points = edge.renderingPoints;
    const isLinear = !edge.vos_rail_type || edge.vos_rail_type === EdgeType.LINEAR;

    if (isLinear) {
      // LINEAR: 1개 quad
      const startPos = points[0];
      const endPos = points.at(-1)!;
      const length = startPos.distanceTo(endPos);
      if (length < 0.01) { mesh.count = 0; return; }

      const cx = (startPos.x + endPos.x) / 2;
      const cy = (startPos.y + endPos.y) / 2;
      const cz = (startPos.z + endPos.z) / 2 + Z_OFFSET;
      const angle = Math.atan2(endPos.y - startPos.y, endPos.x - startPos.x);

      ctx.position.set(cx, cy, cz);
      ctx.euler.set(0, 0, angle);
      ctx.quaternion.setFromEuler(ctx.euler);
      ctx.scale.set(length, QUAD_WIDTH, 1);
      ctx.matrix.compose(ctx.position, ctx.quaternion, ctx.scale);

      mesh.setMatrixAt(0, ctx.matrix);
      mesh.count = 1;
    } else {
      // CURVE: 세그먼트별 quad
      const segCount = Math.min(points.length - 1, MAX_SEGMENTS);
      let idx = 0;

      for (let i = 0; i < segCount; i++) {
        const s = points[i];
        const e = points[i + 1];
        const length = s.distanceTo(e);
        if (length < 0.001) continue;

        const cx = (s.x + e.x) / 2;
        const cy = (s.y + e.y) / 2;
        const cz = (s.z + e.z) / 2 + Z_OFFSET;
        const angle = Math.atan2(e.y - s.y, e.x - s.x);

        ctx.position.set(cx, cy, cz);
        ctx.euler.set(0, 0, angle);
        ctx.quaternion.setFromEuler(ctx.euler);
        // curve segments use length*2 scale like EdgeRenderer
        ctx.scale.set(length * 2, QUAD_WIDTH, 1);
        ctx.matrix.compose(ctx.position, ctx.quaternion, ctx.scale);

        mesh.setMatrixAt(idx, ctx.matrix);
        idx++;
      }
      mesh.count = idx;
    }

    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, MAX_SEGMENTS]}
      frustumCulled={false}
      renderOrder={10}
    />
  );
};

export default VehicleEdgeOverlay;
