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

interface ReservedEdge {
  edgeId: string;
  targetRatio?: number;
}

export class TransferMgr {
  private transferQueue: number[] = [];
  // Store reserved next edge for each vehicle: vehId -> {edgeId, targetRatio}
  private readonly reservedNextEdges: Map<number, ReservedEdge> = new Map();

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
   * Assign a command to a specific vehicle with validation.
   * Case 1: Same edge movement (nextEdgeId empty or same as current)
   *   - Validates targetRatio > currentRatio
   * Case 2: Edge transition (nextEdgeId different from current)
   *   - Validates nextEdge is connected to currentEdge
   *   - Sets current edge to 1.0, reserves nextEdge
   */
  assignCommand(
    vehId: number,
    command: VehicleCommand,
    vehicleDataArray: IVehicleDataArray | undefined,
    edgeArray: Edge[] | undefined,
    edgeNameToIndex: Map<string, number> | undefined
  ) {
    console.log(`[TransferMgr] assignCommand vehId=${vehId}, command=`, command);

    if (!vehicleDataArray || !edgeArray || !edgeNameToIndex) {
      console.error(`[TransferMgr] Missing required data for command validation`);
      return;
    }

    const data = vehicleDataArray.getData();
    const ptr = vehId * VEHICLE_DATA_SIZE;

    // Get current vehicle state
    const currentEdgeIndex = Math.trunc(data[ptr + MovementData.CURRENT_EDGE]);
    const currentEdge = edgeArray[currentEdgeIndex];
    const currentRatio = data[ptr + MovementData.EDGE_RATIO];

    if (!currentEdge) {
      console.error(`[TransferMgr] Vehicle ${vehId} has invalid current edge ${currentEdgeIndex}`);
      return;
    }

    const { targetRatio, nextEdgeId } = command;

    // Case 1: Same edge movement (no nextEdgeId or same as current)
    if (!nextEdgeId || nextEdgeId === currentEdge.edge_name) {
      if (targetRatio === undefined) {
        console.warn(`[TransferMgr] No targetRatio provided for same-edge movement`);
        return;
      }

      // Validate: targetRatio must be greater than current
      if (targetRatio <= currentRatio) {
        console.error(
          `[TransferMgr] Invalid command: targetRatio ${targetRatio} <= currentRatio ${currentRatio}`
        );
        return;
      }

      // Update target ratio
      const clampedRatio = Math.max(0, Math.min(1, targetRatio));
      data[ptr + MovementData.TARGET_RATIO] = clampedRatio;
      console.log(`[TransferMgr] Vehicle ${vehId} target ratio set to ${clampedRatio} on current edge`);
    }
    // Case 2: Edge transition
    else {
      // Validate: nextEdge must be connected to currentEdge
      const nextEdgeIndex = edgeNameToIndex.get(nextEdgeId);
      
      if (nextEdgeIndex === undefined) {
        console.error(`[TransferMgr] Edge ${nextEdgeId} not found in map`);
        return;
      }

      if (!currentEdge.nextEdgeIndices?.includes(nextEdgeIndex)) {
        console.error(
          `[TransferMgr] Invalid transition: ${nextEdgeId} not connected to ${currentEdge.edge_name}`
        );
        return;
      }

      // Set current edge to go to end (trigger transition)
      data[ptr + MovementData.TARGET_RATIO] = 1.0;
      console.log(`[TransferMgr] Vehicle ${vehId} current edge target set to 1.0 for transition`);

      // Reserve next edge with targetRatio (will be applied after transition)
      const clampedRatio = targetRatio !== undefined ? Math.max(0, Math.min(1, targetRatio)) : undefined;
      this.reservedNextEdges.set(vehId, { edgeId: nextEdgeId, targetRatio: clampedRatio });
      console.log(`[TransferMgr] Vehicle ${vehId} reserved next edge: ${nextEdgeId}, targetRatio: ${clampedRatio}`);
    }

    // Wake up vehicle if stopped
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
        mode,
        vehicleDataArray
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
    mode: TransferMode,
    vehicleDataArray: IVehicleDataArray
  ): number {
    if (this.canDirectlyTransition(currentEdge)) {
      return currentEdge.nextEdgeIndices![0];
    }

    if (mode === TransferMode.MQTT_CONTROL) {
      // MQTT_CONTROL
      return this.getNextEdgeFromCommand(vehicleIndex, edgeNameToIndex, vehicleDataArray);
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
    edgeNameToIndex: Map<string, number>,
    vehicleDataArray?: IVehicleDataArray
  ): number {
    const reserved = this.reservedNextEdges.get(vehicleIndex);
    if (reserved) {
      const idx = edgeNameToIndex.get(reserved.edgeId);
      if (idx === undefined) {
        console.warn(`[TransferMgr] Reserved edge ${reserved.edgeId} not found`);
      } else {
        // Apply targetRatio for new edge if specified
        if (reserved.targetRatio !== undefined && vehicleDataArray) {
          const data = vehicleDataArray.getData();
          const ptr = vehicleIndex * VEHICLE_DATA_SIZE;
          data[ptr + MovementData.TARGET_RATIO] = reserved.targetRatio;
          console.log(`[TransferMgr] Applied targetRatio ${reserved.targetRatio} to vehicle ${vehicleIndex} on new edge`);
        }
        
        // Command consumed (one-time use)
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
