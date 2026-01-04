// common/vehicle/logic/TransferMgr.ts

import type { Edge } from "@/types/edge";
import {
  MovementData,
  NextEdgeState,
  VEHICLE_DATA_SIZE,
  TransferMode,
  MovingStatus,
} from "@/common/vehicle/initialize/constants";

export type VehicleLoop = {
  edgeSequence: string[];
};

export interface IVehicleDataArray {
  getData(): Float32Array;
}

/**
 * Vehicle command structure for MQTT control
 */
export interface VehicleCommand {
  /** Target position on current edge (0~1) */
  targetRatio?: number;
  /** Next edge ID to transition to */
  nextEdgeId?: string;
}

export function getNextEdgeInLoop(
  currentEdgeName: string,
  sequence: string[]
): string {
  const idx = sequence.indexOf(currentEdgeName);
  if (idx === -1) return sequence[0];
  return sequence[(idx + 1) % sequence.length];
}

export class TransferMgr {
  private transferQueue: number[] = [];
  // Store reserved next edge for each vehicle: vehId -> edgeName
  private readonly reservedNextEdges: Map<number, string> = new Map();

  enqueueVehicleTransfer(vehicleIndex: number) {
    this.transferQueue.push(vehicleIndex);
  }

  getTransferQueueLength() {
    return this.transferQueue.length;
  }

  clearQueue() {
    this.transferQueue = [];
    this.reservedNextEdges.clear();
  }

  /**
   * Assign a command to a specific vehicle.
   * Supports targetRatio (position on current edge) and nextEdgeId (next edge to transition to).
   * Wakes up stopped vehicles automatically.
   */
  assignCommand(vehId: number, command: VehicleCommand, vehicleDataArray?: IVehicleDataArray) {
    if (!vehicleDataArray) return;

    const data = vehicleDataArray.getData();
    const ptr = vehId * VEHICLE_DATA_SIZE;

    // 1. Set target ratio (where to go on current edge, 0~1)
    if (command.targetRatio !== undefined) {
      const clampedRatio = Math.max(0, Math.min(1, command.targetRatio));
      data[ptr + MovementData.TARGET_RATIO] = clampedRatio;
      console.log(`[TransferMgr] Vehicle ${vehId} target ratio set to ${clampedRatio}`);
    }

    // 2. Reserve next edge (which edge to transition to after reaching end)
    if (command.nextEdgeId) {
      console.log(`[TransferMgr] Vehicle ${vehId} reserved next edge: ${command.nextEdgeId}`);
      this.reservedNextEdges.set(vehId, command.nextEdgeId);
    }

    // 3. Wake up vehicle if it was stopped
    const currentStatus = data[ptr + MovementData.MOVING_STATUS];
    if (currentStatus === MovingStatus.STOPPED) {
      data[ptr + MovementData.MOVING_STATUS] = MovingStatus.MOVING;
      console.log(`[TransferMgr] Vehicle ${vehId} woken up (STOPPED -> MOVING)`);
    }
  }

  processTransferQueue(
    vehicleDataArray: IVehicleDataArray,
    edgeArray: Edge[],
    vehicleLoopMap: Map<number, VehicleLoop>,
    edgeNameToIndex: Map<string, number>,
    mode: TransferMode
  ) {
    const data = vehicleDataArray.getData();

    const queueLength = this.transferQueue.length;
    for (let i = 0; i < queueLength; i++) {
      const vehId = this.transferQueue.shift();
      if (vehId === undefined) break;

      const ptr = vehId * VEHICLE_DATA_SIZE;

      const currentEdgeIdx = Math.trunc(data[ptr + MovementData.CURRENT_EDGE]);
      const currentEdge = edgeArray[currentEdgeIdx];

      if (!currentEdge) {
        data[ptr + MovementData.NEXT_EDGE_STATE] = NextEdgeState.EMPTY;
        continue;
      }

      const nextEdgeIndex = this.determineNextEdge(
        currentEdge,
        vehId,
        vehicleLoopMap,
        edgeNameToIndex,
        mode
      );

      if (nextEdgeIndex === -1) {
        // If no valid next edge found
        // In MQTT_CONTROL mode, this effectively stops/waits if no command is present
        data[ptr + MovementData.NEXT_EDGE_STATE] = NextEdgeState.EMPTY;
      } else {
        data[ptr + MovementData.NEXT_EDGE] = nextEdgeIndex;
        data[ptr + MovementData.NEXT_EDGE_STATE] = NextEdgeState.READY;
      }
    }
  }

  private determineNextEdge(
    currentEdge: Edge,
    vehicleIndex: number,
    vehicleLoopMap: Map<number, VehicleLoop>,
    edgeNameToIndex: Map<string, number>,
    mode: TransferMode
  ): number {
    if (this.canDirectlyTransition(currentEdge)) {
      return currentEdge.nextEdgeIndices![0];
    }

    if (mode === TransferMode.MQTT_CONTROL) {
      // MQTT_CONTROL
      return this.getNextEdgeFromCommand(vehicleIndex, edgeNameToIndex);
    } else if (mode === TransferMode.LOOP) {
      // LOOP
      return this.getNextEdgeFromLoop(
        currentEdge,
        vehicleIndex,
        vehicleLoopMap,
        edgeNameToIndex
      );
    } else {
      // RANDOM
      return this.getNextEdgeRandomly(currentEdge);
    }
  }

  private getNextEdgeFromCommand(
    vehicleIndex: number,
    edgeNameToIndex: Map<string, number>
  ): number {
    const reservedName = this.reservedNextEdges.get(vehicleIndex);
    if (reservedName) {
      const idx = edgeNameToIndex.get(reservedName);
      if (idx === undefined) {
        console.warn(`[TransferMgr] Reserved edge ${reservedName} not found`);
      } else {
        // Command consumed (one-time use for now)
        this.reservedNextEdges.delete(vehicleIndex);
        return idx;
      }
    }
    // Return -1 to indicate waiting/stop if no command
    return -1;
  }

  private getNextEdgeRandomly(currentEdge: Edge): number {
    if ((currentEdge.nextEdgeIndices?.length ?? 0) > 0) {
      const randomIndex = Math.floor(
        Math.random() * currentEdge.nextEdgeIndices!.length
      );
      return currentEdge.nextEdgeIndices![randomIndex];
    }
    return -1;
  }

  private canDirectlyTransition(currentEdge: Edge): boolean {
    return (
      !currentEdge.toNodeIsDiverge &&
      (currentEdge.nextEdgeIndices?.length ?? 0) > 0
    );
  }

  private getNextEdgeFromLoop(
    currentEdge: Edge,
    vehicleIndex: number,
    vehicleLoopMap: Map<number, VehicleLoop>,
    edgeNameToIndex: Map<string, number>
  ): number {
    let nextEdgeIndex = -1;
    const loop = vehicleLoopMap.get(vehicleIndex);

    if (loop) {
      const nextName = getNextEdgeInLoop(
        currentEdge.edge_name,
        loop.edgeSequence
      );
      const found = edgeNameToIndex.get(nextName);
      if (found === undefined) {
        // do nothing
      } else {
        nextEdgeIndex = found;
      }
    }

    if (nextEdgeIndex === -1 && currentEdge.nextEdgeIndices?.length) {
      nextEdgeIndex = currentEdge.nextEdgeIndices[0];
    }

    return nextEdgeIndex;
  }
}
