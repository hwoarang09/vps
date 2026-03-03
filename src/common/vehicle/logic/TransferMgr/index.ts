// TransferMgr/index.ts

import type { Edge } from "@/types/edge";
import { EdgeType } from "@/types";
import {
  MovementData,
  NextEdgeState,
  VEHICLE_DATA_SIZE,
  TransferMode,
  MovingStatus,
  NEXT_EDGE_COUNT,
  CHECKPOINT_SECTION_SIZE,
  CHECKPOINT_FIELDS,
  MAX_CHECKPOINTS_PER_VEHICLE,
  LogicData,
  type Checkpoint,
} from "@/common/vehicle/initialize/constants";
import { buildCheckpointsFromPath, logCheckpoints } from "../checkpoint";
import type {
  VehicleLoop,
  ProcessPathCommandContext,
  ILockMgrForNextEdge,
  FillNextEdgesContext,
  IVehicleDataArray,
  VehicleCommand,
  ReservedEdge,
  CurveBrakeState,
} from "./types";
import {
  MAX_PATH_LENGTH,
  PATH_LEN,
  PATH_EDGES_START,
  getNextEdgeInLoop,
} from "./types";
import { fillFirstNextEdge, fillSubsequentNextEdge } from "./next-edge-handlers";

// Types imported from ./types.ts

export class TransferMgr {
  private transferQueue: number[] = [];
  // Store reserved next edge for each vehicle: vehId -> ReservedEdge[]
  private readonly reservedNextEdges: Map<number, ReservedEdge[]> = new Map();
  // Path buffer from autoMgr (SharedArrayBuffer - Int32Array)
  // Layout: [len, edge0, edge1, ..., edge98] per vehicle (실제 shift 방식)
  private pathBufferFromAutoMgr: Int32Array | null = null;
  // Checkpoint buffer (SharedArrayBuffer - Float32Array)
  private checkpointBuffer: Float32Array | null = null;
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

  /**
   * Set checkpoint buffer reference (called from FabContext)
   */
  setCheckpointBuffer(checkpointBuffer: Float32Array): void {
    this.checkpointBuffer = checkpointBuffer;
  }

