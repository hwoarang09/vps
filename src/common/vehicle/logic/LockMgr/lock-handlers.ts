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
import { isVehicleInDeadlockZone, grantNextInQueue } from "./deadlock-zone";

/** Lock 이벤트를 콜백에 전달 */
function emitLockEvent(
  state: LockMgrState,
  vehId: number,
  nodeName: string,
  eventType: number,
  waitMs: number = 0
): void {
  if (!state.onLockEvent || !state.nodeNameToIndex) return;
  const nodeIdx = state.nodeNameToIndex.get(nodeName) ?? 0;
  state.onLockEvent(vehId, nodeIdx, eventType, waitMs);
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
    // Deadlock zone preemption: 나=zone-internal, holder=zone-external → 선점
    const iAmInZone = isVehicleInDeadlockZone(vehicleId, state);
    const holderInZone = isVehicleInDeadlockZone(holder, state);

    if (iAmInZone && !holderInZone) {
      // holder의 lock 회수 → 나에게 grant (holder는 큐에 잔류)
      state.locks.set(nodeName, vehicleId);
      state.waitingVehicles.delete(vehicleId);
      data[ptr + LogicData.STOP_REASON] &= ~StopReason.LOCKED;
      data[ptr + MovementData.MOVING_STATUS] = MovingStatus.MOVING;
      return true;
    }

    // 다른 차량이 lock 보유 → 강제 정지
    data[ptr + MovementData.VELOCITY] = 0;
    data[ptr + MovementData.MOVING_STATUS] = MovingStatus.STOPPED;
    data[ptr + LogicData.STOP_REASON] |= StopReason.LOCKED;
    // WAIT 이벤트는 최초 진입 시 1회만 emit
    if (!state.waitingVehicles.has(vehicleId)) {
      state.waitingVehicles.add(vehicleId);
      emitLockEvent(state, vehicleId, nodeName, LockEventType.WAIT);
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

/**
 * 경로 변경 시 새 경로에 없는 merge node의 orphaned lock 즉시 해제
 * processPathCommand() 에서 새 경로 설정 직전에 호출
 */
export function releaseOrphanedLocks(
  vehicleId: number,
  newPathMergeNodes: Set<string>,
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
      // 새 경로에도 있는 merge node
      if (holder === vehicleId) {
        continue; // GRANT 받은 lock → 유지 (이미 잡은 건 풀 이유 없음)
      }
      // 아직 GRANT 안 받음 (큐 대기 중) → 큐에서 cancel
      // 신 경로의 LOCK_REQUEST checkpoint에서 물리적 순서에 맞게 다시 REQ
      cancelFromQueue(nodeName, vehicleId, state);
      if (logCtx) {
        console.warn(
          `[LockMgr] VEH ${vehicleId}: pending lock REQUEUED (path change) — ${nodeName}` +
          ` | edge: ${logCtx.currentEdgeName}` +
          ` | old: [${logCtx.oldEdges.join('→')}]` +
          ` → new: [${logCtx.newEdges.join('→')}]`
        );
      }
      releases.splice(i, 1);
      continue;
    }

    // 새 경로에 없는 merge node → 완전 제거
    if (holder === vehicleId) {
      // lock 보유 중 → release + 다음 차량 grant
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
      // 큐에 있지만 아직 grant 안 됨 → 큐에서만 제거
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
