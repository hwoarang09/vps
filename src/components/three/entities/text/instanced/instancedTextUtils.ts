import * as THREE from "three";
import { CHAR_COUNT, CHAR_MAP } from "./useDigitMaterials";

export const HIDE_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);

export interface SlotData {
  totalCharacters: number;
  counts: number[];
  slotIndex: Int32Array;
  slotDigit: Int8Array;
  slotGroup?: Int32Array;
  slotVehicle?: Int32Array;
  slotPosition: Int32Array;
}

export interface TextGroup {
  x: number;
  y: number;
  z: number;
  digits: number[];
}

/**
 * TextGroup 배열에서 인스턴싱 슬롯 데이터 생성
 */
export function buildSlotData(groups: TextGroup[]): SlotData | null {
  if (!groups || groups.length === 0) return null;

  let totalCharacters = 0;
  for (const group of groups) {
    totalCharacters += group.digits.length;
  }

  const counts = new Array(CHAR_COUNT).fill(0);
  const slotDigit = new Int8Array(totalCharacters);
  const slotGroup = new Int32Array(totalCharacters);
  const slotPosition = new Int32Array(totalCharacters);

  let charIndex = 0;
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
    const { digits } = groups[groupIndex];
    for (let posIndex = 0; posIndex < digits.length; posIndex++) {
      const digit = Math.max(0, Math.min(CHAR_COUNT - 1, digits[posIndex]));
      slotDigit[charIndex] = digit;
      slotGroup[charIndex] = groupIndex;
      slotPosition[charIndex] = posIndex;
      counts[digit]++;
      charIndex++;
    }
  }

  const slotIndex = new Int32Array(totalCharacters);
  const currentSlot = new Array(CHAR_COUNT).fill(0);

  for (let i = 0; i < totalCharacters; i++) {
    const digit = slotDigit[i];
    slotIndex[i] = currentSlot[digit];
    currentSlot[digit]++;
  }

  return { totalCharacters, counts, slotIndex, slotDigit, slotGroup, slotPosition };
}

/**
 * 차량용 슬롯 데이터 생성 (VEH00000 포맷)
 */
export function buildVehicleSlotData(numVehicles: number, labelLength: number): SlotData | null {
  if (numVehicles === 0) return null;

  const totalCharacters = numVehicles * labelLength;
  const counts = new Array(CHAR_COUNT).fill(0);
  const slotDigit = new Int8Array(totalCharacters);
  const slotVehicle = new Int32Array(totalCharacters);
  const slotPosition = new Int32Array(totalCharacters);

  let charIndex = 0;
  for (let v = 0; v < numVehicles; v++) {
    const label = `VEH${String(v).padStart(5, "0")}`;

    for (let i = 0; i < labelLength; i++) {
        const digit = CHAR_MAP[label[i]] ?? 0;
        slotDigit[charIndex] = digit;
        slotVehicle[charIndex] = v;
        slotPosition[charIndex] = i;
        counts[digit]++;
        charIndex++;
    }
  }

  const slotIndex = new Int32Array(totalCharacters);
  const currentSlot = new Array(CHAR_COUNT).fill(0);

  for (let i = 0; i < totalCharacters; i++) {
    const digit = slotDigit[i];
    slotIndex[i] = currentSlot[digit];
    currentSlot[digit]++;
  }

  return {
    totalCharacters,
    counts,
    slotIndex,
    slotDigit,
    slotVehicle,
    slotPosition,
  };
}

/**
 * 카메라 고도 기반 전체 컬링
 * @returns true면 컬링됨 (렌더링 스킵)
 */
export function applyHighAltitudeCulling(
  cameraZ: number,
  cutoff: number,
  data: SlotData,
  meshes: (THREE.InstancedMesh | null)[]
): boolean {
  if (cameraZ <= cutoff) return false;

  const { totalCharacters, slotDigit, slotIndex } = data;
  for (let i = 0; i < totalCharacters; i++) {
    const d = slotDigit[i];
    const slot = slotIndex[i];
    const mesh = meshes[d];
    if (mesh) mesh.setMatrixAt(slot, HIDE_MATRIX);
  }
  for (const msh of meshes) {
    if (msh) msh.instanceMatrix.needsUpdate = true;
  }
  return true;
}

