import React, { useRef, useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import edgeVertexShader from "../shaders/edgeVertex.glsl?raw";
import edgeFragmentShader from "../shaders/edgeFragment.glsl?raw";
import { useRenderCheck } from "@/utils/renderDebug";
import { EdgeType } from "@/types";

export interface UnifiedEdgeRendererProps {
  renderingPoints: THREE.Vector3[];
  edgeType?: EdgeType | string; // Support both Enum and simplified string
  color?: string;
  opacity?: number;
  width?: number;
  isPreview?: boolean;
  renderOrder?: number;
}

export const UnifiedEdgeRenderer: React.FC<UnifiedEdgeRendererProps> = ({
  renderingPoints = [],
  edgeType = EdgeType.CURVE_90, // Default to a curve type if not specified
  color = "#ff0000",
  opacity = 1,
  width = 0.5,
  isPreview = false,
  renderOrder = 3,
}) => {
  const instancedMeshRef = useRef<THREE.InstancedMesh>(null);
  useRenderCheck("UnifiedEdgeRenderer");

  // Determine instance count
  const instanceCount = useMemo(() => {
    if (renderingPoints.length < 2) return 0;
    if (edgeType === EdgeType.LINEAR) return 1;
    return renderingPoints.length - 1;
  }, [renderingPoints.length, edgeType]);

  // Geometry
  const geometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);

  // Material
  const shaderMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(color) },
        uOpacity: { value: opacity },
        uIsPreview: { value: isPreview ? 1 : 0 },
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
  }, [color, opacity, isPreview]);

  // Update effect
  useEffect(() => {
    const mesh = instancedMeshRef.current;
    if (!mesh) return;

    if (instanceCount <= 0) {
      mesh.visible = false;
      return;
    }

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const euler = new THREE.Euler();

    if (edgeType === EdgeType.LINEAR) {
      // Linear: One segment from start to end
      const start = renderingPoints[0];
      const end = renderingPoints.at(-1)!;

      const centerX = (start.x + end.x) / 2;
      const centerY = (start.y + end.y) / 2;
      const centerZ = (start.z + end.z) / 2;

      const length = start.distanceTo(end);
      const angle = Math.atan2(end.y - start.y, end.x - start.x);

      if (length < 0.01) {
        mesh.visible = false;
        return;
      }

      position.set(centerX, centerY, centerZ);
      euler.set(0, 0, angle);
      quaternion.setFromEuler(euler);
      scale.set(length, width, 1);

      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(0, matrix);
    } else {
      // Curve: Multiple segments
      for (let i = 0; i < instanceCount; i++) {
        const start = renderingPoints[i];
        const end = renderingPoints[i + 1];

        const centerX = (start.x + end.x) / 2;
        const centerY = (start.y + end.y) / 2;
        const centerZ = (start.z + end.z) / 2;

        const length = start.distanceTo(end);
        const angle = Math.atan2(end.y - start.y, end.x - start.x);

        position.set(centerX, centerY, centerZ);
        euler.set(0, 0, angle);
        quaternion.setFromEuler(euler);
        // Note: Curve renderers used length * 2 for some reason (overlap?)
        // Preserving that behavior
        scale.set(length * 2, width, 1);

        matrix.compose(position, quaternion, scale);
        mesh.setMatrixAt(i, matrix);
      }
    }

    mesh.instanceMatrix.needsUpdate = true;
    mesh.visible = true;
  }, [renderingPoints, width, instanceCount, edgeType]);

  // Uniform update
  useFrame((state) => {
    if (shaderMaterial.uniforms.uTime) {
      shaderMaterial.uniforms.uTime.value = state.clock.elapsedTime;
    }
  });

  if (instanceCount <= 0) {
    return null;
  }

  return (
    <instancedMesh
      key={`${instanceCount}-${edgeType}`}
      ref={instancedMeshRef}
      args={[geometry, shaderMaterial, instanceCount]}
      frustumCulled={false}
      renderOrder={renderOrder}
    />
  );
};
