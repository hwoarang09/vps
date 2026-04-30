// LockMgr/deadlock-zone.ts
// Deadlock zone: 직전 edge 도착 시 자동 REQ → 도착 순서대로 GRANT

import {
  MovementData,
  LogicData,
  VEHICLE_DATA_SIZE,
  StopReason,
  MovingStatus,
  CheckpointFlags,
} from "@/common/vehicle/initialize/constants";
import type { LockMgrState } from "./types";
import { LockEventType } from "./types";

/**
 * 차량이 merge node 직전 edge에 있는지 확인
 */
export function isVehicleApproachingMerge(
  vehId: number,
  mergeNodeName: string,
  state: LockMgrState
): boolean {
  if (!state.vehicleDataArray) return false;
  const ptr = vehId * VEHICLE_DATA_SIZE;
  const curEdgeIdx = state.vehicleDataArray[ptr + MovementData.CURRENT_EDGE];
  if (curEdgeIdx < 1) return false;
  const edge = state.edges[curEdgeIdx - 1];
  return edge?.to_node === mergeNodeName;
}

/**
 * 노드가 deadlock zone merge인지 확인
 */
export function isDeadlockZoneMerge(
  nodeName: string,
  state: LockMgrState
): boolean {
  return state.deadlockZoneMerges?.has(nodeName) === true;
}

/**
 * 큐 다음 차량에 grant (FIFO, deadlock zone은 직전 edge 우선)
 */
export function grantNextInQueue(
  nodeName: string,
  state: LockMgrState,
  _eName: (idx: number) => string
): void {
  const queue = state.queues.get(nodeName);
  if (!queue || queue.length === 0) return;

  // 기본: FIFO
  let nextVeh = queue[0];

  // Deadlock zone merge: 직전 edge 차량 우선
  if (isDeadlockZoneMerge(nodeName, state)) {
    for (const veh of queue) {
      if (isVehicleApproachingMerge(veh, nodeName, state)) {
        nextVeh = veh;
        break;
      }
    }
  }

  state.locks.set(nodeName, nextVeh);

  // Grant 받은 차량이 DZ gate로 정지 중이면 해제
  if (state.vehicleDataArray) {
    const ptr = nextVeh * VEHICLE_DATA_SIZE;
    const data = state.vehicleDataArray;
    if (data[ptr + LogicData.STOP_REASON] & StopReason.LOCKED) {
      // checkpoint LOCK_WAIT 해제 (path 모드)
      const targetEdgeIdx = Math.trunc(data[ptr + LogicData.CURRENT_CP_TARGET]);
      const targetEdge = targetEdgeIdx >= 1 ? state.edges[targetEdgeIdx - 1] : null;
      if (targetEdge?.from_node === nodeName) {
        data[ptr + LogicData.CURRENT_CP_FLAGS] =
          data[ptr + LogicData.CURRENT_CP_FLAGS] & ~CheckpointFlags.LOCK_WAIT;
      }
      // DZ gate 정지 해제
      data[ptr + LogicData.STOP_REASON] &= ~StopReason.LOCKED;
      data[ptr + MovementData.MOVING_STATUS] = MovingStatus.MOVING;
      state.waitingVehicles.delete(nextVeh);
    }
  }

  // GRANT 이벤트 emit
  if (state.onLockEvent && state.nodeNameToIndex) {
    const nodeIdx = state.nodeNameToIndex.get(nodeName) ?? 0;
    state.onLockEvent(nextVeh, nodeIdx, LockEventType.GRANT, 0, -1);
  }
}

// ============================================================================
// Deadlock Zone Gate: 매 프레임 호출
// - 직전 edge 도착 시 자동 REQ
// - lock 못 받으면 정지
// - merge 통과 후 자동 RELEASE
// ============================================================================

/** 내부: lock 큐에 추가 */
function requestLock(nodeName: string, vehId: number, state: LockMgrState): void {
  if (!state.queues.has(nodeName)) state.queues.set(nodeName, []);
  const queue = state.queues.get(nodeName)!;
  if (!queue.includes(vehId)) {
    queue.push(vehId);
  }
}

