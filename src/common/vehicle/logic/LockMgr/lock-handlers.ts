// LockMgr/lock-handlers.ts
// Lock 요청/해제/대기 처리 로직

import {
  CheckpointFlags,
  MovementData,
  LogicData,
  VEHICLE_DATA_SIZE,
  StopReason,
  MovingStatus,
  NextEdgeState,
  NEXT_EDGE_COUNT,
} from "@/common/vehicle/initialize/constants";
import { MAX_PATH_LENGTH, PATH_LEN, PATH_EDGES_START } from "../TransferMgr";
import type { LockMgrState } from "./types";
import { LockEventType } from "./types";
import { grantNextInQueue } from "./deadlock-zone";

/** Lock 이벤트를 콜백에 전달 */
function emitLockEvent(
  state: LockMgrState,
  vehId: number,
  nodeName: string,
  eventType: number,
  waitMs: number = 0,
  holderVehId: number = -1
): void {
  if (!state.onLockEvent || !state.nodeNameToIndex) return;
  const nodeIdx = state.nodeNameToIndex.get(nodeName) ?? 0;
  state.onLockEvent(vehId, nodeIdx, eventType, waitMs, holderVehId);
}

/**
 * Lock 해제 처리
 */
export function handleLockRelease(
  vehicleId: number,
  state: LockMgrState,
  eName: (idx: number) => string
): void {
  if (!state.vehicleDataArray) return;

  const data = state.vehicleDataArray;
  const ptr = vehicleId * VEHICLE_DATA_SIZE;

  // 현재 edge의 to_node가 merge node일 것
  const currentEdgeIdx = Math.trunc(data[ptr + MovementData.CURRENT_EDGE]);
  if (currentEdgeIdx < 1) return;

  const edge = state.edges[currentEdgeIdx - 1];
  if (!edge) return;

  const nodeName = edge.to_node;
  if (!state.mergeNodes.has(nodeName)) return;

  // Lock 해제
  releaseLockInternal(nodeName, vehicleId, state);
  emitLockEvent(state, vehicleId, nodeName, LockEventType.RELEASE);
  grantNextInQueue(nodeName, state, eName);
}

/**
 * Lock 요청 처리
 * @returns granted 여부
 */
export function handleLockRequest(
  vehicleId: number,
  state: LockMgrState
): boolean {
  if (!state.vehicleDataArray) return true;

  const data = state.vehicleDataArray;
  const ptr = vehicleId * VEHICLE_DATA_SIZE;

  // checkpoint의 targetEdge = merge node에서 나가는 edge
  const targetEdgeIdx = Math.trunc(data[ptr + LogicData.CURRENT_CP_TARGET]);
  if (targetEdgeIdx < 1) return true;

  const targetEdge = state.edges[targetEdgeIdx - 1];
  if (!targetEdge) return true;

  // merge node = targetEdge의 from_node
  const nodeName = targetEdge.from_node;
  if (!state.mergeNodes.has(nodeName)) return true;

  // Deadlock zone merge → checkpoint REQ 스킵 (gate에서 자동 처리)
  if (state.deadlockZoneMerges?.has(nodeName)) return true;

  // Lock 요청
  requestLockInternal(nodeName, vehicleId, state);
  emitLockEvent(state, vehicleId, nodeName, LockEventType.REQUEST);

  // 자동 해제 등록: targetEdge 도달 시 release
  if (!state.pendingReleases.has(vehicleId)) {
    state.pendingReleases.set(vehicleId, []);
  }
  const releases = state.pendingReleases.get(vehicleId)!;
  // 중복 등록 방지 및 경로 변경 시 targetEdge 갱신
  const existing = releases.find(r => r.nodeName === nodeName);
  if (existing) {
    existing.releaseEdgeIdx = targetEdgeIdx;
  } else {
    releases.push({ nodeName, releaseEdgeIdx: targetEdgeIdx });
  }

  // Grant 확인
  return checkGrantInternal(nodeName, vehicleId, state);
}

/**
 * Lock 대기 지점 처리
 * @returns granted 여부
 */