  /**
   * Get checkpoint buffer reference
   */
  getCheckpointBuffer(): Float32Array | null {
    return this.checkpointBuffer;
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
      const len = this.pathBufferFromAutoMgr[ptr + PATH_LEN];
      if (len > 0) return true;
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
    edgeNameToIndex: Map<string, number> | undefined,
    lockMgr?: ILockMgrForNextEdge
  ) {
    if (!this.validateCommandData(vehicleDataArray, edgeArray, edgeNameToIndex)) return;

    const data = vehicleDataArray!.getData();
    const ptr = vehId * VEHICLE_DATA_SIZE;
    const currentEdgeIndex = Math.trunc(data[ptr + MovementData.CURRENT_EDGE]);
    if (currentEdgeIndex < 1) return; // 1-based: 0 is invalid
    const currentEdge = edgeArray![currentEdgeIndex - 1]; // Convert to 0-based for array access

    if (!currentEdge) {
      return;
    }

    const { targetRatio, nextEdgeId, path } = command;

    if (path && path.length > 0) {
      this.processPathCommand({
        vehId,
        path,
        currentEdge,
        edgeArray: edgeArray!,
        edgeNameToIndex: edgeNameToIndex!,
        data,
        ptr,
        lockMgr,
      });
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
    mode: TransferMode,
    lockMgr?: ILockMgrForNextEdge
  ) {
    const data = vehicleDataArray.getData();

    const queueLength = this.transferQueue.length;
    for (let i = 0; i < queueLength; i++) {
      const vehId = this.transferQueue.shift();
      if (vehId === undefined) break;

      const ptr = vehId * VEHICLE_DATA_SIZE;

      const currentEdgeIdx = Math.trunc(data[ptr + MovementData.CURRENT_EDGE]);
      if (currentEdgeIdx < 1) { // 1-based: 0 is invalid
        data[ptr + MovementData.NEXT_EDGE_STATE] = NextEdgeState.EMPTY;
        continue;
      }
      const currentEdge = edgeArray[currentEdgeIdx - 1]; // Convert to 0-based for array access

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

      if (nextEdgeIndex === 0) {
        // If no valid next edge found (0 is invalid sentinel in 1-based indexing)
        // In MQTT_CONTROL mode, this effectively stops/waits if no command is present
        data[ptr + MovementData.NEXT_EDGE_STATE] = NextEdgeState.EMPTY;
      } else {
        // 5개의 next edge를 채우기
        this.fillNextEdges({
          data,
          ptr,
          firstNextEdgeIndex: nextEdgeIndex,
          edgeArray,
          vehicleLoopMap,
          edgeNameToIndex,
          mode,
          vehicleIndex: vehId,
          lockMgr,
        });
      }
    }
  }

  /**
   * 경로 시작 시 NEXT_EDGE 초기화
   * 첫 번째 checkpoint가 있는 edge까지만 채움
   */
  private initNextEdgesForStart(
    data: Float32Array,
    ptr: number,
    vehicleIndex: number
  ): void {
    if (!this.pathBufferFromAutoMgr) return;

    const pathPtr = vehicleIndex * MAX_PATH_LENGTH;
    const pathLen = this.pathBufferFromAutoMgr[pathPtr + PATH_LEN];

    // 첫 번째 checkpoint의 targetEdge 읽기 (MOVE_PREPARE가 어떤 edge를 위한 것인지)
    const firstCpTargetEdge = data[ptr + LogicData.CURRENT_CP_TARGET];

    const nextEdgeOffsets = [
      MovementData.NEXT_EDGE_0,
      MovementData.NEXT_EDGE_1,
      MovementData.NEXT_EDGE_2,
      MovementData.NEXT_EDGE_3,
      MovementData.NEXT_EDGE_4,
    ];

    const filledEdges: number[] = [];

    for (let i = 0; i < NEXT_EDGE_COUNT; i++) {
      if (i >= pathLen) {
        data[ptr + nextEdgeOffsets[i]] = 0;
        filledEdges.push(0);
        continue;
      }

      const edgeIdx = this.pathBufferFromAutoMgr[pathPtr + PATH_EDGES_START + i];
      if (edgeIdx < 1) {
        data[ptr + nextEdgeOffsets[i]] = 0;
        filledEdges.push(0);
        continue;
      }

      data[ptr + nextEdgeOffsets[i]] = edgeIdx;
      filledEdges.push(edgeIdx);

      // 첫 번째 checkpoint의 targetEdge까지만 채움
      if (firstCpTargetEdge > 0 && edgeIdx === firstCpTargetEdge) {
        // 나머지는 0으로
        for (let j = i + 1; j < NEXT_EDGE_COUNT; j++) {
          data[ptr + nextEdgeOffsets[j]] = 0;
        }
        break;
      }
    }

    data[ptr + MovementData.NEXT_EDGE_STATE] = filledEdges[0] > 0 ? NextEdgeState.READY : NextEdgeState.EMPTY;

  }

  // fillFirstNextEdge and fillSubsequentNextEdge moved to next-edge-handlers.ts

  /**
   * Loop map에서 next edges 결정
   */
  private fillNextEdgesFromLoopMap(
    ctx: FillNextEdgesContext,
    nextEdgeOffsets: number[]
  ): void {
    const { data, ptr, firstNextEdgeIndex } = ctx;
    let currentEdgeIdx = firstNextEdgeIndex;

    for (let i = 0; i < NEXT_EDGE_COUNT; i++) {
      if (i === 0) {
        fillFirstNextEdge(data, ptr, firstNextEdgeIndex, nextEdgeOffsets[i]);
      } else {
        currentEdgeIdx = fillSubsequentNextEdge(
          i,
          currentEdgeIdx,
          ctx,
          nextEdgeOffsets,
          this.determineNextEdge.bind(this)
        );
        if (currentEdgeIdx === 0) break;
      }
    }

    data[ptr + MovementData.NEXT_EDGE_STATE] = NextEdgeState.READY;
  }

  /**
   * NEXT_EDGE_0 ~ NEXT_EDGE_4를 채움
   */
  private fillNextEdges(ctx: FillNextEdgesContext): void {
    const { mode } = ctx;
    const nextEdgeOffsets = [
      MovementData.NEXT_EDGE_0,
      MovementData.NEXT_EDGE_1,
      MovementData.NEXT_EDGE_2,
      MovementData.NEXT_EDGE_3,
      MovementData.NEXT_EDGE_4,
    ];

    const usePathBuffer = this.pathBufferFromAutoMgr &&
      (mode === TransferMode.MQTT_CONTROL || mode === TransferMode.AUTO_ROUTE);

    if (usePathBuffer) {
      // 새 설계: checkpoint 기반으로 NEXT_EDGE 관리
      // initNextEdgesForStart는 processPathCommand에서 이미 호출됨
      // 여기서는 아무것도 안 함 (checkpoint에서 관리)
      // checkpoint based - no-op
    } else {
      this.fillNextEdgesFromLoopMap(ctx, nextEdgeOffsets);
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
    // Return 0 to indicate waiting/stop if no command (0 is invalid sentinel)
    return 0;
  }

  /**
   * Consumes and returns the reserved target ratio for the given vehicle.
   * This is called when the vehicle actually transitions to the next edge.
   * NOTE: pathBuffer shift는 shiftAndRefillNextEdges()에서 수행 (transition 성공 시에만)
   */
  consumeNextEdgeReservationFromPathBuffer(vehId: number): number | undefined {
    // Handle reservedNextEdges queue only
    // pathBuffer shift는 edgeTransition.ts의 shiftAndRefillNextEdges()에서 수행
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
    return 0; // 0 is invalid sentinel
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
    let nextEdgeIndex = 0; // 0 is invalid sentinel
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

    if (nextEdgeIndex === 0 && currentEdge.nextEdgeIndices?.length) {
      nextEdgeIndex = currentEdge.nextEdgeIndices[0];
    }

    return nextEdgeIndex;
  }

  // --- Helper Methods ---

  /**
   * Path 연결성 검증 및 edge indices 반환
   * @returns edge indices 배열 또는 연결이 끊긴 경우 null
   */
  private validatePathConnectivity(
    path: Array<{ edgeId: string; targetRatio?: number }>,
    currentEdge: Edge,
    edgeArray: Edge[],
    edgeNameToIndex: Map<string, number>
  ): number[] | null {
    let prevEdge = currentEdge;
    const edgeIndices: number[] = [];

    for (const pathItem of path) {
      const pathEdgeIndex = edgeNameToIndex.get(pathItem.edgeId);

      if (pathEdgeIndex === undefined) {
        return null;
      }

      if (!prevEdge.nextEdgeIndices?.includes(pathEdgeIndex)) {
        return null;
      }

      edgeIndices.push(pathEdgeIndex);
      prevEdge = edgeArray[pathEdgeIndex - 1]; // Convert to 0-based for array access
    }

    return edgeIndices;
  }

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

  private processPathCommand(ctx: ProcessPathCommandContext) {
    // 구조 분해
    const { vehId, path, currentEdge, edgeArray, edgeNameToIndex, data, ptr, lockMgr } = ctx;

    // Clear existing reservations when a new path is processed
    this.reservedNextEdges.delete(vehId);

    // Validate path connectivity
    const edgeIndices = this.validatePathConnectivity(path, currentEdge, edgeArray, edgeNameToIndex);
    if (!edgeIndices) {
      return;
    }

    // Write to path buffer
    if (this.pathBufferFromAutoMgr) {
      const pathPtr = vehId * MAX_PATH_LENGTH;
      this.pathBufferFromAutoMgr[pathPtr + PATH_LEN] = edgeIndices.length;

      for (let i = 0; i < edgeIndices.length && i < MAX_PATH_LENGTH - PATH_EDGES_START; i++) {
        this.pathBufferFromAutoMgr[pathPtr + PATH_EDGES_START + i] = edgeIndices[i];
      }

      // Checkpoint 생성 (경로가 설정되는 시점에 한 번만)
      // 현재 edge를 포함하여 builder가 첫 edge 진입 checkpoint도 생성하도록 함
      if (this.checkpointBuffer && lockMgr) {
        const currentEdgeIdx = Math.trunc(data[ptr + MovementData.CURRENT_EDGE]);
        const edgeIndicesWithCurrent = currentEdgeIdx > 0
          ? [currentEdgeIdx, ...edgeIndices]
          : edgeIndices;
        this.buildCheckpoints(vehId, edgeIndicesWithCurrent, edgeArray, lockMgr, data, ptr);
      }

      // 첫 번째 checkpoint까지 NEXT_EDGE 채움
      this.initNextEdgesForStart(data, ptr, vehId);
    } else {
      // no pathBuffer available
    }

    data[ptr + MovementData.TARGET_RATIO] = 1;
  }

  /**
   * Checkpoint 생성 (경로 설정 시 한 번만 호출)
   * 새로운 checkpoint builder 사용
   */
  private buildCheckpoints(
    vehId: number,
    edgeIndices: number[],
    edgeArray: Edge[],
    lockMgr: ILockMgrForNextEdge,
    data: Float32Array,
    ptr: number
  ): void {
    if (!this.checkpointBuffer) return;

    // 🆕 checkpoint builder 사용
    const result = buildCheckpointsFromPath({
      edgeIndices,
      edgeArray,
      isMergeNode: (nodeName) => lockMgr.isMergeNode(nodeName),
    });

    logCheckpoints(vehId, result.checkpoints);

    // Checkpoint 배열에 저장
    this.saveCheckpoints(vehId, result.checkpoints, data, ptr);
  }

  /**
   * Checkpoint를 배열에 저장하고 첫 번째 checkpoint를 VehicleDataArray에 로드
   */
  private saveCheckpoints(
    vehId: number,
    checkpoints: Checkpoint[],
    data: Float32Array,
    ptr: number
  ): void {
    if (!this.checkpointBuffer) return;

    const vehicleOffset = 1 + vehId * CHECKPOINT_SECTION_SIZE;
    const count = Math.min(checkpoints.length, MAX_CHECKPOINTS_PER_VEHICLE);

    // Count 저장
    this.checkpointBuffer[vehicleOffset] = count;

    // Checkpoint 저장
    for (let i = 0; i < count; i++) {
      const cpOffset = vehicleOffset + 1 + i * CHECKPOINT_FIELDS;
      this.checkpointBuffer[cpOffset + 0] = checkpoints[i].edge;
      this.checkpointBuffer[cpOffset + 1] = checkpoints[i].ratio;
      this.checkpointBuffer[cpOffset + 2] = checkpoints[i].flags;
      this.checkpointBuffer[cpOffset + 3] = checkpoints[i].targetEdge;
    }

    // 첫 번째 checkpoint를 CURRENT_CP_*에 로드
    if (count > 0) {
      data[ptr + LogicData.CURRENT_CP_EDGE] = checkpoints[0].edge;
      data[ptr + LogicData.CURRENT_CP_RATIO] = checkpoints[0].ratio;
      data[ptr + LogicData.CURRENT_CP_FLAGS] = checkpoints[0].flags;
      data[ptr + LogicData.CURRENT_CP_TARGET] = checkpoints[0].targetEdge;
      data[ptr + LogicData.CHECKPOINT_HEAD] = 1;  // 다음에 로드할 인덱스 = 1
    } else {
      data[ptr + LogicData.CURRENT_CP_EDGE] = 0;
      data[ptr + LogicData.CURRENT_CP_RATIO] = 0;
      data[ptr + LogicData.CURRENT_CP_FLAGS] = 0;
      data[ptr + LogicData.CURRENT_CP_TARGET] = 0;
      data[ptr + LogicData.CHECKPOINT_HEAD] = 0;
    }

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
      if (lastEdgeIndex !== undefined && lastEdgeIndex >= 1) {
        referenceEdge = edgeArray[lastEdgeIndex - 1]; // Convert to 0-based for array access
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
    _edgeNameToIndex: Map<string, number>,
    _currentEdgeName?: string
  ): number | null {
    if (!this.pathBufferFromAutoMgr) return null;

    const pathPtr = vehicleIndex * MAX_PATH_LENGTH;
    const len = this.pathBufferFromAutoMgr[pathPtr + PATH_LEN];

    if (len <= 0) return null;

    // Get next edge index from path buffer (항상 인덱스 0)
    const nextEdgeIdx = this.pathBufferFromAutoMgr[pathPtr + PATH_EDGES_START];

    // Validate edge index (1-based: must be >= 1)
    if (nextEdgeIdx < 1) return null;

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
      const len = this.pathBufferFromAutoMgr[pathPtr + PATH_LEN];

      for (let i = 0; i < len; i++) {
        const edgeIdx = this.pathBufferFromAutoMgr[pathPtr + PATH_EDGES_START + i];
        if (edgeIdx >= 1) { // 1-based: 0 is invalid
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
      if (edgeIndex < 1) continue; // 1-based: 0 is invalid
      const edge = edgeArray[edgeIndex - 1]; // Convert to 0-based for array access
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
      if (nextEdgeIndex < 1) break; // 1-based: 0 is invalid
      const nextEdge = edgeArray[nextEdgeIndex - 1]; // Convert to 0-based for array access
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
   * 다음 edge 검증 및 가져오기
   * @returns nextEdge 또는 null (중단 조건)
   */
  private validateAndGetNextEdge(
    edge: Edge,
    edgeArray: Edge[],
    visited: Set<string>
  ): Edge | null {
    if (!edge.nextEdgeIndices || edge.nextEdgeIndices.length === 0) {
      return null;
    }

    const nextEdgeIndex = edge.nextEdgeIndices[0];
    if (nextEdgeIndex < 1) return null;

    const nextEdge = edgeArray[nextEdgeIndex - 1];
    if (!nextEdge) return null;

    if (visited.has(nextEdge.edge_name)) {
      return null;
    }

    return nextEdge;
  }

  /**
   * Merge node 체크 및 거리 계산
   * @returns merge 정보 또는 null
   */
  private checkMergeAndCalculateDistance(
    nextEdge: Edge,
    accumulatedDistance: number,
    isMergeNode: (nodeName: string) => boolean
  ): { distance: number; mergeEdge: Edge } | null {
    if (isMergeNode(nextEdge.to_node)) {
      const isCurve = nextEdge.vos_rail_type !== EdgeType.LINEAR;
      return {
        distance: isCurve ? accumulatedDistance : accumulatedDistance + nextEdge.distance,
        mergeEdge: nextEdge
      };
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
      const nextEdge = this.validateAndGetNextEdge(edge, edgeArray, visited);
      if (!nextEdge) break;

      visited.add(nextEdge.edge_name);

      const mergeResult = this.checkMergeAndCalculateDistance(nextEdge, accumulatedDistance, isMergeNode);
      if (mergeResult) return mergeResult;

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
      if (edgeIndex < 1) continue; // 1-based: 0 is invalid
      const edge = edgeArray[edgeIndex - 1]; // Convert to 0-based for array access
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

// ============================================================================
// Re-exports
// ============================================================================

export type {
  VehicleLoop,
  ProcessPathCommandContext,
  ILockMgrForNextEdge,
  FillNextEdgesContext,
  IVehicleDataArray,
  VehicleCommand,
  ReservedEdge,
  CurveBrakeState,
} from "./types";

export {
  MAX_PATH_LENGTH,
  PATH_LEN,
  PATH_EDGES_START,
  getNextEdgeInLoop,
} from "./types";
