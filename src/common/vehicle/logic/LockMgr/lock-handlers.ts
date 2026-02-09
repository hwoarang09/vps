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
import { devLog } from "@/logger/DevLogger";
import type { LockMgrState } from "./types";
import { isVehicleInDeadlockZone, grantNextInQueue } from "./deadlock-zone";

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
  grantNextInQueue(nodeName, state, eName);
}

/**
 * Lock 요청 처리
 * @returns granted 여부
 */
export function handleLockRequest(
  vehicleId: number,
  state: LockMgrState,
  eName: (idx: number) => string
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

  // Lock 요청
  requestLockInternal(nodeName, vehicleId, state);

  // 자동 해제 등록: targetEdge 도달 시 release
  if (!state.pendingReleases.has(vehicleId)) {
    state.pendingReleases.set(vehicleId, []);
  }
  const releases = state.pendingReleases.get(vehicleId)!;
  // 중복 등록 방지
  if (!releases.some(r => r.nodeName === nodeName)) {
    releases.push({ nodeName, releaseEdgeIdx: targetEdgeIdx });
    // devLog.veh(vehicleId).debug(
    //   `[LOCK_REQ] node=${nodeName} target=${eName(targetEdgeIdx)} → auto-release registered`
    // );
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
  state: LockMgrState,
  eName: (idx: number) => string
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

  const velocity = data[ptr + MovementData.VELOCITY];

  // lock holder 확인: 다른 차량이 잡고 있으면 대기, 비어있거나 내가 잡고 있으면 통과
  const holder = state.locks.get(nodeName);
  const blocked = holder !== undefined && holder !== vehicleId;

  if (blocked) {
    // Deadlock zone preemption: 나=zone-internal, holder=zone-external → 선점
    const iAmInZone = isVehicleInDeadlockZone(vehicleId, state);
    const holderInZone = isVehicleInDeadlockZone(holder, state);

    if (iAmInZone && !holderInZone) {
      // holder의 lock 회수 → 나에게 grant (holder는 큐에 잔류)
      // devLog.veh(vehicleId).debug(
      //   `[LOCK_WAIT] PREEMPT node=${nodeName} took lock from veh:${holder} (zone-external)`
      // );
      state.locks.set(nodeName, vehicleId);
      // 통과 처리
      // const curEdge = data[ptr + MovementData.CURRENT_EDGE];
      // const curRatio = data[ptr + MovementData.EDGE_RATIO];
      // devLog.veh(vehicleId).debug(
      //   `[LOCK_WAIT] PASS (preempted) node=${nodeName} next=${eName(targetEdgeIdx)} → MOVING at ${eName(curEdge)}@${curRatio.toFixed(3)}`
      // );
      data[ptr + LogicData.STOP_REASON] &= ~StopReason.LOCKED;
      data[ptr + MovementData.MOVING_STATUS] = MovingStatus.MOVING;
      return true;
    }

    // 다른 차량이 lock 보유 → 강제 정지
    // const curEdge = data[ptr + MovementData.CURRENT_EDGE];
    // const curRatio = data[ptr + MovementData.EDGE_RATIO];
    // devLog.veh(vehicleId).debug(
    //   `[LOCK_WAIT] BLOCKED node=${nodeName} holder=veh:${holder} next=${eName(targetEdgeIdx)} vel=${velocity.toFixed(1)} → FORCE STOP at ${eName(curEdge)}@${curRatio.toFixed(3)}`
    // );
    data[ptr + MovementData.VELOCITY] = 0;
    data[ptr + MovementData.MOVING_STATUS] = MovingStatus.STOPPED;
    data[ptr + LogicData.STOP_REASON] |= StopReason.LOCKED;
    return false;
  }

  // lock 비어있거나 내가 보유 → 통과
  // const curEdge = data[ptr + MovementData.CURRENT_EDGE];
  // const curRatio = data[ptr + MovementData.EDGE_RATIO];
  // devLog.veh(vehicleId).debug(
  //   `[LOCK_WAIT] PASS node=${nodeName} next=${eName(targetEdgeIdx)} → MOVING at ${eName(curEdge)}@${curRatio.toFixed(3)}`
  // );
  data[ptr + LogicData.STOP_REASON] &= ~StopReason.LOCKED;
  data[ptr + MovementData.MOVING_STATUS] = MovingStatus.MOVING;
  return true;
}

/**
 * 이동 준비 처리 - 다음 checkpoint까지 NEXT_EDGE 채우기
 */
export function handleMovePrepare(
  vehicleId: number,
  state: LockMgrState,
  eName: (idx: number) => string
): void {
  if (!state.pathBuffer || !state.checkpointArray || !state.vehicleDataArray) {
    // devLog.veh(vehicleId).warn(`[MOVE_PREP] no pathBuffer or checkpointArray`);
    return;
  }

  const data = state.vehicleDataArray;
  const ptr = vehicleId * VEHICLE_DATA_SIZE;

  // CURRENT_CP_TARGET에서 targetEdge 직접 읽기 (builder가 저장한 값)
  const targetEdge = data[ptr + LogicData.CURRENT_CP_TARGET];

  // pathBuffer에서 targetEdge까지 NEXT_EDGE 채우기
  const pathPtr = vehicleId * MAX_PATH_LENGTH;
  const pathLen = state.pathBuffer[pathPtr + PATH_LEN];

  // pathBuffer 현재 상태 로그
  // const pathEdges: number[] = [];
  // for (let i = 0; i < Math.min(pathLen, 10); i++) {
  //   pathEdges.push(state.pathBuffer[pathPtr + PATH_EDGES_START + i]);
  // }
  // devLog.veh(vehicleId).debug(
  //   `[MOVE_PREP] target=${eName(targetEdge)} pathLen=${pathLen} pathBuf=[${pathEdges.map(e => eName(e)).join(',')}]`
  // );

  const nextEdgeOffsets = [
    MovementData.NEXT_EDGE_0,
    MovementData.NEXT_EDGE_1,
    MovementData.NEXT_EDGE_2,
    MovementData.NEXT_EDGE_3,
    MovementData.NEXT_EDGE_4,
  ];

  const filledEdges: number[] = [];

  for (let i = 0; i < NEXT_EDGE_COUNT; i++) {
    if (i >= pathLen) {
      data[ptr + nextEdgeOffsets[i]] = 0;
      filledEdges.push(0);
      continue;
    }

    const edgeIdx = state.pathBuffer[pathPtr + PATH_EDGES_START + i];
    if (edgeIdx < 1) {
      data[ptr + nextEdgeOffsets[i]] = 0;
      filledEdges.push(0);
      continue;
    }

    data[ptr + nextEdgeOffsets[i]] = edgeIdx;
    filledEdges.push(edgeIdx);

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

  // devLog.veh(vehicleId).debug(
  //   `[MOVE_PREP] filled=[${filledEdges.map(e => eName(e)).join(',')}] state=${firstNext > 0 ? 'READY' : 'EMPTY'}`
  // );
}

/**
 * 놓친 CP 처리 (짧은 edge를 한 프레임에 통과하여 CP를 놓친 경우)
 * - PREP: 실행 (nextEdges 채우기 - 필수!)
 * - REQ: 실행 (lock 요청)
 * - RELEASE: 실행 (lock 해제)
 * - WAIT: 스킵 (이미 지나간 지점, 대기 불가)
 */
export function handleMissedCheckpoint(
  vehicleId: number,
  state: LockMgrState,
  cpFlags: number,
  eName: (idx: number) => string
): void {
  if (cpFlags & CheckpointFlags.MOVE_PREPARE) {
    handleMovePrepare(vehicleId, state, eName);
  }
  if (cpFlags & CheckpointFlags.LOCK_RELEASE) {
    handleLockRelease(vehicleId, state, eName);
  }
  if (cpFlags & CheckpointFlags.LOCK_REQUEST) {
    handleLockRequest(vehicleId, state, eName);
  }
  if (cpFlags & CheckpointFlags.LOCK_WAIT) {
    // devLog.veh(vehicleId).debug(
    //   `[processCP] MISSED WAIT - skipped (already passed wait point)`
    // );
  }
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
    const currentEdge = data[ptr + MovementData.CURRENT_EDGE];

    for (let i = releases.length - 1; i >= 0; i--) {
      const info = releases[i];
      if (currentEdge === info.releaseEdgeIdx) {
        const holder = state.locks.get(info.nodeName);
        if (holder === vehId) {
          // 정상 release: lock 보유 중 → 해제 + 다음 차량에 grant
          releaseLockInternal(info.nodeName, vehId, state);
          grantNextInQueue(info.nodeName, state, eName);
          // devLog.veh(vehId).debug(
          //   `[AUTO_RELEASE] node=${info.nodeName} at ${eName(currentEdge)}`
          // );
        } else {
          // lock 안 잡고 있음 → 큐에서만 제거 (cancel)
          cancelFromQueue(info.nodeName, vehId, state);
          // devLog.veh(vehId).debug(
          //   `[AUTO_RELEASE] CANCEL node=${info.nodeName} at ${eName(currentEdge)} (not holder, holder=${holder})`
          // );
        }
        releases.splice(i, 1);
      }
    }

    if (releases.length === 0) {
      state.pendingReleases.delete(vehId);
    }
  }
}
