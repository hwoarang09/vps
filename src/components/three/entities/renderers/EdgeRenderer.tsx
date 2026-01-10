// EdgeRenderer.tsx - InstancedMesh 통합 버전 (슬롯 기반 렌더링)
import React, { useRef, useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { Edge, EdgeType } from "@/types";
import { getEdgeColorConfig } from "@/config/mapConfig";
import { useFabStore } from "@/store/map/fabStore";
import * as THREE from "three";
import edgeVertexShader from "../edge/shaders/edgeVertex.glsl?raw";
import edgeFragmentShader from "../edge/shaders/edgeFragment.glsl?raw";
import {
  RENDER_ORDER_RAIL_CURVE_180,
  RENDER_ORDER_RAIL_CURVE_90,
  RENDER_ORDER_RAIL_CURVE_CSC,
  RENDER_ORDER_RAIL_LINEAR,
} from "@/utils/renderOrder";

interface EdgeRendererProps {
  edges: Edge[];
}

const EdgeRenderer: React.FC<EdgeRendererProps> = ({
  edges,
}) => {
  const colors = getEdgeColorConfig();
  const slots = useFabStore((state) => state.slots);
  const fabs = useFabStore((state) => state.fabs);

  // Group edges by type (원본 데이터 기준)
  const edgesByType = useMemo(() => {
    const grouped: Record<string, Edge[]> = {
      [EdgeType.LINEAR]: [],
      [EdgeType.CURVE_90]: [],
      [EdgeType.CURVE_180]: [],
      [EdgeType.CURVE_CSC]: [],
      [EdgeType.S_CURVE]: [],
    };

    for (const edge of edges) {
      if (edge.rendering_mode === "preview") continue;

      if (edge.renderingPoints && edge.renderingPoints.length > 0) {
        const type = edge.vos_rail_type || EdgeType.LINEAR;
        if (grouped[type]) {
          grouped[type].push(edge);
        }
      }
    }

    return grouped;
  }, [edges]);

  // 단일 fab이거나 슬롯이 없으면 기본 렌더링
  if (fabs.length <= 1 || slots.length === 0) {
    return (
      <group>
        <EdgeTypeRenderer
          edges={edgesByType[EdgeType.LINEAR]}
          edgeType={EdgeType.LINEAR}
          color={colors.LINEAR}
          renderOrder={RENDER_ORDER_RAIL_LINEAR}
        />
        <EdgeTypeRenderer
          edges={edgesByType[EdgeType.CURVE_90]}
          edgeType={EdgeType.CURVE_90}
          color={colors.CURVE_90}
          renderOrder={RENDER_ORDER_RAIL_CURVE_90}
        />
        <EdgeTypeRenderer
          edges={edgesByType[EdgeType.CURVE_180]}
          edgeType={EdgeType.CURVE_180}
          color={colors.CURVE_180}
          renderOrder={RENDER_ORDER_RAIL_CURVE_180}
        />
        <EdgeTypeRenderer
          edges={edgesByType[EdgeType.CURVE_CSC]}
          edgeType={EdgeType.CURVE_CSC}
          color={colors.CURVE_CSC}
          renderOrder={RENDER_ORDER_RAIL_CURVE_CSC}
        />
        <EdgeTypeRenderer
          edges={edgesByType[EdgeType.S_CURVE]}
          edgeType={EdgeType.S_CURVE}
          color={colors.S_CURVE}
          renderOrder={RENDER_ORDER_RAIL_CURVE_90}
        />
      </group>
    );
  }

  // 멀티 fab: 슬롯 기반 렌더링 (각 슬롯마다 offset 적용)
  return (
    <group>
      {slots.map((slot) => (
        <group key={slot.slotId} position={[slot.offsetX, slot.offsetY, 0]}>
          <EdgeTypeRenderer
            edges={edgesByType[EdgeType.LINEAR]}
            edgeType={EdgeType.LINEAR}
            color={colors.LINEAR}
            renderOrder={RENDER_ORDER_RAIL_LINEAR}
          />
          <EdgeTypeRenderer
            edges={edgesByType[EdgeType.CURVE_90]}
            edgeType={EdgeType.CURVE_90}
            color={colors.CURVE_90}
            renderOrder={RENDER_ORDER_RAIL_CURVE_90}
          />
          <EdgeTypeRenderer
            edges={edgesByType[EdgeType.CURVE_180]}
            edgeType={EdgeType.CURVE_180}
            color={colors.CURVE_180}
            renderOrder={RENDER_ORDER_RAIL_CURVE_180}
          />
          <EdgeTypeRenderer
            edges={edgesByType[EdgeType.CURVE_CSC]}
            edgeType={EdgeType.CURVE_CSC}
            color={colors.CURVE_CSC}
            renderOrder={RENDER_ORDER_RAIL_CURVE_CSC}
          />
          <EdgeTypeRenderer
            edges={edgesByType[EdgeType.S_CURVE]}
            edgeType={EdgeType.S_CURVE}
            color={colors.S_CURVE}
            renderOrder={RENDER_ORDER_RAIL_CURVE_90}
          />
        </group>
      ))}
    </group>
  );
};

interface EdgeTypeRendererProps {
  edges: Edge[];
  edgeType: EdgeType;
  color: string;
  renderOrder: number;
}

const EdgeTypeRenderer: React.FC<EdgeTypeRendererProps> = ({
  edges,
  edgeType,
  color,
  renderOrder,
}) => {
  const instancedMeshRef = useRef<THREE.InstancedMesh>(null);

  // Calculate total instance count based on edge type
  const instanceCount = useMemo(() => {
    if (edgeType === EdgeType.LINEAR) {
      return edges.length; // 1 instance per edge
    } else {
      // For curves, count segments
      return edges.reduce((total, edge) => {
        const segmentCount = Math.max(0, (edge.renderingPoints?.length || 0) - 1);
        return total + segmentCount;
      }, 0);
    }
  }, [edges, edgeType]);

  const geometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);

  const shaderMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(color) },
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

  // Update instance matrices (원본 데이터만 처리, fab visibility 없음)
  useEffect(() => {
    const mesh = instancedMeshRef.current;
    if (!mesh || instanceCount === 0) return;

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const euler = new THREE.Euler();

    let instanceIndex = 0;

    for (const edge of edges) {
      const points = edge.renderingPoints;
      if (!points || points.length === 0) continue;

      if (edgeType === EdgeType.LINEAR) {
        // Straight edge: single instance from first to last point
        const startPos = points[0];
        const endPos = points.at(-1)!;

        const centerX = (startPos.x + endPos.x) / 2;
        const centerY = (startPos.y + endPos.y) / 2;
        const centerZ = (startPos.z + endPos.z) / 2;

        const length = startPos.distanceTo(endPos);
        const angle = Math.atan2(endPos.y - startPos.y, endPos.x - startPos.x);

        if (length < 0.01) continue;

        position.set(centerX, centerY, centerZ);
        euler.set(0, 0, angle);
        quaternion.setFromEuler(euler);
        scale.set(length, 0.25, 1);

        matrix.compose(position, quaternion, scale);
        mesh.setMatrixAt(instanceIndex, matrix);
        instanceIndex++;
      } else {
        // Curve edges: multiple segments
        const segmentCount = points.length - 1;
        for (let i = 0; i < segmentCount; i++) {
          const start = points[i];
          const end = points[i + 1];

          const centerX = (start.x + end.x) / 2;
          const centerY = (start.y + end.y) / 2;
          const centerZ = (start.z + end.z) / 2;

          const length = start.distanceTo(end);
          const angle = Math.atan2(end.y - start.y, end.x - start.x);

          position.set(centerX, centerY, centerZ);
          euler.set(0, 0, angle);
          quaternion.setFromEuler(euler);
          scale.set(length * 2, 0.25, 1);

          matrix.compose(position, quaternion, scale);
          mesh.setMatrixAt(instanceIndex, matrix);
          instanceIndex++;
        }
      }
    }

    mesh.instanceMatrix.needsUpdate = true;
  }, [edges, edgeType, instanceCount]);

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
