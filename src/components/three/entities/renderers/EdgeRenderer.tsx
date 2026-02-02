// EdgeRenderer.tsx - InstancedMesh 통합 버전 (슬롯 기반 렌더링)
import React, { useRef, useEffect, useMemo, useCallback } from "react";
import { useFrame } from "@react-three/fiber";
import { Edge, EdgeType } from "@/types";
import { getEdgeColors as getEdgeColorConfig, getEdgeConfig } from "@/config/renderConfig";
import { useFabStore } from "@/store/map/fabStore";
import { useEdgeControlStore } from "@/store/ui/edgeControlStore";
import * as THREE from "three";
import edgeVertexShader from "../edge/shaders/edgeVertex.glsl?raw";
import edgeFragmentShader from "../edge/shaders/edgeFragment.glsl?raw";
import {
  RENDER_ORDER_RAIL_CURVE_180,
  RENDER_ORDER_RAIL_CURVE_90,
  RENDER_ORDER_RAIL_CURVE_CSC,
  RENDER_ORDER_RAIL_LINEAR,
} from "@/utils/renderOrder";

// Selected edge highlight color from config
const getSelectedEdgeColor = () => getEdgeConfig().selectedColor;

// ============================================================
// Helper Types & Functions
// ============================================================

interface EdgeWithIndex {
  edge: Edge;
  originalIndex: number;
}

interface InstanceMappingResult {
  instanceCount: number;
  edgeToInstanceMap: Map<number, { start: number; count: number }>;
}

/** Matrix 설정에 사용되는 Three.js 객체들 */
interface MatrixContext {
  matrix: THREE.Matrix4;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
  euler: THREE.Euler;
}

/**
 * Edge→Instance 매핑 빌드 (LINEAR vs CURVE 분기)
 */
function buildEdgeInstanceMapping(
  edgesWithIndex: EdgeWithIndex[],
  edgeType: EdgeType
): InstanceMappingResult {
  const mapping = new Map<number, { start: number; count: number }>();
  let total = 0;

  if (edgeType === EdgeType.LINEAR) {
    for (const { edge, originalIndex } of edgesWithIndex) {
      if (edge.renderingPoints && edge.renderingPoints.length > 0) {
        const startPos = edge.renderingPoints[0];
        const endPos = edge.renderingPoints.at(-1)!;
        const length = startPos.distanceTo(endPos);
        if (length >= 0.01) {
          mapping.set(originalIndex, { start: total, count: 1 });
          total++;
        }
      }
    }
  } else {
    for (const { edge, originalIndex } of edgesWithIndex) {
      const segmentCount = Math.max(0, (edge.renderingPoints?.length || 0) - 1);
      if (segmentCount > 0) {
        mapping.set(originalIndex, { start: total, count: segmentCount });
        total += segmentCount;
      }
    }
  }

  return { instanceCount: total, edgeToInstanceMap: mapping };
}

/**
 * LINEAR edge의 행렬 설정 (단일 인스턴스)
 * @returns 행렬이 설정되었으면 true, skip되었으면 false
 */
function setLinearEdgeMatrix(
  points: THREE.Vector3[],
  ctx: MatrixContext,
  mesh: THREE.InstancedMesh,
  instanceIndex: number
): boolean {
  const startPos = points[0];
  const endPos = points.at(-1)!;

  const length = startPos.distanceTo(endPos);
  if (length < 0.01) return false;

  const centerX = (startPos.x + endPos.x) / 2;
  const centerY = (startPos.y + endPos.y) / 2;
  const centerZ = (startPos.z + endPos.z) / 2;
  const angle = Math.atan2(endPos.y - startPos.y, endPos.x - startPos.x);

  ctx.position.set(centerX, centerY, centerZ);
  ctx.euler.set(0, 0, angle);
  ctx.quaternion.setFromEuler(ctx.euler);
  ctx.scale.set(length, 0.25, 1);

  ctx.matrix.compose(ctx.position, ctx.quaternion, ctx.scale);
  mesh.setMatrixAt(instanceIndex, ctx.matrix);
  return true;
}

