/**
 * VehicleEdgeOverlay - 선택된 vehicle의 currentEdge / nextEdge / path 위에 오버레이를 그린다.
 * 기존 edge를 수정하지 않고, 동일한 위치에 z 오프셋으로 새 quad를 그린다.
 * LINEAR edge: 1개 quad, CURVE edge: renderingPoints 세그먼트만큼 quad.
 * Path edges: 점선 스타일 (current/next와 구분)
 */
import React, { useRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useEdgeStore } from "@/store/map/edgeStore";
import { useVehicleEdgeHighlightStore } from "@/store/ui/vehicleEdgeHighlightStore";
import { EdgeType, Edge } from "@/types";

/** quad 두께 (edge width) */
const QUAD_WIDTH = 0.3;
/** 최대 세그먼트 수 (curve edge: DEFAULT_SEGMENTS=100 → 101 points → 100 segments) */
const MAX_SEGMENTS = 128;
/** Path overlay: 최대 edge 수 × 세그먼트 */
const MAX_PATH_INSTANCES = 2048;

// vertex shader: 단순 instanced quad
const overlayVertexShader = /* glsl */ `
uniform float uTime;
uniform float uZOffset;
varying float vProgress;

void main() {
    vProgress = uv.x;
    vec4 instancePosition = instanceMatrix * vec4(position, 1.0);
    instancePosition.z += uZOffset;
    vec4 mvPosition = modelViewMatrix * instancePosition;
    gl_Position = projectionMatrix * mvPosition;
}
`;

// fragment shader: pulse glow (solid)
const overlayFragmentShader = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;

varying float vProgress;

void main() {
    float pulse = 0.75 + 0.25 * sin(uTime * 4.0);
    gl_FragColor = vec4(uColor * pulse, 0.9);
}
`;

// fragment shader: path edges (solid, slightly dimmer)
const pathFragmentShader = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;

varying float vProgress;

void main() {
    float pulse = 0.65 + 0.15 * sin(uTime * 3.0);
    gl_FragColor = vec4(uColor * pulse, 0.85);
}
`;

/** Reusable context for matrix computation */
interface MatrixCtx {
  matrix: THREE.Matrix4;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
  euler: THREE.Euler;
}

/**
 * edge의 renderingPoints를 기반으로 InstancedMesh에 quad를 설정한다.
 * @returns 실제 설정된 instance 수
 */
function buildEdgeOverlay(
  edge: Edge,
  mesh: THREE.InstancedMesh,
  ctx: MatrixCtx,
  startIdx = 0,
): number {
  const points = edge.renderingPoints;
  if (!points || points.length === 0) return 0;

  const isLinear = !edge.vos_rail_type || edge.vos_rail_type === EdgeType.LINEAR;

  if (isLinear) {
    const startPos = points[0];
    const endPos = points.at(-1)!;
    const length = startPos.distanceTo(endPos);
    if (length < 0.01) return 0;

    const cx = (startPos.x + endPos.x) / 2;
    const cy = (startPos.y + endPos.y) / 2;
    const cz = (startPos.z + endPos.z) / 2;
    const angle = Math.atan2(endPos.y - startPos.y, endPos.x - startPos.x);

    ctx.position.set(cx, cy, cz);
    ctx.euler.set(0, 0, angle);
    ctx.quaternion.setFromEuler(ctx.euler);
    ctx.scale.set(length, QUAD_WIDTH, 1);
    ctx.matrix.compose(ctx.position, ctx.quaternion, ctx.scale);

    mesh.setMatrixAt(startIdx, ctx.matrix);
    return 1;
  }

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
    const cz = (s.z + e.z) / 2;
    const angle = Math.atan2(e.y - s.y, e.x - s.x);

    ctx.position.set(cx, cy, cz);
    ctx.euler.set(0, 0, angle);
    ctx.quaternion.setFromEuler(ctx.euler);
    ctx.scale.set(length * 2, QUAD_WIDTH, 1);
    ctx.matrix.compose(ctx.position, ctx.quaternion, ctx.scale);

    mesh.setMatrixAt(startIdx + idx, ctx.matrix);
    idx++;
  }
  return idx;
}

