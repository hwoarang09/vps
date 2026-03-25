// SensorDebugRenderer.tsx - Shader-based wireframe visualization of vehicle sensors

import { useRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useVehicleControlStore } from "@/store/ui/vehicleControlStore";
import { sensorPointArray, SensorPoint, SENSOR_DATA_SIZE, SENSOR_POINT_SIZE } from "@/store/vehicle/arrayMode/sensorPointArray";
import { getShmSensorPointData } from "@/store/vehicle/shmMode/shmSimulatorStore";
import { SENSOR_ATTR_SIZE, SensorSection } from "@/shmSimulator/MemoryLayoutManager";
import { getMarkerConfig } from "@/config/threejs/renderConfig";
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
}: Readonly<InstancedQuadLinesProps>) {
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
// Selected Vehicle Sensor Glow (4-layer, subtle)
// -----------------------------------------------------------------------------

// Quad의 4점을 라인으로 연결: FL→SL→SR→FR→FL (8 vertices = 4 line segments)
const QUAD_VERTS = 8;

interface SensorGlowQuadProps {
  zHeight: number;
  color: number;
  layerCount: number;
}

/**
 * 선택된 vehicle 1대의 센서 zone 1개를 glow로 표현.
 * 매 프레임 setQuadPoints()로 world좌표 4점을 업데이트.
 */
class SensorGlowQuad {
  lines: THREE.LineSegments[] = [];
  posArrays: Float32Array[] = [];

  constructor(scene: THREE.Group, config: SensorGlowQuadProps) {
    for (let i = 0; i < config.layerCount; i++) {
      const t = i / Math.max(config.layerCount - 1, 1);
      const opacity = 0.5 * Math.pow(1 - t, 2.0);
      const geo = new THREE.BufferGeometry();
      const positions = new Float32Array(QUAD_VERTS * 3);
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

      const mat = new THREE.LineBasicMaterial({
        color: config.color,
        transparent: true,
        opacity: Math.max(opacity, 0.05),
        depthTest: false,
        blending: THREE.AdditiveBlending,
      });

      const line = new THREE.LineSegments(geo, mat);
      line.frustumCulled = false;
      line.renderOrder = 998;
      scene.add(line);
      this.lines.push(line);
      this.posArrays.push(positions);
    }
  }

  /** fl,sl,sr,fr = [x,y] world coords. Expand uniformly along edge normals. */
  update(
    fl: [number, number], sl: [number, number],
    sr: [number, number], fr: [number, number],
    zHeight: number, spread: number,
  ) {
    // Compute outward normal per vertex by averaging adjacent edge normals
    // Quad order: FL → SL → SR → FR (CCW or CW)
    const corners: [number, number][] = [fl, sl, sr, fr];
    const n = corners.length;

    // Per-vertex outward offset direction
    const offsets: [number, number][] = [];
    for (let v = 0; v < n; v++) {
      const prev = corners[(v + n - 1) % n];
      const curr = corners[v];
      const next = corners[(v + 1) % n];

      // edge normals (pointing outward: rotate edge direction 90° outward)
      // edge prev→curr
      let e1x = curr[0] - prev[0], e1y = curr[1] - prev[1];
      let n1x = e1y, n1y = -e1x;
      const len1 = Math.sqrt(n1x * n1x + n1y * n1y) || 1;
      n1x /= len1; n1y /= len1;

      // edge curr→next
      let e2x = next[0] - curr[0], e2y = next[1] - curr[1];
      let n2x = e2y, n2y = -e2x;
      const len2 = Math.sqrt(n2x * n2x + n2y * n2y) || 1;
      n2x /= len2; n2y /= len2;

      // average normal
      let nx = n1x + n2x, ny = n1y + n2y;
      const lenN = Math.sqrt(nx * nx + ny * ny) || 1;
      nx /= lenN; ny /= lenN;

      // check outward: should point away from center
      const cx = (fl[0] + sl[0] + sr[0] + fr[0]) * 0.25;
      const cy = (fl[1] + sl[1] + sr[1] + fr[1]) * 0.25;
      const toCenterX = cx - curr[0], toCenterY = cy - curr[1];
      if (nx * toCenterX + ny * toCenterY > 0) { nx = -nx; ny = -ny; }

      offsets.push([nx, ny]);
    }

    for (let i = 0; i < this.lines.length; i++) {
      const t = i / Math.max(this.lines.length - 1, 1);
      const dist = spread * t; // uniform distance offset
      const arr = this.posArrays[i];

      // FL→SL, SL→SR, SR→FR, FR→FL → vertex pairs: [0,1, 1,2, 2,3, 3,0]
      const indices = [0, 1, 1, 2, 2, 3, 3, 0];
      for (let j = 0; j < QUAD_VERTS; j++) {
        const ci = indices[j];
        arr[j * 3] = corners[ci][0] + offsets[ci][0] * dist;
        arr[j * 3 + 1] = corners[ci][1] + offsets[ci][1] * dist;
        arr[j * 3 + 2] = zHeight;
      }

      const attr = this.lines[i].geometry.attributes.position as THREE.BufferAttribute;
      attr.needsUpdate = true;
    }
  }

  setVisible(v: boolean) {
    for (const l of this.lines) l.visible = v;
  }

  dispose() {
    for (const l of this.lines) {
      l.geometry.dispose();
      (l.material as THREE.Material).dispose();
    }
  }
}

/** Glow for the 4 sensor quads of the selected vehicle */
function SelectedSensorGlow({
  numVehicles, getData, isSharedMemory,
}: {
  numVehicles: number;
  getData: () => Float32Array | null;
  isSharedMemory: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const quadsRef = useRef<SensorGlowQuad[] | null>(null);
  const selectedVehicleId = useVehicleControlStore((s) => s.selectedVehicleId);

  // zone colors: body=cyan, zone0=yellow, zone1=orange, zone2=red
  const GLOW_LAYER_COUNT = 10;
  const zoneColors = useMemo(() => [0x00ffff, 0xffff00, 0xff8800, 0xff0000], []);

  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;

    // body + 3 zones = 4 quads
    const quads = zoneColors.map(color =>
      new SensorGlowQuad(group, { zHeight: 0, color, layerCount: GLOW_LAYER_COUNT })
    );
    quadsRef.current = quads;

    return () => {
      for (const q of quads) q.dispose();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numVehicles]);

  useFrame(({ camera }) => {
    const quads = quadsRef.current;
    const group = groupRef.current;
    if (!quads || !group) return;

    if (selectedVehicleId === null || selectedVehicleId >= numVehicles) {
      for (const q of quads) q.setVisible(false);
      return;
    }

    const data = getData();
    if (!data) {
      for (const q of quads) q.setVisible(false);
      return;
    }

    const zH = getMarkerConfig().Z;

    // Distance-adaptive spread
    // Need vehicle position to calc distance - approximate from body quad center
    let spread = 0.15;

    if (isSharedMemory) {
      // SHM layout: section-based
      const sectionSize = numVehicles * SENSOR_ATTR_SIZE;
      const vid = selectedVehicleId;

      // Read each zone's 4 points
      const zoneConfigs = [
        // body: startEnd=ZONE0_STARTEND, other=BODY_OTHER, use BL/BR
        { se: SensorSection.ZONE0_STARTEND, ot: SensorSection.BODY_OTHER },
        // zone0: startEnd=ZONE0_STARTEND, other=ZONE0_OTHER
        { se: SensorSection.ZONE0_STARTEND, ot: SensorSection.ZONE0_OTHER },
        // zone1
        { se: SensorSection.ZONE1_STARTEND, ot: SensorSection.ZONE1_OTHER },
        // zone2
        { se: SensorSection.ZONE2_STARTEND, ot: SensorSection.ZONE2_OTHER },
      ];

      // calc distance from body center
      const seOff0 = SensorSection.ZONE0_STARTEND * sectionSize + vid * SENSOR_ATTR_SIZE;
      const otOff0 = SensorSection.BODY_OTHER * sectionSize + vid * SENSOR_ATTR_SIZE;
      const bcx = (data[seOff0] + data[seOff0 + 2] + data[otOff0] + data[otOff0 + 2]) * 0.25;
      const bcy = (data[seOff0 + 1] + data[seOff0 + 3] + data[otOff0 + 1] + data[otOff0 + 3]) * 0.25;
      const dist = camera.position.distanceTo(new THREE.Vector3(bcx, bcy, zH));
      spread = THREE.MathUtils.clamp(dist * 0.005, 0.06, 0.4);

      for (let z = 0; z < 4; z++) {
        const cfg = zoneConfigs[z];
        const seOff = cfg.se * sectionSize + vid * SENSOR_ATTR_SIZE;
        const otOff = cfg.ot * sectionSize + vid * SENSOR_ATTR_SIZE;

        const fl: [number, number] = [data[seOff], data[seOff + 1]];
        const fr: [number, number] = [data[seOff + 2], data[seOff + 3]];
        const ol: [number, number] = [data[otOff], data[otOff + 1]];
        const or2: [number, number] = [data[otOff + 2], data[otOff + 3]];

        quads[z].update(fl, ol, or2, fr, zH, spread);
        quads[z].setVisible(true);
      }
    } else {
      // Array mode layout
      const vid = selectedVehicleId;
      const base = vid * SENSOR_DATA_SIZE;

      // Body quad (zone0 FL/FR + BL/BR)
      const readQuad = (zoneOff: number, useBody: boolean): [[number, number], [number, number], [number, number], [number, number]] => {
        const off = base + zoneOff * SENSOR_POINT_SIZE;
        const fl: [number, number] = [data[off + SensorPoint.FL_X], data[off + SensorPoint.FL_Y]];
        const fr: [number, number] = [data[off + SensorPoint.FR_X], data[off + SensorPoint.FR_Y]];
        const ol: [number, number] = useBody
          ? [data[off + SensorPoint.BL_X], data[off + SensorPoint.BL_Y]]
          : [data[off + SensorPoint.SL_X], data[off + SensorPoint.SL_Y]];
        const or2: [number, number] = useBody
          ? [data[off + SensorPoint.BR_X], data[off + SensorPoint.BR_Y]]
          : [data[off + SensorPoint.SR_X], data[off + SensorPoint.SR_Y]];
        return [fl, ol, or2, fr];
      };

      // body=zone0+body, zone0, zone1, zone2
      const configs: [number, boolean][] = [[0, true], [0, false], [1, false], [2, false]];

      // distance calc from body center
      const bPts = readQuad(0, true);
      const bcx = (bPts[0][0] + bPts[1][0] + bPts[2][0] + bPts[3][0]) * 0.25;
      const bcy = (bPts[0][1] + bPts[1][1] + bPts[2][1] + bPts[3][1]) * 0.25;
      const dist = camera.position.distanceTo(new THREE.Vector3(bcx, bcy, zH));
      spread = THREE.MathUtils.clamp(dist * 0.005, 0.06, 0.4);

      for (let z = 0; z < 4; z++) {
        const [zoneOff, isBody] = configs[z];
        const [fl, ol, or2, fr] = readQuad(zoneOff, isBody);
        quads[z].update(fl, ol, or2, fr, zH, spread);
        quads[z].setVisible(true);
      }
    }
  });

  return <group ref={groupRef} />;
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
      {/* Glow for selected vehicle's sensors */}
      <SelectedSensorGlow
        numVehicles={numVehicles}
        getData={getData}
        isSharedMemory={isSharedMemory}
      />
    </>
  );
}
