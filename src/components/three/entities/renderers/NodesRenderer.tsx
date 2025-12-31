// NodesRenderer.tsx - InstancedMesh version for all nodes
import React, { useRef, useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useNodeStore } from "@/store/map/nodeStore";
import nodeVertexShader from "../node/shaders/nodeVertex.glsl?raw";
import nodeFragmentShader from "../node/shaders/nodeFragment.glsl?raw";
import { getMarkerConfig } from "@/config/mapConfig";

interface NodesRendererProps {
  nodeIds: string[];
}

// 마커 설정
const MARKER_CONFIG = getMarkerConfig();
const MARKER_Z = MARKER_CONFIG.Z;
const MARKER_SEGMENTS = MARKER_CONFIG.SEGMENTS;

// 마커 타입별 설정
const MARKER_TYPES = {
  normal: { radius: MARKER_CONFIG.NORMAL.RADIUS, color: MARKER_CONFIG.NORMAL.COLOR },
  tmp: { radius: MARKER_CONFIG.TMP.RADIUS, color: MARKER_CONFIG.TMP.COLOR },
} as const;

// 인덱스 맵 생성 헬퍼
const buildIndexMap = (ids: string[]) => new Map(ids.map((id, i) => [id, i]));

// 통합 InstancedMesh 초기화 함수
type InitOptions = {
  useNodeZ?: boolean;      // true: node.editor_z 사용, false: MARKER_Z 고정
  useDynamicScale?: boolean; // true: node.size 사용, false: 1 고정
};