export function handleLockWait(
  vehicleId: number,
  state: LockMgrState
): boolean {
  if (!state.vehicleDataArray) return true;

  const data = state.vehicleDataArray;
  const ptr = vehicleId * VEHICLE_DATA_SIZE;

  // CURRENT_CP_TARGET = merge node에서 나가는 edge (builder가 세팅)
  const targetEdgeIdx = Math.trunc(data[ptr + LogicData.CURRENT_CP_TARGET]);
  if (targetEdgeIdx < 1) return true; // target 없으면 그냥 통과

  const targetEdge = state.edges[targetEdgeIdx - 1];
  if (!targetEdge) return true;

  const nodeName = targetEdge.from_node;
  if (!state.mergeNodes.has(nodeName)) return true; // merge가 아니면 통과

  // Deadlock zone merge → checkpoint WAIT 스킵 (gate에서 자동 처리)
  if (state.deadlockZoneMerges?.has(nodeName)) return true;

  // 이미 target edge 위에 있다 = merge를 이미 통과했다 → 대기 불필요
  // (경로 변경으로 이미 통과한 merge에 대해 missed LOCK_WAIT가 발동하는 경우 방지)
  const currentEdgeIdx = Math.trunc(data[ptr + MovementData.CURRENT_EDGE]);
  if (currentEdgeIdx === targetEdgeIdx) {
    state.waitingVehicles.delete(vehicleId);
    data[ptr + LogicData.STOP_REASON] &= ~StopReason.LOCKED;
    data[ptr + MovementData.MOVING_STATUS] = MovingStatus.MOVING;
    return true;
  }

  // lock holder 확인: 다른 차량이 잡고 있으면 대기, 비어있거나 내가 잡고 있으면 통과
  const holder = state.locks.get(nodeName);
  const blocked = holder !== undefined && holder !== vehicleId;

  if (blocked) {
    // 다른 차량이 lock 보유 → 강제 정지
    data[ptr + MovementData.VELOCITY] = 0;
    data[ptr + MovementData.MOVING_STATUS] = MovingStatus.STOPPED;
    data[ptr + LogicData.STOP_REASON] |= StopReason.LOCKED;
    // WAIT 이벤트는 최초 진입 시 1회만 emit (holder 정보 포함)
    if (!state.waitingVehicles.has(vehicleId)) {
      state.waitingVehicles.add(vehicleId);
      emitLockEvent(state, vehicleId, nodeName, LockEventType.WAIT, 0, holder);
    }
    return false;
  }

  // lock 비어있거나 내가 보유 → 통과
  state.waitingVehicles.delete(vehicleId);
  data[ptr + LogicData.STOP_REASON] &= ~StopReason.LOCKED;
  data[ptr + MovementData.MOVING_STATUS] = MovingStatus.MOVING;
  return true;
}

/**
 * 이동 준비 처리 - 다음 checkpoint까지 NEXT_EDGE 채우기
 */
export function handleMovePrepare(
  vehicleId: number,
  state: LockMgrState
): void {
  if (!state.pathBuffer || !state.checkpointArray || !state.vehicleDataArray) {
    return;
  }

  const data = state.vehicleDataArray;
  const ptr = vehicleId * VEHICLE_DATA_SIZE;

  // CURRENT_CP_TARGET에서 targetEdge 직접 읽기 (builder가 저장한 값)
  const targetEdge = data[ptr + LogicData.CURRENT_CP_TARGET];

  // pathBuffer에서 targetEdge까지 NEXT_EDGE 채우기
  const pathPtr = vehicleId * MAX_PATH_LENGTH;
  const pathLen = state.pathBuffer[pathPtr + PATH_LEN];

  const nextEdgeOffsets = [
    MovementData.NEXT_EDGE_0,
    MovementData.NEXT_EDGE_1,
    MovementData.NEXT_EDGE_2,
    MovementData.NEXT_EDGE_3,
    MovementData.NEXT_EDGE_4,
  ];

  for (let i = 0; i < NEXT_EDGE_COUNT; i++) {
    if (i >= pathLen) {
      data[ptr + nextEdgeOffsets[i]] = 0;
      continue;
    }

    const edgeIdx = state.pathBuffer[pathPtr + PATH_EDGES_START + i];
    if (edgeIdx < 1) {
      data[ptr + nextEdgeOffsets[i]] = 0;
      continue;
    }

    data[ptr + nextEdgeOffsets[i]] = edgeIdx;

    // targetEdge까지만 채움
    if (targetEdge > 0 && edgeIdx === targetEdge) {
      for (let j = i + 1; j < NEXT_EDGE_COUNT; j++) {
        data[ptr + nextEdgeOffsets[j]] = 0;
      }
      break;
    }
  }

  // NEXT_EDGE_STATE 설정
  const firstNext = data[ptr + MovementData.NEXT_EDGE_0];
  data[ptr + MovementData.NEXT_EDGE_STATE] = firstNext > 0 ? NextEdgeState.READY : NextEdgeState.EMPTY;
}

