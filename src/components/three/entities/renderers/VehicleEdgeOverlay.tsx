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
  tmpVec: THREE.Vector3;
}

/**
 * edge의 renderingPoints를 기반으로 InstancedMesh에 quad를 설정한다.
 * @param endRatio edge를 어디까지 그릴지 (0~1). 1이면 전체. 목적지 edge는
 *                 station 위치 ratio까지만 그려서 "역 끝까지"가 아닌 "역까지"만 칠한다.
 * @returns 실제 설정된 instance 수
 */
function buildEdgeOverlay(
  edge: Edge,
  mesh: THREE.InstancedMesh,
  ctx: MatrixCtx,
  startIdx = 0,
  endRatio = 1,
): number {
  const points = edge.renderingPoints;
  if (!points || points.length === 0) return 0;
  if (endRatio <= 0) return 0;

  const isLinear = !edge.vos_rail_type || edge.vos_rail_type === EdgeType.LINEAR;

  if (isLinear) {
    const startPos = points[0];
    const fullEnd = points.at(-1)!;
    // 목적지 edge면 start→ratio 지점까지만
    const endPos = endRatio >= 1
      ? fullEnd
      : ctx.tmpVec.copy(startPos).lerp(fullEnd, endRatio);
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
  const fullSeg = points.length - 1;
  const segCap = Math.min(fullSeg, MAX_SEGMENTS);
  // 잘라낼 위치 (float 세그먼트 인덱스). endRatio<1 이면 그 비율까지만.
  const limit = endRatio >= 1 ? segCap : Math.min(segCap, endRatio * fullSeg);
  let idx = 0;

  for (let i = 0; i < segCap; i++) {
    if (i >= limit) break;
    const s = points[i];
    let e: THREE.Vector3;
    if (i + 1 <= limit) {
      e = points[i + 1];
    } else {
      // 마지막 부분 세그먼트: i ~ i+1 사이를 (limit - i) 만큼만
      const frac = limit - i;
      if (frac < 0.001) break;
      e = ctx.tmpVec.copy(points[i]).lerp(points[i + 1], frac);
    }
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
  const prevEndRatioRef = useRef<number>(1);

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
    // depthTest 유지: 차량 본체 등 진짜 위에 있는 geometry에는 정상적으로 가려짐
    depthTest: true,
    depthWrite: false,
    // polygonOffset: 같은 평면의 일반 edge는 항상 덮음 (슬로프 기반이라 곡선 각도 무관).
    // 차량처럼 실제 Z가 떨어진 geometry는 못 이기므로 차량 본체는 가리지 않음.
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  }), [color, zOffset]);

  const ctx = useMemo<MatrixCtx>(() => ({
    matrix: new THREE.Matrix4(),
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    scale: new THREE.Vector3(),
    euler: new THREE.Euler(),
    tmpVec: new THREE.Vector3(),
  }), []);

  // InstancedMesh boots with count=MAX_SEGMENTS and zero matrices → all instances
  // collapse to origin and render as a flickering blob there. Reset to 0 on mount.
  useEffect(() => {
    if (meshRef.current) meshRef.current.count = 0;
  }, []);

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

    // 이 edge가 목적지 edge면 station ratio까지만 그림
    const hl = useVehicleEdgeHighlightStore.getState();
    const endRatio = edgeIndex !== null && edgeIndex === hl.destEdgeIndex ? hl.destRatio : 1;

    if (edgeIndex === prevEdgeIndexRef.current && endRatio === prevEndRatioRef.current) return;
    prevEdgeIndexRef.current = edgeIndex;
    prevEndRatioRef.current = endRatio;

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

    const count = buildEdgeOverlay(edge, mesh, ctx, 0, endRatio);
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
  const prevDestEdgeRef = useRef<number | null>(null);
  const prevDestRatioRef = useRef<number>(1);

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
    // depthTest 유지 + polygonOffset: 일반 edge는 덮되 차량 본체엔 가려짐
    depthTest: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  }), []);

  const ctx = useMemo<MatrixCtx>(() => ({
    matrix: new THREE.Matrix4(),
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    scale: new THREE.Vector3(),
    euler: new THREE.Euler(),
    tmpVec: new THREE.Vector3(),
  }), []);

  // Avoid the 1-frame origin-flicker before useFrame initializes count=0
  useEffect(() => {
    if (meshRef.current) meshRef.current.count = 0;
  }, []);

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

    const hl = useVehicleEdgeHighlightStore.getState();
    const pathEdgeIndices = hl.pathEdgeIndices;
    const destEdgeIndex = hl.destEdgeIndex;
    const destRatio = hl.destRatio;
    const len = pathEdgeIndices.length;
    const first = len > 0 ? pathEdgeIndices[0] : -1;

    // 빠른 변경 감지: 길이 + 첫 번째 원소 + 목적지
    if (
      len === prevLenRef.current &&
      first === prevFirstRef.current &&
      destEdgeIndex === prevDestEdgeRef.current &&
      destRatio === prevDestRatioRef.current
    ) return;
    prevLenRef.current = len;
    prevFirstRef.current = first;
    prevDestEdgeRef.current = destEdgeIndex;
    prevDestRatioRef.current = destRatio;

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

      // 목적지 edge면 station ratio까지만
      const endRatio = edgeIdx === destEdgeIndex ? destRatio : 1;
      const count = buildEdgeOverlay(edge, mesh, ctx, totalCount, endRatio);
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