const initInstancedMesh = (
  mesh: THREE.InstancedMesh,
  nodeIds: string[],
  getNodeByName: (name: string) => any,
  options: InitOptions = {}
) => {
  const { useNodeZ = false, useDynamicScale = false } = options;
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);

  for (let index = 0; index < nodeIds.length; index++) {
    const node = getNodeByName(nodeIds[index]);
    if (!node) continue;

    position.set(node.editor_x, node.editor_y, useNodeZ ? node.editor_z : MARKER_Z);

    if (useDynamicScale) {
      const size = node.size ?? 1;
      scale.set(size, size, size);
    }

    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(index, matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
};

// 마커 업데이트 헬퍼
const updateMarkerForNode = (
  nodeId: string,
  markerMatrix: THREE.Matrix4,
  normalMarker: THREE.InstancedMesh | null,
  tmpMarker: THREE.InstancedMesh | null,
  normalNodeMap: Map<string, number>,
  tmpNodeMap: Map<string, number>
) => {
  let normalUpdated = false;
  let tmpUpdated = false;

  if (nodeId.startsWith("TMP_")) {
    const tmpIndex = tmpNodeMap.get(nodeId);
    if (tmpMarker && tmpIndex !== undefined) {
      tmpMarker.setMatrixAt(tmpIndex, markerMatrix);
      tmpUpdated = true;
    }
  } else {
    const normalIndex = normalNodeMap.get(nodeId);
    if (normalMarker && normalIndex !== undefined) {
      normalMarker.setMatrixAt(normalIndex, markerMatrix);
      normalUpdated = true;
    }
  }

  return { normalUpdated, tmpUpdated };
};

/**
 * NodesRenderer - Renders all nodes using a single InstancedMesh
 * - Much more efficient than individual NodeInstance components
 * - Single useFrame for all nodes
 * - Updates instance matrices when node positions/colors change
 */
const NodesRenderer: React.FC<NodesRendererProps> = ({ nodeIds }) => {
  const instancedMeshRef = useRef<THREE.InstancedMesh>(null);
  const normalMarkerRef = useRef<THREE.InstancedMesh>(null);
  const tmpMarkerRef = useRef<THREE.InstancedMesh>(null);

  // nodeId -> instanceIndex 매핑 (전체 노드용)
  const nodeDataRef = useRef<Map<string, number>>(new Map());
  // 일반 노드와 TMP_ 노드 분리 매핑
  const normalNodeMapRef = useRef<Map<string, number>>(new Map());
  const tmpNodeMapRef = useRef<Map<string, number>>(new Map());

  // 노드 분리
  const { normalNodeIds, tmpNodeIds } = useMemo(() => {
    const normal: string[] = [];
    const tmp: string[] = [];
    for (const id of nodeIds) {
      if (id.startsWith("TMP_")) {
        tmp.push(id);
      } else {
        normal.push(id);
      }
    }
    return { normalNodeIds: normal, tmpNodeIds: tmp };
  }, [nodeIds]);

  const instanceCount = nodeIds.length;
  const normalCount = normalNodeIds.length;
  const tmpCount = tmpNodeIds.length;

  const geometry = useMemo(() => new THREE.SphereGeometry(0.2, 16, 16), []);

  // 마커 geometry/material (MARKER_TYPES 기반)
  const normalMarkerGeometry = useMemo(
    () => new THREE.SphereGeometry(MARKER_TYPES.normal.radius, MARKER_SEGMENTS, MARKER_SEGMENTS),
    []
  );
  const tmpMarkerGeometry = useMemo(
    () => new THREE.SphereGeometry(MARKER_TYPES.tmp.radius, MARKER_SEGMENTS, MARKER_SEGMENTS),
    []
  );
  const normalMarkerMaterial = useMemo(
    () => new THREE.MeshBasicMaterial({ color: MARKER_TYPES.normal.color }),
    []
  );
  const tmpMarkerMaterial = useMemo(
    () => new THREE.MeshBasicMaterial({ color: MARKER_TYPES.tmp.color }),
    []
  );

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: nodeVertexShader,
        fragmentShader: nodeFragmentShader,
        uniforms: {
          uTime: { value: 0 },
          uColor: { value: new THREE.Color("#ff6b6b") },
          uOpacity: { value: 1 },
          uSize: { value: 0.1 },
          uIsPreview: { value: 0 },
        },
        transparent: true,
        side: THREE.FrontSide,
        depthWrite: true,
        blending: THREE.NormalBlending,
      }),
    []
  );

  // Build nodeId -> instanceIndex mapping
  useEffect(() => {
    nodeDataRef.current = buildIndexMap(nodeIds);
    normalNodeMapRef.current = buildIndexMap(normalNodeIds);
    tmpNodeMapRef.current = buildIndexMap(tmpNodeIds);
  }, [nodeIds, normalNodeIds, tmpNodeIds]);

  // Initialize instance matrices and colors
  useEffect(() => {
    const mesh = instancedMeshRef.current;
    const normalMarker = normalMarkerRef.current;
    const tmpMarker = tmpMarkerRef.current;
    if (!mesh || instanceCount === 0) return;

    const getNodeByName = useNodeStore.getState().getNodeByName;

    // 메인 노드 메시 초기화 (node.editor_z, 동적 scale 사용)
    initInstancedMesh(mesh, nodeIds, getNodeByName, { useNodeZ: true, useDynamicScale: true });

    // 마커 초기화 (MARKER_Z 고정, scale 1 고정)
    if (normalMarker) initInstancedMesh(normalMarker, normalNodeIds, getNodeByName);
    if (tmpMarker) initInstancedMesh(tmpMarker, tmpNodeIds, getNodeByName);
  }, [nodeIds, instanceCount, normalNodeIds, tmpNodeIds]);

  // Subscribe to node store changes and update matrices
  useEffect(() => {
    const mesh = instancedMeshRef.current;
    const normalMarker = normalMarkerRef.current;
    const tmpMarker = tmpMarkerRef.current;
    if (!mesh) return;

    const matrix = new THREE.Matrix4();
    const markerMatrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const markerPosition = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const markerScale = new THREE.Vector3(1, 1, 1);

    const unsub = useNodeStore.subscribe((state) => {
      let needsUpdate = false;
      let normalMarkerNeedsUpdate = false;
      let tmpMarkerNeedsUpdate = false;

      for (const nodeId of nodeIds) {
        const node = state.getNodeByName(nodeId);
        const instanceIndex = nodeDataRef.current.get(nodeId);

        if (!node || instanceIndex === undefined) continue;

        position.set(node.editor_x, node.editor_y, node.editor_z);
        const size = node.size ?? 1;
        scale.set(size, size, size);

        matrix.compose(position, quaternion, scale);
        mesh.setMatrixAt(instanceIndex, matrix);
        needsUpdate = true;

        // 마커 위치도 업데이트 (Z 고정)
        markerPosition.set(node.editor_x, node.editor_y, MARKER_Z);
        markerMatrix.compose(markerPosition, quaternion, markerScale);

        const { normalUpdated, tmpUpdated } = updateMarkerForNode(
          nodeId,
          markerMatrix,
          normalMarker,
          tmpMarker,
          normalNodeMapRef.current,
          tmpNodeMapRef.current
        );

        if (normalUpdated) normalMarkerNeedsUpdate = true;
        if (tmpUpdated) tmpMarkerNeedsUpdate = true;
      }

      if (needsUpdate) {
        mesh.instanceMatrix.needsUpdate = true;
      }
      if (normalMarkerNeedsUpdate && normalMarker) {
        normalMarker.instanceMatrix.needsUpdate = true;
      }
      if (tmpMarkerNeedsUpdate && tmpMarker) {
        tmpMarker.instanceMatrix.needsUpdate = true;
      }
    });

    return unsub;
  }, [nodeIds]);

  // Single useFrame for all nodes - only update time uniform
  useFrame((state) => {
    if (material.uniforms.uTime) {
      material.uniforms.uTime.value = state.clock.elapsedTime;
    }
  });

  if (instanceCount === 0) {
    return null;
  }

  return (
    <>
      <instancedMesh
        ref={instancedMeshRef}
        args={[geometry, material, instanceCount]}
        frustumCulled={false}
      />
      {/* 일반 노드 마커 (분홍색, 큰 크기) */}
      {normalCount > 0 && (
        <instancedMesh
          ref={normalMarkerRef}
          args={[normalMarkerGeometry, normalMarkerMaterial, normalCount]}
          frustumCulled={false}
        />
      )}
      {/* TMP_ 노드 마커 (회색, 작은 크기) */}
      {tmpCount > 0 && (
        <instancedMesh
          ref={tmpMarkerRef}
          args={[tmpMarkerGeometry, tmpMarkerMaterial, tmpCount]}
          frustumCulled={false}
        />
      )}
    </>
  );
};

export default NodesRenderer;

