// SensorDebugRenderer.tsx - Shader-based wireframe visualization of vehicle sensors

import { useRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { sensorPointArray, SensorPoint, SENSOR_DATA_SIZE, SENSOR_POINT_SIZE } from "@/store/vehicle/arrayMode/sensorPointArray";
import { getShmSensorPointData } from "@/store/vehicle/shmMode/shmSimulatorStore";
import { SENSOR_ATTR_SIZE, SensorSection } from "@/shmSimulator/MemoryLayoutManager";
import { getMarkerConfig } from "@/config/mapConfig";
import { VehicleSystemType } from "@/types/vehicle";

// -----------------------------------------------------------------------------
// Shader Definitions (GPU Logic)
// -----------------------------------------------------------------------------

const vertexShader = `
  // 인스턴스별 데이터 (4개의 코너 좌표)
  attribute vec4 quadStartEnd; // xy: FL, zw: FR
  attribute vec4 quadOther;    // xy: BL(or SL), zw: BR(or SR)

  // 정점별 인덱스 (0~7) - 어떤 코너를 연결할지 결정
  attribute float vertexIndex;

  uniform float zHeight;

  void main() {
    vec2 targetPos;

    // Line 1: FL -> OtherLeft (0 -> 1)
    if (vertexIndex < 0.5) targetPos = quadStartEnd.xy;      // FL
    else if (vertexIndex < 1.5) targetPos = quadOther.xy;    // OtherLeft

    // Line 2: OtherLeft -> OtherRight (2 -> 3)
    else if (vertexIndex < 2.5) targetPos = quadOther.xy;    // OtherLeft
    else if (vertexIndex < 3.5) targetPos = quadOther.zw;    // OtherRight

    // Line 3: OtherRight -> FR (4 -> 5)
    else if (vertexIndex < 4.5) targetPos = quadOther.zw;    // OtherRight
    else if (vertexIndex < 5.5) targetPos = quadStartEnd.zw; // FR

    // Line 4: FR -> FL (6 -> 7)
    else if (vertexIndex < 6.5) targetPos = quadStartEnd.zw; // FR
    else targetPos = quadStartEnd.xy;                        // FL

    // 이미 World 좌표이므로 modelMatrix 무시
    vec4 worldPosition = vec4(targetPos, zHeight, 1.0);
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const fragmentShader = `
  uniform vec3 color;
  void main() {
    gl_FragColor = vec4(color, 1.0);
  }
`;

// -----------------------------------------------------------------------------
// Instanced Quad Component
// -----------------------------------------------------------------------------

interface InstancedQuadLinesProps {
  numVehicles: number;
  color: string;
  getData: () => Float32Array | null;
  dataOffset: number; // 0=outer, 1=middle, 2=inner (Array mode용)
  isBody?: boolean;   // Body는 BL/BR 사용, Sensor는 SL/SR 사용
  isSharedMemory?: boolean;
  // SharedMemory 모드용 섹션 인덱스 (set() 최적화)
  startEndSection?: number;
  otherSection?: number;
}

function InstancedQuadLines({
  numVehicles,
  color,
  getData,
  dataOffset,
  isBody = false,
  isSharedMemory = false,
  startEndSection,
  otherSection,
}: InstancedQuadLinesProps) {
  const meshRef = useRef<THREE.LineSegments>(null);

  // 1. Static Geometry (Topology)
  const geometry = useMemo(() => {
    const geo = new THREE.InstancedBufferGeometry();
    geo.instanceCount = numVehicles;

    // 8 vertices for 4 lines (0,1, 2,3, 4,5, 6,7)
    const vertexIndices = new Float32Array([0, 1, 2, 3, 4, 5, 6, 7]);
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(8 * 3), 3));
    geo.setAttribute('vertexIndex', new THREE.BufferAttribute(vertexIndices, 1));

    // Instance Attributes with DynamicDrawUsage for better performance
    const startEndAttr = new THREE.InstancedBufferAttribute(new Float32Array(numVehicles * 4), 4);
    const otherAttr = new THREE.InstancedBufferAttribute(new Float32Array(numVehicles * 4), 4);
    startEndAttr.setUsage(THREE.DynamicDrawUsage);
    otherAttr.setUsage(THREE.DynamicDrawUsage);

    geo.setAttribute('quadStartEnd', startEndAttr);
    geo.setAttribute('quadOther', otherAttr);

    return geo;
  }, [numVehicles]);

  // 2. Material
  const material = useMemo(() => new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      zHeight: { value: 0 },
      color: { value: new THREE.Color(color) }
    },
    depthTest: false,
    transparent: true,
  }), [color]);

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  // 3. Update Loop
  useFrame(() => {
    if (!meshRef.current) return;

    const data = getData();
    if (!data) return;

    const startEndAttr = geometry.attributes.quadStartEnd as THREE.InstancedBufferAttribute;
    const otherAttr = geometry.attributes.quadOther as THREE.InstancedBufferAttribute;

    const arrStartEnd = startEndAttr.array as Float32Array;
    const arrOther = otherAttr.array as Float32Array;

    material.uniforms.zHeight.value = getMarkerConfig().Z;

    if (isSharedMemory && startEndSection !== undefined && otherSection !== undefined) {
      // SharedMemory 모드: set() 한 번에 복사 (섹션별 연속 레이아웃)
      const sectionSize = numVehicles * SENSOR_ATTR_SIZE;
      const startEndOffset = startEndSection * sectionSize;
      const otherOffset = otherSection * sectionSize;

      arrStartEnd.set(data.subarray(startEndOffset, startEndOffset + sectionSize));
      arrOther.set(data.subarray(otherOffset, otherOffset + sectionSize));
    } else {
      // Array 모드: 기존 for 루프 방식
      for (let i = 0; i < numVehicles; i++) {
        const base = i * SENSOR_DATA_SIZE + (dataOffset * SENSOR_POINT_SIZE);
        const writeIdx = i * 4;

        // Common points
        const flx = data[base + SensorPoint.FL_X];
        const fly = data[base + SensorPoint.FL_Y];
        const frx = data[base + SensorPoint.FR_X];
        const fry = data[base + SensorPoint.FR_Y];

        // Points that differ between Body and Sensor
        let olx, oly, orx, ory;

        if (isBody) {
          olx = data[base + SensorPoint.BL_X];
          oly = data[base + SensorPoint.BL_Y];
          orx = data[base + SensorPoint.BR_X];
          ory = data[base + SensorPoint.BR_Y];
        } else {
          olx = data[base + SensorPoint.SL_X];
          oly = data[base + SensorPoint.SL_Y];
          orx = data[base + SensorPoint.SR_X];
          ory = data[base + SensorPoint.SR_Y];
        }

        // Fill Attributes
        arrStartEnd[writeIdx] = flx;
        arrStartEnd[writeIdx + 1] = fly;
        arrStartEnd[writeIdx + 2] = frx;
        arrStartEnd[writeIdx + 3] = fry;

        arrOther[writeIdx] = olx;
        arrOther[writeIdx + 1] = oly;
        arrOther[writeIdx + 2] = orx;
        arrOther[writeIdx + 3] = ory;
      }
    }

    startEndAttr.needsUpdate = true;
    otherAttr.needsUpdate = true;
  });

  return <lineSegments ref={meshRef} args={[geometry, material]} frustumCulled={false} renderOrder={999} />;
}

// -----------------------------------------------------------------------------
// Main Renderer
// -----------------------------------------------------------------------------

interface SensorDebugRendererProps {
  readonly numVehicles: number;
  readonly mode: VehicleSystemType;
}

/**
 * Render sensor wireframes for debugging
 *
 * SharedMemory 모드에서는 섹션별 연속 레이아웃을 사용하여 set() 최적화 적용:
 * - zone0 (outer): startEnd=Section0, other=Section1
 * - zone1 (middle): startEnd=Section2, other=Section3
 * - zone2 (inner): startEnd=Section4, other=Section5
 * - body: startEnd=Section0 (zone0과 동일), other=Section6 (body전용)
 */
export function SensorDebugRenderer({ numVehicles, mode }: SensorDebugRendererProps) {
  const isSharedMemory = mode === VehicleSystemType.SharedMemory;

  const getData = () => isSharedMemory ? getShmSensorPointData() : sensorPointArray.getData();

  if (numVehicles === 0) return null;

  return (
    <>
      {/* Outer / Approach (Yellow) - zone0 */}
      <InstancedQuadLines
        numVehicles={numVehicles}
        color="#ffff00"
        getData={getData}
        dataOffset={0}
        isSharedMemory={isSharedMemory}
        startEndSection={SensorSection.ZONE0_STARTEND}
        otherSection={SensorSection.ZONE0_OTHER}
      />
      {/* Middle / Brake (Orange) - zone1 */}
      <InstancedQuadLines
        numVehicles={numVehicles}
        color="#ff8800"
        getData={getData}
        dataOffset={1}
        isSharedMemory={isSharedMemory}
        startEndSection={SensorSection.ZONE1_STARTEND}
        otherSection={SensorSection.ZONE1_OTHER}
      />
      {/* Inner / Stop (Red) - zone2 */}
      <InstancedQuadLines
        numVehicles={numVehicles}
        color="#ff0000"
        getData={getData}
        dataOffset={2}
        isSharedMemory={isSharedMemory}
        startEndSection={SensorSection.ZONE2_STARTEND}
        otherSection={SensorSection.ZONE2_OTHER}
      />
      {/* Body (Cyan) - zone0 startEnd + body other */}
      <InstancedQuadLines
        numVehicles={numVehicles}
        color="#00ffff"
        getData={getData}
        dataOffset={0}
        isBody={true}
        isSharedMemory={isSharedMemory}
        startEndSection={SensorSection.ZONE0_STARTEND}
        otherSection={SensorSection.BODY_OTHER}
      />
    </>
  );
}
