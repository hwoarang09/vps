// common/vehicle/logic/TransferMgr.ts

import type { Edge } from "@/types/edge";
import { EdgeType } from "@/types";
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
  /** Path array for multi-edge reservation (for speed control optimization) */
  path?: Array<{edgeId: string; targetRatio?: number}>;
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

/**
 * 곡선 사전 감속 상태
 */
export interface CurveBrakeState {
  /** 감속 시작했는지 */
  isBraking: boolean;
  /** 목표 곡선 Edge 이름 */
  targetCurveEdge: string | null;
}

export class TransferMgr {
  private transferQueue: number[] = [];
  // Store reserved next edge for each vehicle: vehId -> ReservedEdge[]
  private readonly reservedNextEdges: Map<number, ReservedEdge[]> = new Map();
  // Store reserved path for each vehicle: vehId -> Array<{edgeId, targetRatio}>
  // Used for multi-edge reservation to enable speed control optimization
  private readonly reservedPaths: Map<number, Array<ReservedEdge>> = new Map();
  // 곡선 감속 상태 (단순화)
  private readonly curveBrakeStates: Map<number, CurveBrakeState> = new Map();

  enqueueVehicleTransfer(vehicleIndex: number) {
    this.transferQueue.push(vehicleIndex);
  }

  getTransferQueueLength() {
    return this.transferQueue.length;
  }

  /**
   * Checks if the vehicle has any pending commands (Reserved Edges or Path).
   */
  hasPendingCommands(vehId: number): boolean {
    const queue = this.reservedNextEdges.get(vehId);
    if (queue && queue.length > 0) return true;
    
    const path = this.reservedPaths.get(vehId);
    if (path && path.length > 0) return true;

    return false;
  }