/**
 * 빌보드 회전 계산 (Screen Aligned)
 * 카메라의 Quaternion을 그대로 사용하여 텍스트가 항상 화면과 평행하게 만듦
 */
export function computeBillboardRotation(
  cameraQuaternion: THREE.Quaternion
): { quaternion: THREE.Quaternion; right: THREE.Vector3 } {
  const quaternion = cameraQuaternion.clone();
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion);

  return { quaternion, right };
}

/**
 * 거리 제곱 계산
 */
/**
 * 거리 제곱 계산
 */
export function distanceSquared(
  x1: number, y1: number, z1: number,
  x2: number, y2: number, z2: number
): number {
  const dx = x1 - x2;
  const dy = y1 - y2;
  const dz = z1 - z2;
  return dx * dx + dy * dy + dz * dz;
}

/**
 * Update transforms for vehicle text labels
 */
export function updateVehicleTextTransforms(
  data: {
    totalCharacters: number;
    slotDigit: Int8Array;
    slotIndex: Int32Array;
    slotVehicle: Int32Array;
    slotPosition: Int32Array;
  },
  vehicleData: Float32Array,
  cameraPos: THREE.Vector3,
  cameraQuaternion: THREE.Quaternion,
  meshes: (THREE.InstancedMesh | null)[],
  params: {
    scale: number;
    charSpacing: number;
    halfLen: number;
    zOffset: number;
    lodDistSq: number;
  },
  constants: {
    VEHICLE_DATA_SIZE: number;
    MovementData_X: number;
    MovementData_Y: number;
    MovementData_Z: number;
  }
) {
  const { totalCharacters, slotDigit, slotIndex, slotVehicle, slotPosition } = data;
  const { scale, charSpacing, halfLen, zOffset, lodDistSq } = params;
  const { VEHICLE_DATA_SIZE, MovementData_X, MovementData_Y, MovementData_Z } = constants;
  const { x: cx, y: cy, z: cz } = cameraPos;

  const m = new THREE.Matrix4();
  const s = new THREE.Vector3(scale, scale, 1);

  const vehicleLOD = new Map<number, boolean>();
  const vehicleRotation = new Map<number, { quaternion: THREE.Quaternion; right: THREE.Vector3 }>();

  for (let i = 0; i < totalCharacters; i++) {
    const d = slotDigit[i];
    const slot = slotIndex[i];
    const v = slotVehicle[i];
    const posIdx = slotPosition[i];
    const mesh = meshes[d];
    if (!mesh) continue;

    // 차량 위치
    const off = v * VEHICLE_DATA_SIZE;
    const vx = vehicleData[off + MovementData_X];
    const vy = vehicleData[off + MovementData_Y];
    const vz = vehicleData[off + MovementData_Z] + zOffset;

    // LOD 체크 (차량당 한번만)
    if (!vehicleLOD.has(v)) {
      const distSq = distanceSquared(cx, cy, cz, vx, vy, vz);
      vehicleLOD.set(v, distSq > lodDistSq);
    }

    if (vehicleLOD.get(v)) {
      mesh.setMatrixAt(slot, HIDE_MATRIX);
      continue;
    }

    // 빌보드 회전 (차량당 한번만)
    if (!vehicleRotation.has(v)) {
      vehicleRotation.set(v, computeBillboardRotation(cameraQuaternion));
    }

    const { quaternion, right } = vehicleRotation.get(v)!;

    const offsetX = (posIdx - halfLen) * charSpacing;
    const offsetVector = right.clone().multiplyScalar(offsetX);
    const finalPos = new THREE.Vector3(vx, vy, vz).add(offsetVector);

    m.compose(finalPos, quaternion, s);
    mesh.setMatrixAt(slot, m);
  }

  for (const msh of meshes) {
    if (msh) msh.instanceMatrix.needsUpdate = true;
  }
}