/**
 * 놓친 CP 처리 (짧은 edge를 한 프레임에 통과하여 CP를 놓친 경우)
 * - PREP: 실행 (nextEdges 채우기 - 필수!)
 * - REQ: 실행 (lock 요청)
 * - RELEASE: 실행 (lock 해제)
 * - WAIT: 락 없으면 현재 위치에서 즉시 정지 (miss해도 락 없으면 멈춰야 함)
 *
 * @returns true = 다음 CP로 이동 가능, false = 차량이 LOCK_WAIT 대기 중 (CP 유지)
 */
export function handleMissedCheckpoint(
  vehicleId: number,
  state: LockMgrState,
  cpFlags: number,
  eName: (idx: number) => string
): boolean {
  if (cpFlags & CheckpointFlags.MOVE_PREPARE) {
    handleMovePrepare(vehicleId, state);
  }
  if (cpFlags & CheckpointFlags.LOCK_RELEASE) {
    handleLockRelease(vehicleId, state, eName);
  }
  if (cpFlags & CheckpointFlags.LOCK_REQUEST) {
    handleLockRequest(vehicleId, state);
  }
  if (cpFlags & CheckpointFlags.LOCK_WAIT) {
    // 이미 지나쳤더라도 락 없으면 현재 위치에서 즉시 정지
    const granted = handleLockWait(vehicleId, state);
    if (!granted) {
      return false; // CP 유지, 다음 프레임에서 재시도
    }
  }
  return true;
}

// ============================================================================
// Lock 내부 구현
// ============================================================================

/**
 * Lock 요청 (내부 구현)
 */
export function requestLockInternal(
  nodeName: string,
  vehId: number,
  state: LockMgrState
): void {
  if (!state.queues.has(nodeName)) {
    state.queues.set(nodeName, []);
  }

  const queue = state.queues.get(nodeName)!;
  if (!queue.includes(vehId)) {
    queue.push(vehId);

    // 큐가 비어있으면 즉시 grant
    if (queue.length === 1 && !state.locks.has(nodeName)) {
      state.locks.set(nodeName, vehId);
      emitLockEvent(state, vehId, nodeName, LockEventType.GRANT);
    }
  }
}

/**
 * Grant 확인 (내부 구현)
 */
function checkGrantInternal(
  nodeName: string,
  vehId: number,
  state: LockMgrState
): boolean {
  return state.locks.get(nodeName) === vehId;
}

/**
 * Lock 해제 (내부 구현)
 */
function releaseLockInternal(
  nodeName: string,
  vehId: number,
  state: LockMgrState
): void {
  if (state.locks.get(nodeName) === vehId) {
    state.locks.delete(nodeName);

    // 큐에서도 제거
    const queue = state.queues.get(nodeName);
    if (queue) {
      const idx = queue.indexOf(vehId);
      if (idx !== -1) {
        queue.splice(idx, 1);
      }
    }
  }
}

/**
 * 큐에서만 제거 (lock 미보유 상태에서 auto-release 도달 시)
 */
export function cancelFromQueue(
  nodeName: string,
  vehId: number,
  state: LockMgrState
): void {
  const queue = state.queues.get(nodeName);
  if (queue) {
    const idx = queue.indexOf(vehId);
    if (idx !== -1) {
      queue.splice(idx, 1);
    }
  }
}

/**
 * 자동 해제 체크
 * - 차량이 releaseEdge에 도달하면 lock 해제
 */