/** 단일 edge 오버레이 mesh */
const EdgeOverlayMesh: React.FC<{
  color: string;
  zOffset: number;
  getEdgeIndex: () => number | null;
}> = ({ color, zOffset, getEdgeIndex }) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const prevEdgeIndexRef = useRef<number | null>(null);

  const geometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  const material = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uTime: { value: 0 },
      uZOffset: { value: zOffset },
    },
    vertexShader: overlayVertexShader,
    fragmentShader: overlayFragmentShader,
    transparent: true,
    side: THREE.DoubleSide,
    depthTest: true,
    depthWrite: false,
    depthFunc: THREE.LessEqualDepth,
  }), [color, zOffset]);

  const ctx = useMemo<MatrixCtx>(() => ({
    matrix: new THREE.Matrix4(),
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    scale: new THREE.Vector3(),
    euler: new THREE.Euler(),
  }), []);

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  useFrame((state) => {
    material.uniforms.uTime.value = state.clock.elapsedTime;

    const mesh = meshRef.current;
    if (!mesh) return;

    const edgeIndex = getEdgeIndex();

    if (edgeIndex === prevEdgeIndexRef.current) return;
    prevEdgeIndexRef.current = edgeIndex;

    if (edgeIndex === null || edgeIndex < 1) {
      mesh.count = 0;
      return;
    }

    const edges = useEdgeStore.getState().edges;
    const edge = edges[edgeIndex - 1];
    if (!edge) {
      mesh.count = 0;
      return;
    }

    const count = buildEdgeOverlay(edge, mesh, ctx);
    mesh.count = count;
    if (count > 0) {
      mesh.instanceMatrix.needsUpdate = true;
    }
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

/** Path edges 오버레이 (여러 edge를 한 mesh에) */
const PathOverlayMesh: React.FC = () => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const prevLenRef = useRef<number>(-1);
  const prevFirstRef = useRef<number>(-1);

  const geometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  const material = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color("#ff4444") }, // bright red
      uTime: { value: 0 },
      uZOffset: { value: 0.004 },
    },
    vertexShader: overlayVertexShader,
    fragmentShader: pathFragmentShader,
    transparent: true,
    side: THREE.DoubleSide,
    depthTest: true,
    depthWrite: false,
    depthFunc: THREE.LessEqualDepth,
  }), []);

  const ctx = useMemo<MatrixCtx>(() => ({
    matrix: new THREE.Matrix4(),
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    scale: new THREE.Vector3(),
    euler: new THREE.Euler(),
  }), []);

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  useFrame((state) => {
    material.uniforms.uTime.value = state.clock.elapsedTime;

    const mesh = meshRef.current;
    if (!mesh) return;

    const pathEdgeIndices = useVehicleEdgeHighlightStore.getState().pathEdgeIndices;
    const len = pathEdgeIndices.length;
    const first = len > 0 ? pathEdgeIndices[0] : -1;

    // 빠른 변경 감지: 길이 + 첫 번째 원소
    if (len === prevLenRef.current && first === prevFirstRef.current) return;
    prevLenRef.current = len;
    prevFirstRef.current = first;

    if (len === 0) {
      mesh.count = 0;
      return;
    }

    const edges = useEdgeStore.getState().edges;
    let totalCount = 0;

    for (const edgeIdx of pathEdgeIndices) {
      if (edgeIdx < 1 || totalCount >= MAX_PATH_INSTANCES) break;
      const edge = edges[edgeIdx - 1];
      if (!edge) continue;

      const count = buildEdgeOverlay(edge, mesh, ctx, totalCount);
      totalCount += count;
    }

    mesh.count = totalCount;
    if (totalCount > 0) {
      mesh.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, MAX_PATH_INSTANCES]}
      frustumCulled={false}
      renderOrder={9}
    />
  );
};

const VehicleEdgeOverlay: React.FC = () => {
  const getCurrentEdge = useMemo(() => {
    return () => useVehicleEdgeHighlightStore.getState().currentEdgeIndex;
  }, []);
  const getNextEdge = useMemo(() => {
    return () => useVehicleEdgeHighlightStore.getState().nextEdgeIndex;
  }, []);

  return (
    <group>
      <PathOverlayMesh />
      <EdgeOverlayMesh color="#4cff72" zOffset={0.003} getEdgeIndex={getCurrentEdge} />
      <EdgeOverlayMesh color="#ffd740" zOffset={0.002} getEdgeIndex={getNextEdge} />
    </group>
  );
};

export default VehicleEdgeOverlay;