  clearQueue() {
    this.transferQueue = [];
    this.reservedNextEdges.clear();
    this.reservedPaths.clear();
    this.curveBrakeStates.clear();
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
    if (!this.validateCommandData(vehicleDataArray, edgeArray, edgeNameToIndex)) return;

    const data = vehicleDataArray!.getData();
    const ptr = vehId * VEHICLE_DATA_SIZE;
    const currentEdgeIndex = Math.trunc(data[ptr + MovementData.CURRENT_EDGE]);
    const currentEdge = edgeArray![currentEdgeIndex];

    if (!currentEdge) {
      console.error(`[TransferMgr] Vehicle ${vehId} has invalid current edge ${currentEdgeIndex}`);
      return;
    }

    const { targetRatio, nextEdgeId, path } = command;

    if (path && path.length > 0) {
      this.processPathCommand(vehId, path, currentEdge, edgeArray!, edgeNameToIndex!, data, ptr);
    }

    if (!nextEdgeId || nextEdgeId === currentEdge.edge_name) {
      // If we are just setting target on current edge, we normally check currentRatio
      // BUT if there is a queue, "current edge" might conceptually be the last queued edge?
      // For now, let's assume same-edge command applies to the ACTUAL current edge immediately.
      // If the user wants to set target on a FUTURE edge, they should use the queue/path.
      const currentRatio = data[ptr + MovementData.EDGE_RATIO];
      this.processSameEdgeCommand(vehId, targetRatio, currentRatio, data, ptr);
    } else {
      this.processEdgeTransitionCommand({
        vehId,
        nextEdgeId,
        targetRatio,
        currentEdge,
        edgeArray: edgeArray!,
        edgeNameToIndex: edgeNameToIndex!,
        data,
        ptr
      });
    }

    this.ensureVehicleAwake(data, ptr, vehId);
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

    if (mode === TransferMode.MQTT_CONTROL || mode === TransferMode.AUTO_ROUTE) {
      // MQTT_CONTROL or AUTO_ROUTE - both use reserved paths/commands
      return this.getNextEdgeFromCommand(vehicleIndex, edgeNameToIndex, currentEdge.edge_name);
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
    currentEdgeName?: string
  ): number {
    // Check path queue first (multi-edge reservation)
    const activePathEdge = this.handlePathQueue(vehicleIndex, edgeNameToIndex, currentEdgeName);
    if (activePathEdge !== null) {
      return activePathEdge;
    }

    // Fall back to manual reservation queue
    const queue = this.reservedNextEdges.get(vehicleIndex);
    if (queue && queue.length > 0) {
      // 현재 Edge와 같은 이름은 건너뛰기
      while (queue.length > 0 && currentEdgeName && queue[0].edgeId === currentEdgeName) {
        queue.shift();
      }

      if (queue.length > 0) {
        const nextReserved = queue[0]; // Peek
        const idx = edgeNameToIndex.get(nextReserved.edgeId);
        if (idx !== undefined) {
          return idx;
        }
      }
    }
    // Return -1 to indicate waiting/stop if no command
    return -1;
  }

  /**
   * Consumes and returns the reserved target ratio for the given vehicle.
   * This is called when the vehicle actually transitions to the next edge.
   */
  consumeNextEdgeReservation(vehId: number): number | undefined {
    const queue = this.reservedNextEdges.get(vehId);
    if (!queue || queue.length === 0) return undefined;

    // Shift the first reservation
    const reservation = queue.shift()!;
    const ratio = reservation.targetRatio;
    
    // Cleanup if empty
    if (queue.length === 0) {
      this.reservedNextEdges.delete(vehId);
    }
    
    return ratio;
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

  // --- Helper Methods ---

  private validateCommandData(
    vehicleDataArray: IVehicleDataArray | undefined,
    edgeArray: Edge[] | undefined,
    edgeNameToIndex: Map<string, number> | undefined
  ): boolean {
    if (!vehicleDataArray || !edgeArray || !edgeNameToIndex) {
      console.error(`[TransferMgr] Missing required data for command validation`);
      return false;
    }
    return true;
  }

  private processPathCommand(
    vehId: number,
    path: Array<{ edgeId: string; targetRatio?: number }>,
    currentEdge: Edge,
    edgeArray: Edge[],
    edgeNameToIndex: Map<string, number>,
    data: Float32Array,
    ptr: number
  ) {
    // Clear existing reservations when a new path is processed
    this.reservedNextEdges.delete(vehId);

    let prevEdge = currentEdge;
    for (const pathItem of path) {
      const pathEdgeId = pathItem.edgeId;
      const pathEdgeIndex = edgeNameToIndex.get(pathEdgeId);

      if (pathEdgeIndex === undefined) {
        console.error(`[TransferMgr] Path edge ${pathEdgeId} not found`);
        return;
      }

      if (!prevEdge.nextEdgeIndices?.includes(pathEdgeIndex)) {
        console.error(`[TransferMgr] Path edge ${pathEdgeId} not connected to ${prevEdge.edge_name}`);
        return;
      }

      prevEdge = edgeArray[pathEdgeIndex];
    }

    this.reservedPaths.set(vehId, path.map(p => ({
      edgeId: p.edgeId,
      targetRatio: p.targetRatio
    })));

    data[ptr + MovementData.TARGET_RATIO] = 1;
  }

  private processSameEdgeCommand(
    _vehId: number,
    targetRatio: number | undefined,
    currentRatio: number,
    data: Float32Array,
    ptr: number
  ) {
    if (targetRatio === undefined) {
      return;
    }

    if (targetRatio <= currentRatio) {
      return;
    }

    const clampedRatio = Math.max(0, Math.min(1, targetRatio));
    data[ptr + MovementData.TARGET_RATIO] = clampedRatio;
  }

  private processEdgeTransitionCommand(params: {
    vehId: number;
    nextEdgeId: string;
    targetRatio: number | undefined;
    currentEdge: Edge;
    edgeArray: Edge[];
    edgeNameToIndex: Map<string, number>;
    data: Float32Array;
    ptr: number;
  }) {
    const {
      vehId,
      nextEdgeId,
      targetRatio,
      currentEdge,
      edgeArray,
      edgeNameToIndex,
      data,
      ptr,
    } = params;
    // Determine connection reference: Last queued edge OR current edge
    let referenceEdge = currentEdge;
    const queue = this.reservedNextEdges.get(vehId);
    
    if (queue && queue.length > 0) {
      const lastReserved = queue.at(-1)!;
      const lastEdgeIndex = edgeNameToIndex.get(lastReserved.edgeId);
      if (lastEdgeIndex !== undefined) {
        referenceEdge = edgeArray[lastEdgeIndex];
      }
    }

    const nextEdgeIndex = edgeNameToIndex.get(nextEdgeId);

    if (nextEdgeIndex === undefined || !referenceEdge.nextEdgeIndices?.includes(nextEdgeIndex)) {
      return;
    }

    // Only set if we are adding the FIRST item to the queue
    if (!queue || queue.length === 0) {
      data[ptr + MovementData.TARGET_RATIO] = 1;
    }

    const clampedRatio = targetRatio === undefined ? undefined : Math.max(0, Math.min(1, targetRatio));

    if (!this.reservedNextEdges.has(vehId)) {
      this.reservedNextEdges.set(vehId, []);
    }
    this.reservedNextEdges.get(vehId)!.push({ edgeId: nextEdgeId, targetRatio: clampedRatio });
  }

  private ensureVehicleAwake(data: Float32Array, ptr: number, _vehId: number) {
    const currentStatus = data[ptr + MovementData.MOVING_STATUS];
    if (currentStatus === MovingStatus.STOPPED) {
      data[ptr + MovementData.MOVING_STATUS] = MovingStatus.MOVING;
    }
  }

  private handlePathQueue(
    vehicleIndex: number,
    edgeNameToIndex: Map<string, number>,
    currentEdgeName?: string
  ): number | null {
    const path = this.reservedPaths.get(vehicleIndex);
    if (!path || path.length === 0) return null;

    // 현재 Edge와 같은 이름의 Edge는 건너뛰기 (경로가 오래된 경우 대비)
    while (path.length > 0 && currentEdgeName && path[0].edgeId === currentEdgeName) {
      path.shift();
    }

    if (path.length === 0) {
      this.reservedPaths.delete(vehicleIndex);
      return null;
    }

    const nextEdge = path.shift()!;
    const idx = edgeNameToIndex.get(nextEdge.edgeId);

    if (idx === undefined) {
      return null;
    }

    const queue = this.reservedNextEdges.get(vehicleIndex) || [];
    if (!this.reservedNextEdges.has(vehicleIndex)) {
      this.reservedNextEdges.set(vehicleIndex, queue);
    }

    let rRatio: number | undefined = undefined;
    if (path.length > 0) {
      rRatio = 1;
    } else if (nextEdge.targetRatio !== undefined) {
      rRatio = nextEdge.targetRatio;
    }

    queue.push({
      edgeId: nextEdge.edgeId,
      targetRatio: rRatio
    });

    if (path.length === 0) {
      this.reservedPaths.delete(vehicleIndex);
    }

    return idx;
  }

  // ============================================================================
  // 곡선 사전 감속 (단순화된 버전)
  // ============================================================================

  /**
   * 차량의 전체 예약 경로 반환 (현재 Edge 제외)
   */
  getFullReservedPath(vehId: number): string[] {
    const result: string[] = [];

    const queue = this.reservedNextEdges.get(vehId);
    if (queue) {
      for (const e of queue) {
        result.push(e.edgeId);
      }
    }

    const path = this.reservedPaths.get(vehId);
    if (path) {
      for (const e of path) {
        result.push(e.edgeId);
      }
    }

    return result;
  }

  /**
   * 현재 위치에서 다음 곡선까지의 거리 계산
   * @returns { distance: 곡선까지 거리, curveEdge: 곡선 Edge 이름 } 또는 null (곡선 없음)
   */
  findDistanceToNextCurve(
    vehId: number,
    currentEdge: Edge,
    currentRatio: number,
    edgeArray: Edge[],
    edgeNameToIndex: Map<string, number>
  ): { distance: number; curveEdge: string; curveType: string } | null {
    // 현재 Edge 남은 거리
    let accumulatedDistance = currentEdge.distance * (1 - currentRatio);
    const currentEdgeName = currentEdge.edge_name;

    // 1. 먼저 예약된 경로에서 찾기 (MQTT_CONTROL, AUTO_ROUTE 모드)
    const fullPath = this.getFullReservedPath(vehId);

    if (fullPath.length > 0) {
      // 현재 Edge 이후의 경로만 사용 (현재 Edge와 같은 이름은 건너뜀)
      let foundCurrentEdge = false;

      for (const edgeId of fullPath) {
        // 현재 Edge와 같은 이름이면 건너뜀 (경로가 오래된 경우 대비)
        if (edgeId === currentEdgeName) {
          foundCurrentEdge = true;
          continue;
        }

        const edgeIndex = edgeNameToIndex.get(edgeId);
        if (edgeIndex === undefined) continue;

        const edge = edgeArray[edgeIndex];
        if (!edge) continue;

        // 곡선 발견!
        if (edge.vos_rail_type !== EdgeType.LINEAR) {
          return {
            distance: accumulatedDistance,
            curveEdge: edge.edge_name,
            curveType: edge.vos_rail_type
          };
        }

        accumulatedDistance += edge.distance;
      }

      // 경로에서 곡선을 못 찾았으면 nextEdgeIndices로 폴백
      if (!foundCurrentEdge) {
        return null;
      }
    }

    // 2. 예약 경로 없거나 현재 Edge 이후로 곡선 없으면 nextEdgeIndices 따라가기
    const MAX_LOOKAHEAD = 10;
    let edge = currentEdge;
    const visited = new Set<string>();
    visited.add(edge.edge_name);

    for (let i = 0; i < MAX_LOOKAHEAD; i++) {
      if (!edge.nextEdgeIndices || edge.nextEdgeIndices.length === 0) {
        break;
      }

      const nextEdgeIndex = edge.nextEdgeIndices[0];
      const nextEdge = edgeArray[nextEdgeIndex];
      if (!nextEdge) break;

      if (visited.has(nextEdge.edge_name)) {
        break;
      }
      visited.add(nextEdge.edge_name);

      if (nextEdge.vos_rail_type !== EdgeType.LINEAR) {
        return {
          distance: accumulatedDistance,
          curveEdge: nextEdge.edge_name,
          curveType: nextEdge.vos_rail_type
        };
      }

      accumulatedDistance += nextEdge.distance;
      edge = nextEdge;
    }

    return null;
  }

  /**
   * 감속 상태 조회
   */
  getCurveBrakeState(vehId: number): CurveBrakeState {
    let state = this.curveBrakeStates.get(vehId);
    if (!state) {
      state = { isBraking: false, targetCurveEdge: null };
      this.curveBrakeStates.set(vehId, state);
    }
    return state;
  }

  /**
   * 감속 시작
   */
  startCurveBraking(vehId: number, targetCurveEdge: string): void {
    this.curveBrakeStates.set(vehId, {
      isBraking: true,
      targetCurveEdge
    });
  }

  /**
   * 감속 상태 초기화 (곡선 진입 후)
   */
  clearCurveBrakeState(vehId: number): void {
    this.curveBrakeStates.delete(vehId);
  }

  /**
   * Edge 전환 완료 시 호출 - 경로에서 해당 Edge 제거
   */
  onEdgeTransition(vehId: number, passedEdgeName: string): void {
    // reservedNextEdges에서 제거
    const queue = this.reservedNextEdges.get(vehId);
    if (queue && queue.length > 0 && queue[0].edgeId === passedEdgeName) {
      queue.shift();
      if (queue.length === 0) {
        this.reservedNextEdges.delete(vehId);
      }
    }

    // reservedPaths에서 제거
    const path = this.reservedPaths.get(vehId);
    if (path && path.length > 0 && path[0].edgeId === passedEdgeName) {
      path.shift();
      if (path.length === 0) {
        this.reservedPaths.delete(vehId);
      }
    }
  }
}