export function checkAutoRelease(
  state: LockMgrState,
  eName: (idx: number) => string
): void {
  if (!state.vehicleDataArray) return;
  const data = state.vehicleDataArray;

  for (const [vehId, releases] of state.pendingReleases) {
    const ptr = vehId * VEHICLE_DATA_SIZE;
    const currentEdge = Math.trunc(data[ptr + MovementData.CURRENT_EDGE]);

    for (let i = releases.length - 1; i >= 0; i--) {
      const info = releases[i];
      if (currentEdge === info.releaseEdgeIdx) {
        const holder = state.locks.get(info.nodeName);
        if (holder === vehId) {
          // 정상 release: lock 보유 중 → 해제 + 다음 차량에 grant
          releaseLockInternal(info.nodeName, vehId, state);
          emitLockEvent(state, vehId, info.nodeName, LockEventType.RELEASE);
          grantNextInQueue(info.nodeName, state, eName);
        } else {
          // lock 미보유 상태에서 releaseEdge 도달
          // STOP_REASON=LOCKED이고 이 노드를 기다리는 중이면 cancel 금지
          // (다른 차량이 holder인 채로 exit edge에 진입한 경우 - grant 전에 cancelFromQueue
          //  가 조기 발화하면 GRANT를 못 받게 됨)
          const stopReason = data[ptr + LogicData.STOP_REASON];
          if (stopReason & StopReason.LOCKED) {
            const targetEdgeIdx = Math.trunc(data[ptr + LogicData.CURRENT_CP_TARGET]);
            const targetEdge = targetEdgeIdx >= 1 ? state.edges[targetEdgeIdx - 1] : null;
            if (targetEdge?.from_node === info.nodeName) {
              continue; // 이 lock을 기다리는 중 → cancel 안 함
            }
          }
          cancelFromQueue(info.nodeName, vehId, state);
        }
        releases.splice(i, 1);
      }
    }

    if (releases.length === 0) {
      state.pendingReleases.delete(vehId);
    }
  }
}

export interface OrphanedLockLogCtx {
  oldEdges: string[];   // 구 경로 첫 N개 edge 이름
  newEdges: string[];   // 새 경로 첫 N개 edge 이름
  currentEdgeName: string;
}

/** merge까지 "직진"으로 간주하는 최대 물리 거리 (m) */
const MAX_DIRECT_MERGE_DIST = 20;

/**
 * 새 경로에서 현재 edge → merge edge까지 물리 거리(m) 계산
 * @returns 거리(m), 계산 불가 시 Infinity
 */
function calcPhysicalDistToMerge(
  curEdge: number,
  newPathEdges: number[],
  nodeName: string,
  edges: LockMgrState['edges'],
): { dist: number; mergePos: number } {
  // 새 경로에서 차량 현재 위치
  let vehPos = -1;
  for (let j = 0; j < newPathEdges.length; j++) {
    if (newPathEdges[j] === curEdge) { vehPos = j; break; }
  }
  // 새 경로에서 merge node 위치 (to_node === nodeName인 edge)
  let mergePos = -1;
  for (let j = 0; j < newPathEdges.length; j++) {
    const edge = edges[newPathEdges[j] - 1];
    if (edge && edge.to_node === nodeName) { mergePos = j; break; }
  }

  if (mergePos < 0) return { dist: Infinity, mergePos: -1 };

  const startPos = vehPos >= 0 ? vehPos + 1 : 0; // 현재 edge 제외, 다음부터 합산
  let totalDist = 0;
  for (let j = startPos; j <= mergePos; j++) {
    const edge = edges[newPathEdges[j] - 1];
    if (edge) totalDist += edge.distance;
  }
  return { dist: totalDist, mergePos };
}

/**
 * 차량의 path edges를 pathBuffer에서 읽어옴
 */
function readVehiclePathEdges(vehId: number, state: LockMgrState): number[] {
  if (!state.pathBuffer) return [];
  const pathPtr = vehId * MAX_PATH_LENGTH;
  const pathLen = state.pathBuffer[pathPtr + PATH_LEN];
  const result: number[] = [];
  for (let i = 0; i < pathLen; i++) {
    const e = state.pathBuffer[pathPtr + PATH_EDGES_START + i];
    if (e >= 1) result.push(e);
  }
  return result;
}

