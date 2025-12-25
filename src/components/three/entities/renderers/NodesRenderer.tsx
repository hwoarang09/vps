// NodesRenderer.tsx - InstancedMesh version for all nodes
import React, { useRef, useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useNodeStore } from "../../../../store/map/nodeStore";
import nodeVertexShader from "../node/shaders/nodeVertex.glsl?raw";
import nodeFragmentShader from "../node/shaders/nodeFragment.glsl?raw";

interface NodesRendererProps {
  nodeIds: string[];
}

// 마커 공통 상수
const MARKER_Z = 3.8;          // rail과 같은 높이
const MARKER_SEGMENTS = 6;     // 너무 둥글지 않게

// 일반 노드 마커 (분홍색, 큰 크기)
const NORMAL_MARKER_RADIUS = 0.05;
const NORMAL_MARKER_COLOR = "#ff69b4"; // 분홍색

// TMP_ 노드 마커 (회색, 작은 크기)
const TMP_MARKER_RADIUS = 0.025;
const TMP_MARKER_COLOR = "#888888"; // 회색

// 메인 노드 메시 초기화
const initNodeMesh = (
  mesh: THREE.InstancedMesh,
  nodeIds: string[],
  getNodeByName: (name: string) => any
) => {
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);

  for (let index = 0; index < nodeIds.length; index++) {
    const nodeId = nodeIds[index];
    const node = getNodeByName(nodeId);
    if (!node) continue;

    position.set(node.editor_x, node.editor_y, node.editor_z);
    const size = node.size ?? 1;
    scale.set(size, size, size);

    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(index, matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
};

// 공통 마커 초기화 (일반/TMP 공용)
const initMarkers = (
  mesh: THREE.InstancedMesh,
  nodeIds: string[],
  getNodeByName: (name: string) => any
) => {
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);

  for (let index = 0; index < nodeIds.length; index++) {
    const nodeId = nodeIds[index];
    const node = getNodeByName(nodeId);
    if (!node) continue;

    position.set(node.editor_x, node.editor_y, MARKER_Z);
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

  // 일반 노드 마커 지오메트리 (분홍색, 큰 크기)
  const normalMarkerGeometry = useMemo(
    () => new THREE.SphereGeometry(NORMAL_MARKER_RADIUS, MARKER_SEGMENTS, MARKER_SEGMENTS),
    []
  );

  // TMP_ 노드 마커 지오메트리 (회색, 작은 크기)
  const tmpMarkerGeometry = useMemo(
    () => new THREE.SphereGeometry(TMP_MARKER_RADIUS, MARKER_SEGMENTS, MARKER_SEGMENTS),
    []
  );

  // 일반 노드 마커 머티리얼 (분홍색)
  const normalMarkerMaterial = useMemo(
    () => new THREE.MeshBasicMaterial({ color: NORMAL_MARKER_COLOR }),
    []
  );

  // TMP_ 노드 마커 머티리얼 (회색)
  const tmpMarkerMaterial = useMemo(
    () => new THREE.MeshBasicMaterial({ color: TMP_MARKER_COLOR }),
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
    const newMap = new Map<string, number>();
    for (let index = 0; index < nodeIds.length; index++) {
      newMap.set(nodeIds[index], index);
    }
    nodeDataRef.current = newMap;

    // 일반 노드 매핑
    const normalMap = new Map<string, number>();
    for (let index = 0; index < normalNodeIds.length; index++) {
      normalMap.set(normalNodeIds[index], index);
    }
    normalNodeMapRef.current = normalMap;

    // TMP_ 노드 매핑
    const tmpMap = new Map<string, number>();
    for (let index = 0; index < tmpNodeIds.length; index++) {
      tmpMap.set(tmpNodeIds[index], index);
    }
    tmpNodeMapRef.current = tmpMap;
  }, [nodeIds, normalNodeIds, tmpNodeIds]);

  // Initialize instance matrices and colors
  useEffect(() => {
    const mesh = instancedMeshRef.current;
    const normalMarker = normalMarkerRef.current;
    const tmpMarker = tmpMarkerRef.current;
    if (!mesh || instanceCount === 0) return;

    const getNodeByName = useNodeStore.getState().getNodeByName;

    // 메인 노드 메시 초기화
    initNodeMesh(mesh, nodeIds, getNodeByName);

    // 일반 노드 마커 초기화
    if (normalMarker) {
      initMarkers(normalMarker, normalNodeIds, getNodeByName);
    }

    // TMP_ 노드 마커 초기화
    if (tmpMarker) {
      initMarkers(tmpMarker, tmpNodeIds, getNodeByName);
    }
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

        // 마커 위치도 업데이트 (z=3.8 고정)
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

