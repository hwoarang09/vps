// LockMgr/deadlock-zone.ts
// Deadlock zone 우선순위 처리 로직

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
 * 차량이 deadlock zone 내부 edge에 있는지 확인
 * (분기점→합류점 edge, e.g. E286, E549, E397, E722)
 */
export function isVehicleInDeadlockZone(
  vehId: number,
  state: LockMgrState
): boolean {
  if (!state.vehicleDataArray) return false;
  const ptr = vehId * VEHICLE_DATA_SIZE;
  const curEdgeIdx = state.vehicleDataArray[ptr + MovementData.CURRENT_EDGE];
  if (curEdgeIdx < 1) return false;
  const edge = state.edges[curEdgeIdx - 1];
  return edge?.isDeadlockZoneInside === true;
}

/**
 * 큐 다음 차량에 grant (zone-internal 우선)
 */
export function grantNextInQueue(
  nodeName: string,
  state: LockMgrState,
  _eName: (idx: number) => string
): void {
  const queue = state.queues.get(nodeName);
  if (!queue || queue.length === 0) return;

  // Deadlock zone priority: zone-internal 차량 우선 grant
  let nextVeh = queue[0];
  for (const veh of queue) {
    if (isVehicleInDeadlockZone(veh, state)) {
      nextVeh = veh;
      break;
    }
  }

  state.locks.set(nodeName, nextVeh);

  // Grant 받은 차량이 이 노드의 LOCK_WAIT로 대기 중이면 즉시 해제
  // (processCheckpoint가 다음 틱에 처리하기 전에 checkAutoRelease가 race condition으로
  //  release를 조기 발화해 다음 차량에게 재GRANT하는 것을 방지)
  // 주의: CURRENT_CP_TARGET이 이 노드의 exit edge를 가리킬 때만 해제
  //       다른 노드를 기다리다 멈춘 차량의 LOCK_WAIT를 잘못 클리어하지 않도록
  if (state.vehicleDataArray) {
    const ptr = nextVeh * VEHICLE_DATA_SIZE;
    const data = state.vehicleDataArray;
    if (data[ptr + LogicData.STOP_REASON] & StopReason.LOCKED) {
      const targetEdgeIdx = Math.trunc(data[ptr + LogicData.CURRENT_CP_TARGET]);
      const targetEdge = targetEdgeIdx >= 1 ? state.edges[targetEdgeIdx - 1] : null;
      if (targetEdge?.from_node === nodeName) {
        data[ptr + LogicData.STOP_REASON] &= ~StopReason.LOCKED;
        data[ptr + MovementData.MOVING_STATUS] = MovingStatus.MOVING;
        const cpFlags = data[ptr + LogicData.CURRENT_CP_FLAGS];
        if (cpFlags & CheckpointFlags.LOCK_WAIT) {
          data[ptr + LogicData.CURRENT_CP_FLAGS] = cpFlags & ~CheckpointFlags.LOCK_WAIT;
        }
        state.waitingVehicles.delete(nextVeh);
      }
    }
  }

  // GRANT 이벤트 emit
  if (state.onLockEvent && state.nodeNameToIndex) {
    const nodeIdx = state.nodeNameToIndex.get(nodeName) ?? 0;
    state.onLockEvent(nextVeh, nodeIdx, LockEventType.GRANT, 0, -1);
  }
}