/**
 * 차량이 merge에 도달하기까지 정확한 잔여 거리 (현재 edge ratio 반영)
 * - 차량별 pathBuffer에서 직접 path를 읽어 계산 (호출 차량과 큐 멤버 모두 자기 path 사용)
 * - currentEdge.distance * (1 - ratio) + 사이 edges 거리 합 + mergeEdge 거리 (mergeEdge 끝까지)
 * @returns { dist, mergePos, mergeEdgeIdx } — mergePos < 0이면 차량 path 위에 merge 없음
 */
function calcRemainingDistToMerge(
  vehId: number,
  nodeName: string,
  state: LockMgrState
): { dist: number; mergePos: number; mergeEdgeIdx: number } {
  if (!state.vehicleDataArray) return { dist: Infinity, mergePos: -1, mergeEdgeIdx: -1 };
  const data = state.vehicleDataArray;
  const ptr = vehId * VEHICLE_DATA_SIZE;
  const curEdge = Math.trunc(data[ptr + MovementData.CURRENT_EDGE]);
  const ratio = data[ptr + MovementData.EDGE_RATIO];

  // 차량 자신의 path edges 읽기
  const pathEdges = readVehiclePathEdges(vehId, state);
  if (pathEdges.length === 0) return { dist: Infinity, mergePos: -1, mergeEdgeIdx: -1 };

  // path 위 차량 위치
  let vehPos = -1;
  for (let j = 0; j < pathEdges.length; j++) {
    if (pathEdges[j] === curEdge) { vehPos = j; break; }
  }
  // path 위 merge edge (to_node === nodeName)
  let mergePos = -1;
  for (let j = 0; j < pathEdges.length; j++) {
    const edge = state.edges[pathEdges[j] - 1];
    if (edge && edge.to_node === nodeName) { mergePos = j; break; }
  }
  if (mergePos < 0) return { dist: Infinity, mergePos: -1, mergeEdgeIdx: -1 };
  if (vehPos < 0 || vehPos > mergePos) return { dist: Infinity, mergePos, mergeEdgeIdx: pathEdges[mergePos] };

  let totalDist = 0;
  // 현재 edge 잔여
  const curEdgeObj = state.edges[curEdge - 1];
  if (curEdgeObj) totalDist += curEdgeObj.distance * (1 - ratio);
  // 사이 edges + mergeEdge 끝까지
  for (let j = vehPos + 1; j <= mergePos; j++) {
    const edge = state.edges[pathEdges[j] - 1];
    if (edge) totalDist += edge.distance;
  }
  return { dist: totalDist, mergePos, mergeEdgeIdx: pathEdges[mergePos] };
}

/**
 * Edge가 곡선인지 확인 (rail type LINEAR이 아니면 곡선으로 간주)
 */
function isEdgeCurve(edge: LockMgrState['edges'][number] | undefined): boolean {
  if (!edge) return false;
  return edge.vos_rail_type !== 'LINEAR';
}

/**
 * Holder swap 안전 가드
 * - holder가 mergeEdge에 진입해서 ratio 0.5 이상이면 위험 → swap 금지
 * - 그 외: swap 허용
 */
function canSwapHolder(
  holderVehId: number,
  mergeEdgeIdx: number,
  state: LockMgrState
): boolean {
  if (!state.vehicleDataArray) return false;
  const data = state.vehicleDataArray;
  const ptr = holderVehId * VEHICLE_DATA_SIZE;
  const holderCurEdge = Math.trunc(data[ptr + MovementData.CURRENT_EDGE]);
  if (holderCurEdge < 1) return false;

  if (holderCurEdge === mergeEdgeIdx) {
    const ratio = data[ptr + MovementData.EDGE_RATIO];
    return ratio < 0.5;
  }
  return true;
}

/**
 * Path 변경 시 priority-aware lock 요청
 * - 본인이 holder/큐 멤버 아닌 신 path merge 중 LOCK_REQ 범위 안쪽인 것에 대해 즉시 REQ
 * - 큐는 물리 잔여 거리 오름차순으로 insert
 * - 본인이 holder보다 가까우면 holder swap (안전 가드 통과 시)
 *
 * 일반 LOCK_REQUEST CP 처리(handleLockRequest)는 그대로 FIFO 유지.
 * 이 함수는 processPathChange 한정으로만 호출됨.
 */
