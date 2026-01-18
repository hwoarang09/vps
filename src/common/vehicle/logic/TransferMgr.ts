// common/vehicle/logic/TransferMgr.ts

import type { Edge } from "@/types/edge";
import { EdgeType } from "@/types";
import {
  MovementData,
  NextEdgeState,
  VEHICLE_DATA_SIZE,
  TransferMode,
  MovingStatus,
  NEXT_EDGE_COUNT,
} from "@/common/vehicle/initialize/constants";

/**
 * Path buffer layout constants
 * Layout: [currentIdx, totalLen, edge0, edge1, ..., edge97]
 */
export const MAX_PATH_LENGTH = 100;
export const PATH_CURRENT_IDX = 0;
export const PATH_TOTAL_LEN = 1;
export const PATH_EDGES_START = 2;

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
  // Path buffer from autoMgr (SharedArrayBuffer - Int32Array)
  // Layout: [currentIdx, totalLen, edge0, edge1, ..., edge97] per vehicle
  private pathBufferFromAutoMgr: Int32Array | null = null;
  // 곡선 감속 상태 (단순화)
  private readonly curveBrakeStates: Map<number, CurveBrakeState> = new Map();

  /**
   * Set path buffer reference (called from EngineStore or FabContext)
   */
  setPathBufferFromAutoMgr(pathBuffer: Int32Array): void {
    this.pathBufferFromAutoMgr = pathBuffer;
  }

  /**
   * Get path buffer reference (for edge transition refill)
   */
  getPathBufferFromAutoMgr(): Int32Array | null {
    return this.pathBufferFromAutoMgr;
  }

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

    // Check path buffer
    if (this.pathBufferFromAutoMgr) {
      const ptr = vehId * MAX_PATH_LENGTH;
      const currentIdx = this.pathBufferFromAutoMgr[ptr + PATH_CURRENT_IDX];
      const totalLen = this.pathBufferFromAutoMgr[ptr + PATH_TOTAL_LEN];
      if (currentIdx < totalLen) return true;
    }

    return false;
  }

  clearQueue() {
    this.transferQueue = [];
    this.reservedNextEdges.clear();
    this.curveBrakeStates.clear();

    // Clear path buffer
    if (this.pathBufferFromAutoMgr) {
      this.pathBufferFromAutoMgr.fill(0);
    }
  }

  /**
   * Clear path buffer for a specific vehicle
   */
  clearVehiclePath(vehId: number): void {
    if (!this.pathBufferFromAutoMgr) return;

    const pathPtr = vehId * MAX_PATH_LENGTH;
    for (let i = 0; i < MAX_PATH_LENGTH; i++) {
      this.pathBufferFromAutoMgr[pathPtr + i] = 0;
    }

    // Also clear reservations
    this.reservedNextEdges.delete(vehId);
    this.curveBrakeStates.delete(vehId);
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
        // 5개의 next edge를 채우기
        this.fillNextEdges(
          data,
          ptr,
          nextEdgeIndex,
          edgeArray,
          vehicleLoopMap,
          edgeNameToIndex,
          mode,
          vehId
        );
      }
    }
  }

  /**
   * NEXT_EDGE_0 ~ NEXT_EDGE_4를 채움
   */
  private fillNextEdges(
    data: Float32Array,
    ptr: number,
    firstNextEdgeIndex: number,
    edgeArray: Edge[],
    vehicleLoopMap: Map<number, VehicleLoop>,
    edgeNameToIndex: Map<string, number>,
    mode: TransferMode,
    vehicleIndex: number
  ): void {
    const nextEdgeOffsets = [
      MovementData.NEXT_EDGE_0,
      MovementData.NEXT_EDGE_1,
      MovementData.NEXT_EDGE_2,
      MovementData.NEXT_EDGE_3,
      MovementData.NEXT_EDGE_4,
    ];

    // Path buffer가 있으면 직접 순차적으로 읽기
    if (this.pathBufferFromAutoMgr && (mode === TransferMode.MQTT_CONTROL || mode === TransferMode.AUTO_ROUTE)) {
      const pathPtr = vehicleIndex * MAX_PATH_LENGTH;
      const currentIdx = this.pathBufferFromAutoMgr[pathPtr + PATH_CURRENT_IDX];
      const totalLen = this.pathBufferFromAutoMgr[pathPtr + PATH_TOTAL_LEN];

      for (let i = 0; i < NEXT_EDGE_COUNT; i++) {
        const pathOffset = currentIdx + i;
        if (pathOffset < totalLen) {
          const edgeIdx = this.pathBufferFromAutoMgr[pathPtr + PATH_EDGES_START + pathOffset];
          data[ptr + nextEdgeOffsets[i]] = edgeIdx >= 0 ? edgeIdx : -1;
        } else {
          data[ptr + nextEdgeOffsets[i]] = -1;
        }
      }

      data[ptr + MovementData.NEXT_EDGE_STATE] = NextEdgeState.READY;
      return;
    }

    // Path buffer가 없으면 기존 방식 사용
    let currentEdgeIdx = firstNextEdgeIndex;

    for (let i = 0; i < NEXT_EDGE_COUNT; i++) {
      if (i === 0) {
        // 첫 번째는 이미 결정됨
        data[ptr + nextEdgeOffsets[i]] = firstNextEdgeIndex;
      } else {
        // 이전 edge의 next edge 결정
        const prevEdge = edgeArray[currentEdgeIdx];
        if (!prevEdge) {
          data[ptr + nextEdgeOffsets[i]] = -1;
          continue;
        }

        const nextIdx = this.determineNextEdge(
          prevEdge,
          vehicleIndex,
          vehicleLoopMap,
          edgeNameToIndex,
          mode
        );

        data[ptr + nextEdgeOffsets[i]] = nextIdx;

        if (nextIdx === -1) {
          // 더 이상 next edge 없음 - 나머지는 -1로 채움
          for (let j = i + 1; j < NEXT_EDGE_COUNT; j++) {
            data[ptr + nextEdgeOffsets[j]] = -1;
          }
          break;
        }

        currentEdgeIdx = nextIdx;
      }
    }

    data[ptr + MovementData.NEXT_EDGE_STATE] = NextEdgeState.READY;
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
   * Also advances currentIdx in path buffer.
   */
  consumeNextEdgeReservationFromPathBuffer(vehId: number): number | undefined {
    // Advance path buffer currentIdx (if path exists)
    if (this.pathBufferFromAutoMgr) {
      const pathPtr = vehId * MAX_PATH_LENGTH;
      const currentIdx = this.pathBufferFromAutoMgr[pathPtr + PATH_CURRENT_IDX];
      const totalLen = this.pathBufferFromAutoMgr[pathPtr + PATH_TOTAL_LEN];

      if (currentIdx < totalLen) {
        this.pathBufferFromAutoMgr[pathPtr + PATH_CURRENT_IDX] = currentIdx + 1;
      }
    }

    // Handle reservedNextEdges queue
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

    // Validate path connectivity
    let prevEdge = currentEdge;
    const edgeIndices: number[] = [];

    for (const pathItem of path) {
      const pathEdgeId = pathItem.edgeId;
      const pathEdgeIndex = edgeNameToIndex.get(pathEdgeId);

      if (pathEdgeIndex === undefined) {
        return;
      }

      if (!prevEdge.nextEdgeIndices?.includes(pathEdgeIndex)) {
        return;
      }

      edgeIndices.push(pathEdgeIndex);
      prevEdge = edgeArray[pathEdgeIndex];
    }

    // Write to path buffer
    if (this.pathBufferFromAutoMgr) {
      const pathPtr = vehId * MAX_PATH_LENGTH;
      this.pathBufferFromAutoMgr[pathPtr + PATH_CURRENT_IDX] = 0;
      this.pathBufferFromAutoMgr[pathPtr + PATH_TOTAL_LEN] = edgeIndices.length;

      for (let i = 0; i < edgeIndices.length && i < MAX_PATH_LENGTH - PATH_EDGES_START; i++) {
        this.pathBufferFromAutoMgr[pathPtr + PATH_EDGES_START + i] = edgeIndices[i];
      }
    }

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
    if (!this.pathBufferFromAutoMgr) return null;

    const pathPtr = vehicleIndex * MAX_PATH_LENGTH;
    const currentIdx = this.pathBufferFromAutoMgr[pathPtr + PATH_CURRENT_IDX];
    const totalLen = this.pathBufferFromAutoMgr[pathPtr + PATH_TOTAL_LEN];

    if (currentIdx >= totalLen) return null;

    // Get next edge index from path buffer
    const nextEdgeIdx = this.pathBufferFromAutoMgr[pathPtr + PATH_EDGES_START + currentIdx];

    // Validate edge index
    if (nextEdgeIdx < 0) return null;

    // Skip current edge if it matches (path might be stale)
    // This shouldn't happen normally, but defensive check
    // Note: We can't easily check edge name without edgeArray, so just return the index

    return nextEdgeIdx;
  }

  // ============================================================================
  // 곡선 사전 감속 (단순화된 버전)
  // ============================================================================

  /**
   * 차량의 전체 예약 경로 반환 (edge indices)
   * @returns Array of edge indices from current position to end
   */
  getFullReservedPath(vehId: number): number[] {
    const result: number[] = [];

    // Get from path buffer
    if (this.pathBufferFromAutoMgr) {
      const pathPtr = vehId * MAX_PATH_LENGTH;
      const currentIdx = this.pathBufferFromAutoMgr[pathPtr + PATH_CURRENT_IDX];
      const totalLen = this.pathBufferFromAutoMgr[pathPtr + PATH_TOTAL_LEN];

      for (let i = currentIdx; i < totalLen; i++) {
        const edgeIdx = this.pathBufferFromAutoMgr[pathPtr + PATH_EDGES_START + i];
        if (edgeIdx >= 0) {
          result.push(edgeIdx);
        }
      }
    }

    return result;
  }

  /**
   * 예약된 경로에서 다음 곡선을 찾는 헬퍼 함수
   */
  private findCurveInReservedPath(
    vehId: number,
    edgeArray: Edge[],
    initialDistance: number
  ): { distance: number; curveEdge: string; curveType: string } | null {
    const fullPath = this.getFullReservedPath(vehId);
    if (fullPath.length === 0) return null;

    let accumulatedDistance = initialDistance;

    for (const edgeIndex of fullPath) {
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

    return null;
  }

  /**
   * 현재 위치에서 다음 곡선까지의 거리 계산
   * @returns { distance: 곡선까지 거리, curveEdge: 곡선 Edge 이름 } 또는 null (곡선 없음)
   */
  findDistanceToNextCurve(
    vehId: number,
    currentEdge: Edge,
    currentRatio: number,
    edgeArray: Edge[]
  ): { distance: number; curveEdge: string; curveType: string } | null {
    // 현재 Edge 남은 거리
    const remainingDistance = currentEdge.distance * (1 - currentRatio);

    // 1. 먼저 예약된 경로에서 찾기 (MQTT_CONTROL, AUTO_ROUTE 모드)
    const curveInPath = this.findCurveInReservedPath(vehId, edgeArray, remainingDistance);
    if (curveInPath) {
      return curveInPath;
    }

    // 예약된 경로가 있었다면 그 안에 곡선이 없다는 의미이므로 null 반환
    const fullPath = this.getFullReservedPath(vehId);
    if (fullPath.length > 0) {
      return null;
    }

    // 2. 예약 경로 없으면 nextEdgeIndices 따라가기 (폴백)
    const MAX_LOOKAHEAD = 10;
    let edge = currentEdge;
    let accumulatedDistance = remainingDistance;
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
   * 다음 merge point까지의 거리 찾기
   * lockMgr를 사용해서 merge node 확인
   */
  findDistanceToNextMerge(
    vehId: number,
    currentEdge: Edge,
    currentRatio: number,
    edgeArray: Edge[],
    isMergeNode: (nodeName: string) => boolean
  ): { distance: number; mergeEdge: Edge } | null {
    // 현재 Edge 남은 거리
    const remainingDistance = currentEdge.distance * (1 - currentRatio);

    // 1. 먼저 예약된 경로에서 찾기
    const mergeInPath = this.findMergeInReservedPath(vehId, edgeArray, remainingDistance, isMergeNode);
    if (mergeInPath) {
      return mergeInPath;
    }

    // 예약된 경로가 있었다면 그 안에 merge가 없다는 의미이므로 null 반환
    const fullPath = this.getFullReservedPath(vehId);
    if (fullPath.length > 0) {
      return null;
    }

    // 2. 예약 경로 없으면 nextEdgeIndices 따라가기
    const MAX_LOOKAHEAD = 10;
    let edge = currentEdge;
    let accumulatedDistance = remainingDistance;
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

      // merge node 체크
      if (isMergeNode(nextEdge.to_node)) {
        // 곡선 merge edge는 fn(시작점)까지, 직선 merge edge는 tn(끝점)까지의 거리
        const isCurve = nextEdge.vos_rail_type !== EdgeType.LINEAR;
        return {
          distance: isCurve ? accumulatedDistance : accumulatedDistance + nextEdge.distance,
          mergeEdge: nextEdge
        };
      }

      accumulatedDistance += nextEdge.distance;
      edge = nextEdge;
    }

    return null;
  }

  /**
   * 예약된 경로에서 merge edge 찾기
   */
  private findMergeInReservedPath(
    vehId: number,
    edgeArray: Edge[],
    currentEdgeRemainingDistance: number,
    isMergeNode: (nodeName: string) => boolean
  ): { distance: number; mergeEdge: Edge } | null {
    const fullPath = this.getFullReservedPath(vehId);
    if (fullPath.length === 0) return null;

    let accumulatedDistance = currentEdgeRemainingDistance;

    for (const edgeIndex of fullPath) {
      const edge = edgeArray[edgeIndex];
      if (!edge) continue;

      if (isMergeNode(edge.to_node)) {
        // 곡선 merge edge는 fn(시작점)까지, 직선 merge edge는 tn(끝점)까지의 거리
        const isCurve = edge.vos_rail_type !== EdgeType.LINEAR;
        return {
          distance: isCurve ? accumulatedDistance : accumulatedDistance + edge.distance,
          mergeEdge: edge
        };
      }

      accumulatedDistance += edge.distance;
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

    // Path buffer는 consumeNextEdgeReservationFromPathBuffer에서 자동으로 currentIdx 증가
  }
}