/** 내부: lock 해제 + 다음 grant */
function releaseLock(nodeName: string, vehId: number, state: LockMgrState, eName: (idx: number) => string): void {
  // holder 해제
  if (state.locks.get(nodeName) === vehId) {
    state.locks.delete(nodeName);
  }
  // 큐에서 제거
  const queue = state.queues.get(nodeName);
  if (queue) {
    const idx = queue.indexOf(vehId);
    if (idx >= 0) queue.splice(idx, 1);
  }
  // pendingReleases에서 제거
  const releases = state.pendingReleases.get(vehId);
  if (releases) {
    const ri = releases.findIndex(r => r.nodeName === nodeName);
    if (ri >= 0) releases.splice(ri, 1);
  }
  // RELEASE 이벤트
  if (state.onLockEvent && state.nodeNameToIndex) {
    const nodeIdx = state.nodeNameToIndex.get(nodeName) ?? 0;
    state.onLockEvent(vehId, nodeIdx, LockEventType.RELEASE, 0, -1);
  }
  // 다음 차량에 grant
  grantNextInQueue(nodeName, state, eName);
}

/**
 * Deadlock zone gate: 매 프레임, 전체 차량에 대해 호출
 *
 * 1. 직전 edge 도착 시: 자동 REQ + grant 시도
 * 2. lock 못 받으면: 정지
 * 3. merge 통과 후: 자동 RELEASE
 */
export function updateDeadlockZoneGates(
  numVehicles: number,
  state: LockMgrState,
  eName: (idx: number) => string
): void {
  if (!state.vehicleDataArray || !state.deadlockZoneMerges || state.deadlockZoneMerges.size === 0) return;

  const data = state.vehicleDataArray;

  for (let vehId = 0; vehId < numVehicles; vehId++) {
    const ptr = vehId * VEHICLE_DATA_SIZE;
    const curEdgeIdx = Math.trunc(data[ptr + MovementData.CURRENT_EDGE]);
    if (curEdgeIdx < 1) continue;
    const edge = state.edges[curEdgeIdx - 1];
    if (!edge) continue;

    const toNode = edge.to_node;
    const fromNode = edge.from_node;

    // ── 1. 직전 edge 도착 → 자동 REQ + grant/stop ──
    if (state.deadlockZoneMerges.has(toNode)) {
      const holder = state.locks.get(toNode);

      if (holder === vehId) {
        // 이미 내가 holder → 통과
        continue;
      }

      // 큐에 없으면 자동 REQ
      const queue = state.queues.get(toNode);
      const alreadyInQueue = queue?.includes(vehId) ?? false;
      if (!alreadyInQueue) {
        requestLock(toNode, vehId, state);
        // REQ 이벤트
        if (state.onLockEvent && state.nodeNameToIndex) {
          const nodeIdx = state.nodeNameToIndex.get(toNode) ?? 0;
          state.onLockEvent(vehId, nodeIdx, LockEventType.REQUEST, 0, -1);
        }
      }

      // grant 시도 (holder가 없을 때)
      if (holder === undefined) {
        grantNextInQueue(toNode, state, eName);
        if (state.locks.get(toNode) === vehId) {
          // grant 받음 → 통과
          continue;
        }
      }

      // lock 못 받음 → 정지
      if (state.locks.get(toNode) !== vehId) {
        data[ptr + MovementData.VELOCITY] = 0;
        data[ptr + MovementData.MOVING_STATUS] = MovingStatus.STOPPED;
        data[ptr + LogicData.STOP_REASON] |= StopReason.LOCKED;
        if (!state.waitingVehicles.has(vehId)) {
          state.waitingVehicles.add(vehId);
          // WAIT 이벤트
          if (state.onLockEvent && state.nodeNameToIndex) {
            const nodeIdx = state.nodeNameToIndex.get(toNode) ?? 0;
            const holderVeh = state.locks.get(toNode) ?? -1;
            state.onLockEvent(vehId, nodeIdx, LockEventType.WAIT, 0, holderVeh);
          }
        }
        continue;
      }
    }

    // ── 2. merge 통과 후 → 자동 RELEASE ──
    // 현재 edge의 from_node가 DZ merge = merge에서 나가는 edge 위
    // → 이전에 잡았던 lock 해제
    if (state.deadlockZoneMerges.has(fromNode)) {
      const holder = state.locks.get(fromNode);
      if (holder === vehId) {
        releaseLock(fromNode, vehId, state, eName);
      }
    }
  }
}