export function requestLockWithPriority(
  vehicleId: number,
  newPathMergeNodes: Set<string>,
  newPathEdges: number[],
  state: LockMgrState,
  _eName: (idx: number) => string
): void {
  if (!state.vehicleDataArray) return;

  for (const nodeName of newPathMergeNodes) {
    if (!state.mergeNodes.has(nodeName)) continue;
    if (state.deadlockZoneMerges?.has(nodeName)) continue; // DZ는 gate에서 별도 처리

    // 본인이 이미 holder거나 큐에 있으면 skip
    if (state.locks.get(nodeName) === vehicleId) continue;
    const existingQueue = state.queues.get(nodeName);
    if (existingQueue && existingQueue.includes(vehicleId)) continue;

    // 본인이 LOCK_REQ 범위 안쪽인지 검사 (본인 path 사용)
    const myResult = calcRemainingDistToMerge(vehicleId, nodeName, state);
    const { dist: myDist, mergeEdgeIdx } = myResult;
    if (mergeEdgeIdx < 1 || myDist === Infinity) continue;

    const mergeEdge = state.edges[mergeEdgeIdx - 1];
    const reqDistance = isEdgeCurve(mergeEdge) ? CURVE_REQUEST_DISTANCE : STRAIGHT_REQUEST_DISTANCE;
    if (myDist > reqDistance) continue; // 아직 LOCK_REQ 범위 밖 — 자연스럽게 도달할 때 처리됨

    // ── 강제 REQ + priority 정렬 ──
    if (!state.queues.has(nodeName)) state.queues.set(nodeName, []);
    const queue = state.queues.get(nodeName)!;

    // 정렬 위치에 insert (각 차량 자기 path 기준 잔여 거리 오름차순)
    const insertIdx = queue.findIndex(v => {
      const r = calcRemainingDistToMerge(v, nodeName, state);
      return r.dist > myDist;
    });
    if (insertIdx === -1) queue.push(vehicleId);
    else queue.splice(insertIdx, 0, vehicleId);
    emitLockEvent(state, vehicleId, nodeName, LockEventType.REQUEST);

    // pendingReleases 등록 (auto-release 위해)
    if (!state.pendingReleases.has(vehicleId)) state.pendingReleases.set(vehicleId, []);
    const releases = state.pendingReleases.get(vehicleId)!;
    if (!releases.find(r => r.nodeName === nodeName)) {
      // releaseEdgeIdx = mergeEdge 다음 edge (= target edge)
      let targetEdgeIdx = -1;
      for (let j = 0; j < newPathEdges.length - 1; j++) {
        if (newPathEdges[j] === mergeEdgeIdx) {
          targetEdgeIdx = newPathEdges[j + 1];
          break;
        }
      }
      if (targetEdgeIdx > 0) {
        releases.push({ nodeName, releaseEdgeIdx: targetEdgeIdx });
      }
    }

    // Holder swap — 본인이 큐 1등 + holder보다 충분히 가까울 때만 (path-change priority inversion fix)
    const holder = state.locks.get(nodeName);
    if (holder !== undefined && holder !== vehicleId) {
      if (queue[0] !== vehicleId) continue; // 1등 아니면 swap 안 함

      // holder의 잔여 거리도 자기 path로 계산
      const holderResult = calcRemainingDistToMerge(holder, nodeName, state);
      // holder가 path 위에 있으면 거리 비교, path 위에 없으면 (Infinity) → swap 허용 (holder가 우회/통과)
      if (holderResult.dist !== Infinity) {
        // SAFETY MARGIN: 본인이 holder보다 적어도 1m 이상 가까울 때만 swap
        // (단순 거리 미세차로 swap되어 holder가 박탈당하는 일 방지)
        const SWAP_SAFETY_MARGIN = 1.0;
        if (myDist + SWAP_SAFETY_MARGIN >= holderResult.dist) continue;
      }

      // holder 안전 가드 (mergeEdge ratio 0.5 미만일 때만 swap)
      if (!canSwapHolder(holder, mergeEdgeIdx, state)) continue;

      // swap
      state.locks.set(nodeName, vehicleId);
      emitLockEvent(state, holder, nodeName, LockEventType.RELEASE);
      emitLockEvent(state, vehicleId, nodeName, LockEventType.GRANT);
    } else if (holder === undefined && queue[0] === vehicleId) {
      // 큐 비어있고 본인이 1등 → 즉시 grant
      state.locks.set(nodeName, vehicleId);
      emitLockEvent(state, vehicleId, nodeName, LockEventType.GRANT);
    }
  }
}

