// LockMgr/snapshot.ts
// Lock 상태 스냅샷 (UI용)

import {
  MovementData,
  VEHICLE_DATA_SIZE,
} from "@/common/vehicle/initialize/constants";
import type { LockMgrState } from "./types";

/**
 * Lock 상태 스냅샷 반환 (Lock Info Panel용)
 * - 현재 활성 lock/queue가 있는 노드만 반환
 */
export function getLockSnapshot(
  state: LockMgrState,
  eName: (idx: number) => string
): Array<{
  nodeName: string;
  holderVehId: number | undefined;
  holderEdge: string;
  waiters: Array<{ vehId: number; edgeName: string }>;
}> {
  const result: Array<{
    nodeName: string;
    holderVehId: number | undefined;
    holderEdge: string;
    waiters: Array<{ vehId: number; edgeName: string }>;
  }> = [];

  // 활성 노드 수집 (lock 또는 queue가 있는 노드)
  const activeNodes = new Set<string>();
  for (const nodeName of state.locks.keys()) activeNodes.add(nodeName);
  for (const [nodeName, queue] of state.queues) {
    if (queue.length > 0) activeNodes.add(nodeName);
  }

  for (const nodeName of activeNodes) {
    const holder = state.locks.get(nodeName);
    const queue = state.queues.get(nodeName) ?? [];

    const waiters: Array<{ vehId: number; edgeName: string }> = [];
    for (const vehId of queue) {
      if (vehId === holder) continue; // holder는 granted에 표시
      waiters.push({ vehId, edgeName: getVehicleEdgeName(vehId, state, eName) });
    }

    result.push({
      nodeName,
      holderVehId: holder,
      holderEdge: holder === undefined ? '' : getVehicleEdgeName(holder, state, eName),
      waiters,
    });
  }

  return result;
}

/**
 * Vehicle의 현재 edge name 조회
 */
function getVehicleEdgeName(
  vehId: number,
  state: LockMgrState,
  eName: (idx: number) => string
): string {
  if (!state.vehicleDataArray) return '?';
  const ptr = vehId * VEHICLE_DATA_SIZE;
  const edgeIdx = Math.trunc(state.vehicleDataArray[ptr + MovementData.CURRENT_EDGE]);
  return eName(edgeIdx);
}
