import * as THREE from "three";
import { CHAR_COUNT, CHAR_MAP } from "./useDigitMaterials";

export const HIDE_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);

// ============================================================================
// Zero-GC Scratchpads (모듈 레벨에서 한 번만 할당)
// ============================================================================
const _tempMatrix = new THREE.Matrix4();
const _tempPos = new THREE.Vector3();
const _tempOffset = new THREE.Vector3();
const _tempScale = new THREE.Vector3();
const _tempQuat = new THREE.Quaternion();
const _tempRight = new THREE.Vector3();
const _unitX = new THREE.Vector3(1, 0, 0);
const _lodCheckPos = { x: 0, y: 0, z: 0 }; // LOD 체크용

// Billboard rotation cache (차량 수만큼 미리 할당하지 않고, 프레임별로 재사용)
let _cachedBillboardQuat: THREE.Quaternion | null = null;
let _cachedBillboardRight: THREE.Vector3 | null = null;

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
 * Zero-GC: 빌보드 회전 계산 (Screen Aligned)
 * 결과를 모듈 레벨 캐시에 저장하여 재사용
 */
export function updateBillboardRotation(cameraQuaternion: THREE.Quaternion): void {
  _cachedBillboardQuat ??= new THREE.Quaternion();
  _cachedBillboardRight ??= new THREE.Vector3();

  _cachedBillboardQuat.copy(cameraQuaternion);
  _cachedBillboardRight.copy(_unitX).applyQuaternion(_cachedBillboardQuat);
}

/**
 * Zero-GC: Get cached billboard quaternion
 */
export function getBillboardQuaternion(): THREE.Quaternion {
  return _cachedBillboardQuat || _tempQuat;
}

/**
 * Zero-GC: Get cached billboard right vector
 */
export function getBillboardRight(): THREE.Vector3 {
  return _cachedBillboardRight || _tempRight;
}



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

interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/**
 * LOD 체크 (거리 기반 컬링)
 * early exit: 각 축별 거리로 먼저 필터링 후 거리 제곱 계산
 * @returns true면 LOD 컬링됨 (숨김)
 */
export function checkLODCulling(
  pos: Vec3Like,
  camPos: Vec3Like,
  lodDist: number,
  lodDistSq: number
): boolean {
  const dx = pos.x - camPos.x;
  const dy = pos.y - camPos.y;
  const dz = pos.z - camPos.z;

  // early exit: 각 축별 거리로 먼저 필터링 (곱셈 연산 절약)
  if (dz > lodDist || dz < -lodDist ||
      dx > lodDist || dx < -lodDist ||
      dy > lodDist || dy < -lodDist) {
    return true;
  }

  const distSq = dx * dx + dy * dy + dz * dz;
  return distSq > lodDistSq;
}

/**
 * Zero-GC: Update transforms for vehicle text labels
 * 루프 내 객체 생성 완전 제거
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
  camera: THREE.Camera,
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
  },
  // Zero-GC: 외부에서 관리하는 LOD 캐시 (선택적)
  vehicleLODCache?: Map<number, boolean>
) {
  const { totalCharacters, slotDigit, slotIndex, slotVehicle, slotPosition } = data;
  const { scale, charSpacing, halfLen, zOffset, lodDistSq } = params;
  const { VEHICLE_DATA_SIZE, MovementData_X, MovementData_Y, MovementData_Z } = constants;
  const lodDist = Math.sqrt(lodDistSq); // early exit용

  // Zero-GC: 스케일 벡터 재사용
  _tempScale.set(scale, scale, 1);

  // Zero-GC: 빌보드 회전 한 번만 계산
  updateBillboardRotation(camera.quaternion);
  const billboardQuat = getBillboardQuaternion();
  const billboardRight = getBillboardRight();

  // LOD 캐시 (외부에서 전달받거나 내부 생성)
  const vehicleLOD = vehicleLODCache || new Map<number, boolean>();
  if (!vehicleLODCache) {
    vehicleLOD.clear();
  }

  let lastVehicle = -1;
  let lastLODResult = false;

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

    // LOD 체크 (차량당 한번만 - 연속 접근 최적화)
    if (v !== lastVehicle) {
      if (vehicleLOD.has(v)) {
        lastLODResult = vehicleLOD.get(v)!;
      } else {
        _lodCheckPos.x = vx;
        _lodCheckPos.y = vy;
        _lodCheckPos.z = vz;
        lastLODResult = checkLODCulling(_lodCheckPos, camera.position, lodDist, lodDistSq);
        vehicleLOD.set(v, lastLODResult);
      }
      lastVehicle = v;
    }

    if (lastLODResult) {
      mesh.setMatrixAt(slot, HIDE_MATRIX);
      continue;
    }

    // Zero-GC: 오프셋 계산 (재사용 객체 사용)
    const offsetX = (posIdx - halfLen) * charSpacing;
    _tempOffset.copy(billboardRight).multiplyScalar(offsetX);

    // Zero-GC: 최종 위치 계산 (재사용 객체 사용)
    _tempPos.set(vx, vy, vz).add(_tempOffset);

    // Zero-GC: 매트릭스 구성 (재사용 객체 사용)
    _tempMatrix.compose(_tempPos, billboardQuat, _tempScale);
    mesh.setMatrixAt(slot, _tempMatrix);
  }

  for (const msh of meshes) {
    if (msh) msh.instanceMatrix.needsUpdate = true;
  }
}