/** LOCK_REQ 거리 (builder의 DEFAULT_OPTIONS와 동일) */
const STRAIGHT_REQUEST_DISTANCE = 5.1;
const CURVE_REQUEST_DISTANCE = 1.0;

/**
 * 경로 변경 시 orphaned lock 처리
 * - 신 경로에 없는 merge → 무조건 release/cancel
 * - 신 경로에 있는 merge:
 *   - 물리 거리 가까움 (< MAX_DIRECT_MERGE_DIST) → 유지
 *   - 멀거나 못 찾음 → release/cancel
 *   - WAIT 상태 (이미 merge 직전 정지) → 무조건 유지
 *
 * processPathCommand() 에서 새 경로 설정 직전에 호출
 */
export function releaseOrphanedLocks(
  vehicleId: number,
  newPathMergeNodes: Set<string>,
  newPathEdges: number[],
  state: LockMgrState,
  eName: (idx: number) => string,
  logCtx?: OrphanedLockLogCtx
): void {
  const releases = state.pendingReleases.get(vehicleId);
  if (!releases || releases.length === 0) return;

  for (let i = releases.length - 1; i >= 0; i--) {
    const { nodeName } = releases[i];

    const holder = state.locks.get(nodeName);

    if (newPathMergeNodes.has(nodeName)) {
      // WAIT 상태 = 이미 merge 직전에 정지 → 큐 유지 (cancel하면 priority inversion)
      if (state.waitingVehicles.has(vehicleId)) {
        continue;
      }
      // 물리 거리 기반 직진/우회 판별
      const data = state.vehicleDataArray;
      const curEdge = data ? Math.trunc(data[vehicleId * VEHICLE_DATA_SIZE + MovementData.CURRENT_EDGE]) : 0;
      const { dist, mergePos } = calcPhysicalDistToMerge(curEdge, newPathEdges, nodeName, state.edges);

      if (dist < MAX_DIRECT_MERGE_DIST) {
        // 가까움 → 유지 + releaseEdgeIdx를 새 경로 기준으로 갱신
        const nextIdx = mergePos + 1;
        if (nextIdx < newPathEdges.length) {
          releases[i].releaseEdgeIdx = newPathEdges[nextIdx];
        }
        continue;
      }
      // 멀거나 merge 못 찾음 → release/cancel (아래 공통 로직)
    }

    // 신 경로에 없는 merge 또는 우회 큐 대기 → 제거
    if (holder === vehicleId) {
      releaseLockInternal(nodeName, vehicleId, state);
      emitLockEvent(state, vehicleId, nodeName, LockEventType.RELEASE);
      grantNextInQueue(nodeName, state, eName);
      if (logCtx) {
        console.warn(
          `[LockMgr] VEH ${vehicleId}: orphaned lock RELEASED — ${nodeName}` +
          ` | edge: ${logCtx.currentEdgeName}` +
          ` | old: [${logCtx.oldEdges.join('→')}]` +
          ` → new: [${logCtx.newEdges.join('→')}]`
        );
      }
    } else {
      cancelFromQueue(nodeName, vehicleId, state);
      if (logCtx) {
        console.warn(
          `[LockMgr] VEH ${vehicleId}: orphaned lock CANCELLED (queue) — ${nodeName}` +
          ` | edge: ${logCtx.currentEdgeName}` +
          ` | old: [${logCtx.oldEdges.join('→')}]` +
          ` → new: [${logCtx.newEdges.join('→')}]`
        );
      }
    }
    releases.splice(i, 1);
  }

  if (releases.length === 0) {
    state.pendingReleases.delete(vehicleId);
  }
}
