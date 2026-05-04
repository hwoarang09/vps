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
import { LockEventType, LockDetailType } from "./types";

/** DEV_LOCK_DETAIL emit 헬퍼 */
function emitDetail(
  state: LockMgrState,
  vehId: number,
  nodeName: string,
  detailType: number,
  holderVehId: number = -1,
  extra: number = 0
): void {
  if (!state.onLockDetailEvent || !state.nodeNameToIndex) return;
  const nodeIdx = state.nodeNameToIndex.get(nodeName) ?? 0;
  state.onLockDetailEvent(vehId, nodeIdx, detailType, holderVehId, extra);
}

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
  const fifoHead = queue[0];
  let nextVeh = fifoHead;

  // Deadlock zone merge: 직전 edge 차량 우선
  if (isDeadlockZoneMerge(nodeName, state)) {
    for (const veh of queue) {
      if (isVehicleApproachingMerge(veh, nodeName, state)) {
        nextVeh = veh;
        break;
      }
    }
  }

  // ★ FIFO 위반 시 ZONE_PREEMPT 기록 (queue 1등이 아닌 차량 grant)
  // holderVehId 필드에 박탈당한 큐 1등 vehId, extra 에 그 차량의 큐 위치 (= 0, 항상 head)
  if (nextVeh !== fifoHead) {
    emitDetail(state, nextVeh, nodeName, LockDetailType.ZONE_PREEMPT, fifoHead, queue.indexOf(nextVeh));
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
        // ★ DZ_GATE_AUTO_REQ — cp 우회로 큐 push (holder=현재holder, extra=push 후 큐 길이)
        emitDetail(state, vehId, toNode, LockDetailType.DZ_GATE_AUTO_REQ,
          holder ?? -1, state.queues.get(toNode)?.length ?? 0);
      }

      // grant 시도 (holder가 없을 때)
      if (holder === undefined) {
        grantNextInQueue(toNode, state, eName);
        if (state.locks.get(toNode) === vehId) {
          // ★ DZ_GATE_AUTO_GRANT — auto-REQ 직후 holder=undefined 였어서 이 차량이 즉시 grant
          emitDetail(state, vehId, toNode, LockDetailType.DZ_GATE_AUTO_GRANT);
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
          // ★ DZ_GATE_BLOCK — 차량이 cp 발화 없이 자동 정지됨 (holder=현재 holder)
          emitDetail(state, vehId, toNode, LockDetailType.DZ_GATE_BLOCK,
            state.locks.get(toNode) ?? -1);
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

// ============================================================================
// Deadlock holder swap — DZ merge holder 가 stuck 일 때 ready queued 로 이전
// ============================================================================

/** holder 가 정지로 간주되는 시간 (ms) — 이 이상 vel=0 이면 swap 후보 */
const HOLDER_STUCK_THRESHOLD_MS = 2000;

/** holder 별 정지 시작 ts (nodeName → ts). holder 바뀌거나 움직이면 reset */
const stuckHolderSince = new Map<string, number>();
const stuckHolderVeh = new Map<string, number>();

/**
 * DZ merge holder 가 너무 오래 정지 + queue 에 ready 한 차량 있으면 holder 강제 이전.
 *
 * 시나리오 (logs/20260504_2014):
 *   49 가 N0304 holder 인데 본인이 진행 못함 (앞에 89, 89 는 N0542 대기, etc)
 *   376 은 edge 849 ratio 0 LOCKED — N0304 락만 받으면 즉시 통과 가능
 *   → 49 의 N0304 락을 376 에게 이전.
 *
 * 조건:
 *   - DZ merge 만 (deadlockZoneMerges 안)
 *   - holder 가 vel=0 으로 HOLDER_STUCK_THRESHOLD_MS 이상
 *   - queue 에 STOP_REASON.LOCKED + currentEdge.to_node === merge 인 차량 (= ready)
 */
export function detectAndSwapDeadlockedHolders(
  state: LockMgrState,
  simulationTime: number,
  eName: (idx: number) => string
): void {
  if (!state.deadlockZoneMerges || !state.vehicleDataArray) return;
  if (state.deadlockZoneMerges.size === 0) return;
  const data = state.vehicleDataArray;

  for (const nodeName of state.deadlockZoneMerges) {
    const holder = state.locks.get(nodeName);
    if (holder === undefined) {
      stuckHolderSince.delete(nodeName);
      stuckHolderVeh.delete(nodeName);
      continue;
    }

    // holder 변경 감지 — reset
    if (stuckHolderVeh.get(nodeName) !== holder) {
      stuckHolderVeh.set(nodeName, holder);
      stuckHolderSince.delete(nodeName);
    }

    const ptr = holder * VEHICLE_DATA_SIZE;
    const vel = data[ptr + MovementData.VELOCITY];

    if (vel > 0.01) {
      stuckHolderSince.delete(nodeName);
      continue;
    }

    // ★ over-aggressive swap 방지: holder 가 아직 merge incoming edge 위면 skip.
    //   - 곡선 진입 직후 일시적 감속도 vel=0 (실제 stuck 아님)
    //   - swap target 도 같은 incoming chain 에 있을 가능성 → swap 무의미
    //   holder 가 incoming edge 위 = currentEdge.to_node === merge node
    const holderEdgeIdx = Math.trunc(data[ptr + MovementData.CURRENT_EDGE]);
    if (holderEdgeIdx >= 1) {
      const holderEdge = state.edges[holderEdgeIdx - 1];
      if (holderEdge && holderEdge.to_node === nodeName) {
        stuckHolderSince.delete(nodeName);
        continue;
      }
    }

    // 정지 상태 — 시간 누적
    if (!stuckHolderSince.has(nodeName)) {
      stuckHolderSince.set(nodeName, simulationTime);
      continue;
    }

    const stuckMs = simulationTime - stuckHolderSince.get(nodeName)!;
    if (stuckMs < HOLDER_STUCK_THRESHOLD_MS) continue;

    // ready 한 queued 차량 찾기 (LOCKED + incoming edge 위)
    const queue = state.queues.get(nodeName);
    if (!queue || queue.length <= 1) continue;

    let swapTarget: number | null = null;
    for (const qVeh of queue) {
      if (qVeh === holder) continue;
      const qPtr = qVeh * VEHICLE_DATA_SIZE;
      const qStop = data[qPtr + LogicData.STOP_REASON];
      if (!(qStop & StopReason.LOCKED)) continue;
      const qEdgeIdx = Math.trunc(data[qPtr + MovementData.CURRENT_EDGE]);
      if (qEdgeIdx < 1) continue;
      const qEdge = state.edges[qEdgeIdx - 1];
      if (!qEdge || qEdge.to_node !== nodeName) continue;
      // 후보 발견
      swapTarget = qVeh;
      break;
    }

    if (swapTarget === null) continue;

    performHolderSwap(state, nodeName, holder, swapTarget, eName);
    stuckHolderSince.delete(nodeName);
    stuckHolderVeh.set(nodeName, swapTarget);
  }
}

/**
 * holder 강제 이전.
 * - newHolder 를 queue 에서 제거 + state.locks 에 set
 * - oldHolder 는 queue 에서 제거 (cp 가 다시 LOCK_REQUEST 하면 재진입)
 * - LOCK_RELEASE / LOCK_GRANT 이벤트 emit
 * - newHolder 의 STOP_REASON.LOCKED 클리어 + LOCK_WAIT cp flag 클리어
 */
function performHolderSwap(
  state: LockMgrState,
  nodeName: string,
  oldHolder: number,
  newHolder: number,
  _eName: (idx: number) => string
): void {
  const queue = state.queues.get(nodeName);
  if (queue) {
    const newIdx = queue.indexOf(newHolder);
    if (newIdx !== -1) queue.splice(newIdx, 1);
    const oldIdx = queue.indexOf(oldHolder);
    if (oldIdx !== -1) queue.splice(oldIdx, 1);
  }
  state.locks.set(nodeName, newHolder);

  // 이벤트 emit
  if (state.onLockEvent && state.nodeNameToIndex) {
    const nodeIdx = state.nodeNameToIndex.get(nodeName) ?? 0;
    state.onLockEvent(oldHolder, nodeIdx, LockEventType.RELEASE, 0, -1);
    state.onLockEvent(newHolder, nodeIdx, LockEventType.GRANT, 0, -1);
  }

  // newHolder 정지 해제
  if (state.vehicleDataArray) {
    const data = state.vehicleDataArray;
    const ptr = newHolder * VEHICLE_DATA_SIZE;
    data[ptr + LogicData.STOP_REASON] &= ~StopReason.LOCKED;
    data[ptr + MovementData.MOVING_STATUS] = MovingStatus.MOVING;
    const targetEdgeIdx = Math.trunc(data[ptr + LogicData.CURRENT_CP_TARGET]);
    const targetEdge = targetEdgeIdx >= 1 ? state.edges[targetEdgeIdx - 1] : null;
    if (targetEdge?.from_node === nodeName) {
      data[ptr + LogicData.CURRENT_CP_FLAGS] &= ~CheckpointFlags.LOCK_WAIT;
    }
    state.waitingVehicles.delete(newHolder);
  }

  // pendingReleases 정리: oldHolder 의 nodeName 항목 제거 (더 이상 holder 아님)
  const oldReleases = state.pendingReleases.get(oldHolder);
  if (oldReleases) {
    const ri = oldReleases.findIndex(r => r.nodeName === nodeName);
    if (ri >= 0) oldReleases.splice(ri, 1);
  }

  // DEV_LOCK_DETAIL: DEADLOCK_SWAP (holder=oldHolder, extra=0)
  emitDetail(state, newHolder, nodeName, LockDetailType.DEADLOCK_SWAP, oldHolder, 0);
}
