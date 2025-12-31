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
  // Group range for efficient iteration (groupStart[i] to groupStart[i+1])
  groupStart?: Int32Array;
}

export interface TextGroup {
  x: number;
  y: number;
  z: number;
  digits: number[];
}

// ============================================================================
// Spatial Grid - 공간 분할로 LOD 체크 최적화
// ============================================================================

/**
 * 공간 그리드 데이터 구조
 * - cellSize 단위로 월드를 분할
 * - 각 셀에 해당하는 그룹 인덱스 저장
 */
export interface SpatialGridData {
  cellSize: number;
  cells: Map<string, number[]>; // "x,y" -> group indices
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * 셀 키 생성 (x, y 좌표를 셀 좌표로 변환)
 */
function getCellKey(x: number, y: number, cellSize: number): string {
  const cx = Math.floor(x / cellSize);
  const cy = Math.floor(y / cellSize);
  return `${cx},${cy}`;
}

/**
 * TextGroup 배열에서 SpatialGrid 생성
 * @param groups - TextGroup 배열
 * @param cellSize - 셀 크기 (lodDistance와 동일하게 설정 권장)
 */
export function buildSpatialGrid(groups: TextGroup[], cellSize: number): SpatialGridData {
  const cells = new Map<string, number[]>();
  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;

  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    const key = getCellKey(g.x, g.y, cellSize);

    let arr = cells.get(key);
    if (!arr) {
      arr = [];
      cells.set(key, arr);
    }
    arr.push(i);

    // Bounds tracking
    if (g.x < minX) minX = g.x;
    if (g.x > maxX) maxX = g.x;
    if (g.y < minY) minY = g.y;
    if (g.y > maxY) maxY = g.y;
  }

  return { cellSize, cells, minX, minY, maxX, maxY };
}

/**
 * 카메라 위치 기반으로 visible 그룹 인덱스 수집 (그리드 활용)
 * @param grid - SpatialGridData
 * @param cx - 카메라 X
 * @param cy - 카메라 Y
 * @param lodDist - LOD 거리
 * @param visibleOut - 출력 배열 (재사용)
 */
export function getVisibleGroupsFromGrid(
  grid: SpatialGridData,
  cx: number,
  cy: number,
  lodDist: number,
  visibleOut: number[]
): void {
  visibleOut.length = 0;

  const { cellSize, cells } = grid;

  // 카메라 위치의 셀 좌표
  const camCellX = Math.floor(cx / cellSize);
  const camCellY = Math.floor(cy / cellSize);

  // lodDist 범위 내 셀 개수 (양쪽으로)
  const cellRange = Math.ceil(lodDist / cellSize);

  // 주변 셀들 순회
  for (let dx = -cellRange; dx <= cellRange; dx++) {
    for (let dy = -cellRange; dy <= cellRange; dy++) {
      const key = `${camCellX + dx},${camCellY + dy}`;
      const groupIndices = cells.get(key);
      if (groupIndices) {
        for (const idx of groupIndices) {
          visibleOut.push(idx);
        }
      }
    }
  }
}

/**
 * TextGroup 배열에서 인스턴싱 슬롯 데이터 생성
 */
export function buildSlotData(groups: TextGroup[]): SlotData | null {
  if (!groups || groups.length === 0) return null;

  // Build groupStart array for efficient group-based iteration
  // groupStart[i] = start index of group i, groupStart[groups.length] = total
  const groupStart = new Int32Array(groups.length + 1);
  let totalCharacters = 0;
  for (let i = 0; i < groups.length; i++) {
    groupStart[i] = totalCharacters;
    totalCharacters += groups[i].digits.length;
  }
  groupStart[groups.length] = totalCharacters;

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

  return { totalCharacters, counts, slotIndex, slotDigit, slotGroup, slotPosition, groupStart };
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

// Track previous culling state per component instance (use WeakMap to avoid memory leak)
const cullingStateCache = new WeakMap<SlotData, boolean>();

/**
 * 카메라 고도 기반 전체 컬링 (최적화: 이전 상태와 동일하면 스킵)
 * @returns true면 컬링됨 (렌더링 스킵)
 */
export function applyHighAltitudeCulling(
  cameraZ: number,
  cutoff: number,
  data: SlotData,
  meshes: (THREE.InstancedMesh | null)[]
): boolean {
  const shouldCull = cameraZ > cutoff;
  const wasCulled = cullingStateCache.get(data) ?? false;

  // If state hasn't changed, skip expensive matrix updates
  if (shouldCull === wasCulled) {
    return shouldCull;
  }

  // State changed - update cache
  cullingStateCache.set(data, shouldCull);

  if (shouldCull) {
    // Transition to culled: hide all
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
  }
  // If transitioning from culled to visible, the next frame's normal update will handle it

  return shouldCull;
}

// Track LOD culling state per component instance
const lodCullingStateCache = new WeakMap<SlotData, boolean>();

/**
 * Fast LOD check using simple x/y distance (no sqrt, no z)
 */
function isOutsideLOD(cx: number, cy: number, gx: number, gy: number, lodDist: number): boolean {
  const dx = cx - gx;
  const dy = cy - gy;
  return dx > lodDist || dx < -lodDist || dy > lodDist || dy < -lodDist;
}

/**
 * LOD 기반 컬링 - visible 그룹 인덱스 배열 반환
 * @param lodDist - LOD distance (NOT squared)
 * @param visibleGroupsOut - Output: will be filled with visible group indices
 * @returns true if ALL groups are culled (early exit)
 */
export function applyLODCulling(
  cameraX: number,
  cameraY: number,
  _cameraZ: number,
  lodDist: number,
  groups: TextGroup[],
  data: SlotData,
  meshes: (THREE.InstancedMesh | null)[],
  visibleGroupsOut: number[] // Output: visible group indices
): boolean {
  // Clear and collect visible groups
  visibleGroupsOut.length = 0;

  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    if (!isOutsideLOD(cameraX, cameraY, group.x, group.y, lodDist)) {
      visibleGroupsOut.push(i);
    }
  }

  const shouldCull = visibleGroupsOut.length === 0;
  const wasCulled = lodCullingStateCache.get(data) ?? false;

  // If all culled and state hasn't changed, skip expensive matrix updates
  if (shouldCull && shouldCull === wasCulled) {
    return true;
  }

  // Update cache
  lodCullingStateCache.set(data, shouldCull);

  if (shouldCull) {
    // Transition to all culled: hide all
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
  }

  return shouldCull;
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