/**
 * CURVE edge의 행렬 설정 (세그먼트별 다중 인스턴스)
 * @returns 설정된 인스턴스 수
 */
function setCurveEdgeMatrices(
  points: THREE.Vector3[],
  ctx: MatrixContext,
  mesh: THREE.InstancedMesh,
  startInstanceIndex: number
): number {
  const segmentCount = points.length - 1;
  let added = 0;

  for (let i = 0; i < segmentCount; i++) {
    const start = points[i];
    const end = points[i + 1];

    const centerX = (start.x + end.x) / 2;
    const centerY = (start.y + end.y) / 2;
    const centerZ = (start.z + end.z) / 2;

    const length = start.distanceTo(end);
    const angle = Math.atan2(end.y - start.y, end.x - start.x);

    ctx.position.set(centerX, centerY, centerZ);
    ctx.euler.set(0, 0, angle);
    ctx.quaternion.setFromEuler(ctx.euler);
    ctx.scale.set(length * 2, 0.25, 1);

    ctx.matrix.compose(ctx.position, ctx.quaternion, ctx.scale);
    mesh.setMatrixAt(startInstanceIndex + added, ctx.matrix);
    added++;
  }

  return added;
}

// ============================================================
// Components
// ============================================================

interface EdgeRendererProps {
  edges: Edge[];
}

