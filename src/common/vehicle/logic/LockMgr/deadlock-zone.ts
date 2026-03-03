// LockMgr/deadlock-zone.ts
// Deadlock zone 우선순위 처리 로직

import {
  MovementData,
  VEHICLE_DATA_SIZE,
} from "@/common/vehicle/initialize/constants";
import type { LockMgrState } from "./types";

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
}