const EdgeRenderer: React.FC<EdgeRendererProps> = ({
  edges,
}) => {
  const colors = getEdgeColorConfig();
  const slots = useFabStore((state) => state.slots);
  const fabs = useFabStore((state) => state.fabs);

  // Group edges by type with original indices (원본 데이터 기준)
  const edgesByType = useMemo(() => {
    const grouped: Record<string, { edge: Edge; originalIndex: number }[]> = {
      [EdgeType.LINEAR]: [],
      [EdgeType.CURVE_90]: [],
      [EdgeType.CURVE_180]: [],
      [EdgeType.CURVE_CSC]: [],
      [EdgeType.S_CURVE]: [],
    };

    for (const [originalIndex, edge] of edges.entries()) {
      if (edge.rendering_mode === "preview") continue;

      if (edge.renderingPoints && edge.renderingPoints.length > 0) {
        const type = edge.vos_rail_type || EdgeType.LINEAR;
        if (grouped[type]) {
          grouped[type].push({ edge, originalIndex });
        }
      }
    }

    return grouped;
  }, [edges]);

  // Subscribe to selected edge from store
  const selectedEdgeIndex = useEdgeControlStore((state) => state.selectedEdgeIndex);
  const selectedFabIndex = useEdgeControlStore((state) => state.selectedFabIndex);

  // 단일 fab이거나 슬롯이 없으면 기본 렌더링
  if (fabs.length <= 1 || slots.length === 0) {
    return (
      <group>
        <EdgeTypeRenderer
          edgesWithIndex={edgesByType[EdgeType.LINEAR]}
          edgeType={EdgeType.LINEAR}
          color={colors.LINEAR}
          renderOrder={RENDER_ORDER_RAIL_LINEAR}
          selectedEdgeIndex={selectedEdgeIndex}
        />
        <EdgeTypeRenderer
          edgesWithIndex={edgesByType[EdgeType.CURVE_90]}
          edgeType={EdgeType.CURVE_90}
          color={colors.CURVE_90}
          renderOrder={RENDER_ORDER_RAIL_CURVE_90}
          selectedEdgeIndex={selectedEdgeIndex}
        />
        <EdgeTypeRenderer
          edgesWithIndex={edgesByType[EdgeType.CURVE_180]}
          edgeType={EdgeType.CURVE_180}
          color={colors.CURVE_180}
          renderOrder={RENDER_ORDER_RAIL_CURVE_180}
          selectedEdgeIndex={selectedEdgeIndex}
        />
        <EdgeTypeRenderer
          edgesWithIndex={edgesByType[EdgeType.CURVE_CSC]}
          edgeType={EdgeType.CURVE_CSC}
          color={colors.CURVE_CSC}
          renderOrder={RENDER_ORDER_RAIL_CURVE_CSC}
          selectedEdgeIndex={selectedEdgeIndex}
        />
        <EdgeTypeRenderer
          edgesWithIndex={edgesByType[EdgeType.S_CURVE]}
          edgeType={EdgeType.S_CURVE}
          color={colors.S_CURVE}
          renderOrder={RENDER_ORDER_RAIL_CURVE_90}
          selectedEdgeIndex={selectedEdgeIndex}
        />
      </group>
    );
  }

  // 멀티 fab: 슬롯 기반 렌더링 (각 슬롯마다 offset 적용)
  return (
    <group>
      {slots.map((slot, slotIndex) => {
        // Only highlight in the selected fab
        const effectiveSelectedIndex = slotIndex === selectedFabIndex ? selectedEdgeIndex : null;
        return (
          <group key={slot.slotId} position={[slot.offsetX, slot.offsetY, 0]}>
            <EdgeTypeRenderer
              edgesWithIndex={edgesByType[EdgeType.LINEAR]}
              edgeType={EdgeType.LINEAR}
              color={colors.LINEAR}
              renderOrder={RENDER_ORDER_RAIL_LINEAR}
              selectedEdgeIndex={effectiveSelectedIndex}
            />
            <EdgeTypeRenderer
              edgesWithIndex={edgesByType[EdgeType.CURVE_90]}
              edgeType={EdgeType.CURVE_90}
              color={colors.CURVE_90}
              renderOrder={RENDER_ORDER_RAIL_CURVE_90}
              selectedEdgeIndex={effectiveSelectedIndex}
            />
            <EdgeTypeRenderer
              edgesWithIndex={edgesByType[EdgeType.CURVE_180]}
              edgeType={EdgeType.CURVE_180}
              color={colors.CURVE_180}
              renderOrder={RENDER_ORDER_RAIL_CURVE_180}
              selectedEdgeIndex={effectiveSelectedIndex}
            />
            <EdgeTypeRenderer
              edgesWithIndex={edgesByType[EdgeType.CURVE_CSC]}
              edgeType={EdgeType.CURVE_CSC}
              color={colors.CURVE_CSC}
              renderOrder={RENDER_ORDER_RAIL_CURVE_CSC}
              selectedEdgeIndex={effectiveSelectedIndex}
            />
            <EdgeTypeRenderer
              edgesWithIndex={edgesByType[EdgeType.S_CURVE]}
              edgeType={EdgeType.S_CURVE}
              color={colors.S_CURVE}
              renderOrder={RENDER_ORDER_RAIL_CURVE_90}
              selectedEdgeIndex={effectiveSelectedIndex}
            />
          </group>
        );
      })}
    </group>
  );
};

interface EdgeTypeRendererProps {
  edgesWithIndex: EdgeWithIndex[];
  edgeType: EdgeType;
  color: string;
  renderOrder: number;
  selectedEdgeIndex: number | null;
}

const EdgeTypeRenderer: React.FC<EdgeTypeRendererProps> = ({
  edgesWithIndex,
  edgeType,
  color,
  renderOrder,
  selectedEdgeIndex,
}) => {
  const instancedMeshRef = useRef<THREE.InstancedMesh>(null);
  const selectedAttrRef = useRef<THREE.InstancedBufferAttribute | null>(null);
  const prevInstanceCountRef = useRef(0);
  const prevSelectedRef = useRef<number | null>(null);

  // Calculate total instance count and build edge→instance mapping
  const { instanceCount, edgeToInstanceMap } = useMemo(
    () => buildEdgeInstanceMapping(edgesWithIndex, edgeType),
    [edgesWithIndex, edgeType]
  );

  const geometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);

  const shaderMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(color) },
        uSelectedColor: { value: new THREE.Color(getSelectedEdgeColor()) },
        uOpacity: { value: 1 },
        uIsPreview: { value: 0 },
        uLength: { value: 1 },
      },
      vertexShader: edgeVertexShader,
      fragmentShader: edgeFragmentShader,
      transparent: true,
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: true,
      depthFunc: THREE.LessEqualDepth,
    });
  }, [color]);

  // Create selected attribute
  useEffect(() => {
    const mesh = instancedMeshRef.current;
    if (!mesh || instanceCount === 0) return;

    const selectedArray = new Float32Array(instanceCount).fill(0);
    const attr = new THREE.InstancedBufferAttribute(selectedArray, 1);
    attr.setUsage(THREE.DynamicDrawUsage);
    mesh.geometry.setAttribute("aSelected", attr);
    selectedAttrRef.current = attr;

    return () => {
      mesh.geometry.deleteAttribute("aSelected");
      selectedAttrRef.current = null;
    };
  }, [instanceCount]);

  // Update selected state (no React re-render, just GPU buffer update)
  const updateSelectedState = useCallback((newSelectedIndex: number | null) => {
    const attr = selectedAttrRef.current;
    if (!attr) return;

    const array = attr.array as Float32Array;

    // Clear previous selection
    if (prevSelectedRef.current !== null) {
      const prevInfo = edgeToInstanceMap.get(prevSelectedRef.current);
      if (prevInfo) {
        for (let i = 0; i < prevInfo.count; i++) {
          array[prevInfo.start + i] = 0;
        }
      }
    }

    // Set new selection
    if (newSelectedIndex !== null) {
      const info = edgeToInstanceMap.get(newSelectedIndex);
      if (info) {
        for (let i = 0; i < info.count; i++) {
          array[info.start + i] = 1;
        }
      }
    }

    attr.needsUpdate = true;
    prevSelectedRef.current = newSelectedIndex;
  }, [edgeToInstanceMap]);

  // React to selectedEdgeIndex changes
  useEffect(() => {
    updateSelectedState(selectedEdgeIndex);
  }, [selectedEdgeIndex, updateSelectedState]);

  // Update instance matrices (원본 데이터만 처리, fab visibility 없음)
  useEffect(() => {
    const mesh = instancedMeshRef.current;
    if (!mesh || instanceCount === 0) return;

    const ctx: MatrixContext = {
      matrix: new THREE.Matrix4(),
      position: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
      scale: new THREE.Vector3(),
      euler: new THREE.Euler(),
    };

    let instanceIndex = 0;

    for (const { edge } of edgesWithIndex) {
      const points = edge.renderingPoints;
      if (!points || points.length === 0) continue;

      if (edgeType === EdgeType.LINEAR) {
        if (setLinearEdgeMatrix(points, ctx, mesh, instanceIndex)) {
          instanceIndex++;
        }
      } else {
        instanceIndex += setCurveEdgeMatrices(points, ctx, mesh, instanceIndex);
      }
    }

    mesh.instanceMatrix.needsUpdate = true;
  }, [edgesWithIndex, edgeType, instanceCount]);

  // Cleanup when data is deleted (instanceCount decreases)
  useEffect(() => {
    if (prevInstanceCountRef.current > instanceCount && instanceCount === 0) {
      // Data was deleted - cleanup resources
      geometry.dispose();
      shaderMaterial.dispose();
    }
    prevInstanceCountRef.current = instanceCount;
  }, [instanceCount, geometry, shaderMaterial, edgeType]);

  // Cleanup geometry and material when component unmounts
  useEffect(() => {
    return () => {
      geometry.dispose();
      shaderMaterial.dispose();
    };
  }, [geometry, shaderMaterial]);

  // Single useFrame for all edges of this type
  useFrame((state) => {
    if (shaderMaterial.uniforms.uTime) {
      shaderMaterial.uniforms.uTime.value = state.clock.elapsedTime;
    }
  });

  if (instanceCount === 0) {
    return null;
  }

  return (
    <instancedMesh
      ref={instancedMeshRef}
      args={[geometry, shaderMaterial, instanceCount]}
      frustumCulled={false}
      renderOrder={renderOrder}
    />
  );
};

export default EdgeRenderer;
