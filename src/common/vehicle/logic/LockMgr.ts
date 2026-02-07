// common/vehicle/logic/LockMgr.ts
// 새로운 단순한 락 시스템

import type { Edge } from "@/types/edge";
import type { Node } from "@/types/node";
import {
  CheckpointFlags,
  CHECKPOINT_SECTION_SIZE,
  CHECKPOINT_FIELDS,
  MovementData,
  LogicData,
  VEHICLE_DATA_SIZE,
  StopReason,
  MovingStatus,
  NextEdgeState,
  NEXT_EDGE_COUNT,
} from "@/common/vehicle/initialize/constants";
import { MAX_PATH_LENGTH, PATH_LEN, PATH_EDGES_START } from "./TransferMgr";
import { devLog } from "@/logger/DevLogger";

/**
 * Lock 정책 타입
 */
export type LockPolicyType = 'FIFO' | 'BATCH';

/**
 * Lock 정책 객체 - 확장 가능한 구조
 */
export interface LockPolicy {
  default: LockPolicyType;
  // 추후 확장 가능: nodeSpecific, edgeSpecific 등
}

/**
 * LockMgr - 단순한 락 시스템
 */
export class LockMgr {
  // 참조 저장
  private vehicleDataArray: Float32Array | null = null;
  private checkpointArray: Float32Array | null = null;
  private pathBuffer: Int32Array | null = null;
  private nodes: Node[] = [];
  private edges: Edge[] = [];

  // merge node 목록 (빠른 조회용)
  private mergeNodes = new Set<string>();
  // merge node -> 이름 매핑 (빠른 조회용)
  private mergeNodeNames = new Map<string, string>();

  // 락 상태
  private locks = new Map<string, number>();        // nodeName -> vehId (현재 잡고 있는 차량)
  private queues = new Map<string, number[]>();     // nodeName -> vehId[] (대기 큐)

  constructor() {}

  /**
   * 초기화 - 참조 저장
   */
  init(
    vehicleDataArray: Float32Array,
    nodes: Node[],
    edges: Edge[],
    checkpointArray: Float32Array | null = null,
    pathBuffer: Int32Array | null = null
  ): void {
    this.vehicleDataArray = vehicleDataArray;
    this.checkpointArray = checkpointArray;
    this.pathBuffer = pathBuffer;
    this.nodes = nodes;
    this.edges = edges;

    // merge node 목록 구축
    this.buildMergeNodes();
  }

  /**
   * Edge 정보에서 merge node 찾기
   */
  private buildMergeNodes(): void {
    this.mergeNodes.clear();
    this.mergeNodeNames.clear();
    const incomingCount = new Map<string, number>();

    for (const edge of this.edges) {
      const count = incomingCount.get(edge.to_node) ?? 0;
      incomingCount.set(edge.to_node, count + 1);
    }

    for (const [nodeName, count] of incomingCount) {
      if (count >= 2) {
        this.mergeNodes.add(nodeName);
        this.mergeNodeNames.set(nodeName, nodeName);
      }
    }
  }

  /**
   * 매 프레임 호출 - 전체 차량 순회
   */
  updateAll(numVehicles: number, policy: LockPolicy = { default: 'FIFO' }): void {
    for (let i = 0; i < numVehicles; i++) {
      this.processLock(i, policy);
    }
  }

  /**
   * 개별 차량 락 처리 (Checkpoint 시스템)
   */
  processLock(vehicleId: number, _policy: LockPolicy): void {
    if (!this.vehicleDataArray || !this.checkpointArray) {
      devLog.veh(vehicleId).debug(
        `[processLock] SKIP: dataArray=${!!this.vehicleDataArray} cpArray=${!!this.checkpointArray}`
      );
      return;
    }
    if (!this.nodes.length || !this.edges.length) {
      devLog.veh(vehicleId).debug(
        `[processLock] SKIP: nodes=${this.nodes.length} edges=${this.edges.length}`
      );
      return;
    }

    this.processCheckpoint(vehicleId);
  }

  /**
   * Checkpoint 기반 락 처리
   *
   * 새 설계:
   * 1. VehicleDataArray의 CURRENT_CP_* 필드 사용
   * 2. 각 flag 개별 처리 후 해당 flag 제거
   * 3. flags == 0이면 다음 checkpoint 로드
   */
  private processCheckpoint(vehicleId: number): void {
    if (!this.vehicleDataArray || !this.checkpointArray) return;

    const data = this.vehicleDataArray;
    const ptr = vehicleId * VEHICLE_DATA_SIZE;

    // 현재 checkpoint 읽기 (VehicleDataArray에서)
    let cpEdge = data[ptr + LogicData.CURRENT_CP_EDGE];
    let cpRatio = data[ptr + LogicData.CURRENT_CP_RATIO];
    let cpFlags = data[ptr + LogicData.CURRENT_CP_FLAGS];

    const currentEdge = data[ptr + MovementData.CURRENT_EDGE];
    const currentRatio = data[ptr + MovementData.EDGE_RATIO];
    const head = data[ptr + LogicData.CHECKPOINT_HEAD];

    // checkpoint가 없으면 로드 시도
    if (cpEdge === 0) {
      devLog.veh(vehicleId).debug(
        `[processCP] cpEdge=0, trying load. curE=${currentEdge} curR=${currentRatio.toFixed(3)} head=${head}`
      );
      if (!this.loadNextCheckpoint(vehicleId, data, ptr)) {
        return; // 더 이상 checkpoint 없음
      }
      // 새로 로드된 checkpoint 읽기
      cpEdge = data[ptr + LogicData.CURRENT_CP_EDGE];
      cpRatio = data[ptr + LogicData.CURRENT_CP_RATIO];
      cpFlags = data[ptr + LogicData.CURRENT_CP_FLAGS];
    }

    // 🚀 초고속 체크: 현재 위치가 checkpoint에 도달했는지
    if (currentEdge !== cpEdge) {
      devLog.veh(vehicleId).debug(
        `[processCP] SKIP edge mismatch: curE=${currentEdge} !== cpE=${cpEdge} curR=${currentRatio.toFixed(3)} cpR=${cpRatio.toFixed(3)} flags=${cpFlags} head=${head}`
      );
      return;
    }
    if (currentRatio < cpRatio) {
      devLog.veh(vehicleId).debug(
        `[processCP] SKIP ratio: curE=${currentEdge} curR=${currentRatio.toFixed(3)} < cpR=${cpRatio.toFixed(3)} flags=${cpFlags} head=${head}`
      );
      return;
    }

    // ✅ Checkpoint 도달!
    devLog.veh(vehicleId).debug(
      `[processCP] HIT! curE=${currentEdge} curR=${currentRatio.toFixed(3)} cpE=${cpEdge} cpR=${cpRatio.toFixed(3)} flags=${cpFlags} head=${head}`
    );

    // MOVE_PREPARE 처리 (가장 먼저 - edge 요청)
    if (cpFlags & CheckpointFlags.MOVE_PREPARE) {
      this.handleMovePrepare(vehicleId, data, ptr);
      cpFlags &= ~CheckpointFlags.MOVE_PREPARE;
      data[ptr + LogicData.CURRENT_CP_FLAGS] = cpFlags;
    }

    // LOCK_RELEASE 처리 (lock 해제)
    if (cpFlags & CheckpointFlags.LOCK_RELEASE) {
      this.handleLockRelease(vehicleId, data, ptr);
      cpFlags &= ~CheckpointFlags.LOCK_RELEASE;
      data[ptr + LogicData.CURRENT_CP_FLAGS] = cpFlags;
    }

    // LOCK_REQUEST 처리 (lock 요청)
    if (cpFlags & CheckpointFlags.LOCK_REQUEST) {
      const granted = this.handleLockRequest(vehicleId, data, ptr);
      if (granted) {
        cpFlags &= ~CheckpointFlags.LOCK_REQUEST;
        data[ptr + LogicData.CURRENT_CP_FLAGS] = cpFlags;
      }
    }

    // LOCK_WAIT 처리 (lock 대기)
    if (cpFlags & CheckpointFlags.LOCK_WAIT) {
      const granted = this.handleLockWait(vehicleId, data, ptr);
      if (granted) {
        cpFlags &= ~CheckpointFlags.LOCK_WAIT;
        data[ptr + LogicData.CURRENT_CP_FLAGS] = cpFlags;
      }
    }

    // flags가 0이면 → 다음 checkpoint 로드
    if (cpFlags === 0) {
      devLog.veh(vehicleId).debug(
        `[processCP] flags=0, loading next. head=${data[ptr + LogicData.CHECKPOINT_HEAD]}`
      );
      this.loadNextCheckpoint(vehicleId, data, ptr);
    }
  }

  /**
   * 다음 checkpoint를 배열에서 가져와서 VehicleDataArray에 저장
   * @returns 로드 성공 여부
   */
  private loadNextCheckpoint(vehicleId: number, data: Float32Array, ptr: number): boolean {
    if (!this.checkpointArray) return false;

    const vehicleOffset = 1 + vehicleId * CHECKPOINT_SECTION_SIZE;
    const count = this.checkpointArray[vehicleOffset];
    const head = data[ptr + LogicData.CHECKPOINT_HEAD];

    // 더 이상 checkpoint 없음
    if (head >= count) {
      devLog.veh(vehicleId).debug(
        `[loadNextCP] END: head=${head} >= count=${count}`
      );
      data[ptr + LogicData.CURRENT_CP_EDGE] = 0;
      data[ptr + LogicData.CURRENT_CP_RATIO] = 0;
      data[ptr + LogicData.CURRENT_CP_FLAGS] = 0;
      return false;
    }

    // checkpoint 배열에서 읽기
    const cpOffset = vehicleOffset + 1 + head * CHECKPOINT_FIELDS;
    const cpEdge = this.checkpointArray[cpOffset + 0];
    const cpRatio = this.checkpointArray[cpOffset + 1];
    const cpFlags = this.checkpointArray[cpOffset + 2];

    // VehicleDataArray에 저장
    data[ptr + LogicData.CURRENT_CP_EDGE] = cpEdge;
    data[ptr + LogicData.CURRENT_CP_RATIO] = cpRatio;
    data[ptr + LogicData.CURRENT_CP_FLAGS] = cpFlags;

    // head 증가
    data[ptr + LogicData.CHECKPOINT_HEAD] = head + 1;

    const currentEdge = data[ptr + MovementData.CURRENT_EDGE];
    const currentRatio = data[ptr + MovementData.EDGE_RATIO];
    devLog.veh(vehicleId).debug(
      `[loadNextCP] head=${head}→${head + 1}/${count} loaded: cpE=${cpEdge} cpR=${cpRatio.toFixed(3)} flags=${cpFlags} | curE=${currentEdge} curR=${currentRatio.toFixed(3)}`
    );

    return true;
  }

  /**
   * Lock 해제 처리
   */
  private handleLockRelease(vehicleId: number, data: Float32Array, ptr: number): void {
    // 현재 edge의 to_node가 merge node일 것
    const currentEdgeIdx = Math.trunc(data[ptr + MovementData.CURRENT_EDGE]);
    if (currentEdgeIdx < 1) return;

    const edge = this.edges[currentEdgeIdx - 1];
    if (!edge) return;

    const nodeName = edge.to_node;
    if (!this.isMergeNode(nodeName)) return;

    // Lock 해제
    this.releaseLockInternal(nodeName, vehicleId);
    this.grantNextInQueue(nodeName);
  }

  /**
   * Lock 요청 처리
   * @returns granted 여부
   */
  private handleLockRequest(vehicleId: number, data: Float32Array, ptr: number): boolean {
    // pathBuffer에서 다음 merge node 찾기 (현재는 간단히 NEXT_EDGE_0 사용)
    const nextEdgeIdx = Math.trunc(data[ptr + MovementData.NEXT_EDGE_0]);
    if (nextEdgeIdx < 1) return true; // edge 없으면 그냥 통과

    const nextEdge = this.edges[nextEdgeIdx - 1];
    if (!nextEdge) return true;

    const nodeName = nextEdge.to_node;
    if (!this.isMergeNode(nodeName)) return true; // merge가 아니면 통과

    // Lock 요청
    this.requestLockInternal(nodeName, vehicleId);

    // Grant 확인
    return this.checkGrantInternal(nodeName, vehicleId);
  }

  /**
   * Lock 대기 지점 처리
   * @returns granted 여부
   */
  private handleLockWait(vehicleId: number, data: Float32Array, ptr: number): boolean {
    const nextEdgeIdx = Math.trunc(data[ptr + MovementData.NEXT_EDGE_0]);
    if (nextEdgeIdx < 1) return true; // edge 없으면 그냥 통과

    const nextEdge = this.edges[nextEdgeIdx - 1];
    if (!nextEdge) return true;

    const nodeName = nextEdge.to_node;
    if (!this.isMergeNode(nodeName)) return true; // merge가 아니면 통과

    const velocity = data[ptr + MovementData.VELOCITY];

    if (!this.checkGrantInternal(nodeName, vehicleId)) {
      // 아직 grant 안 받음 → 멈춤 유지
      if (velocity === 0) {
        data[ptr + LogicData.STOP_REASON] |= StopReason.LOCKED;
      }
      return false;
    } else {
      // Grant 받음! → 출발
      data[ptr + LogicData.STOP_REASON] &= ~StopReason.LOCKED;
      data[ptr + MovementData.MOVING_STATUS] = MovingStatus.MOVING;
      return true;
    }
  }

  /**
   * 이동 준비 처리 - 다음 checkpoint까지 NEXT_EDGE 채우기
   */
  private handleMovePrepare(vehicleId: number, data: Float32Array, ptr: number): void {
    if (!this.pathBuffer || !this.checkpointArray) {
      devLog.veh(vehicleId).warn(`[MOVE_PREP] no pathBuffer or checkpointArray`);
      return;
    }

    // 다음 checkpoint 읽기 (CHECKPOINT_HEAD가 가리키는 위치)
    const vehicleOffset = 1 + vehicleId * CHECKPOINT_SECTION_SIZE;
    const count = this.checkpointArray[vehicleOffset];
    const head = data[ptr + LogicData.CHECKPOINT_HEAD];

    let targetEdge = 0;
    if (head < count) {
      const cpOffset = vehicleOffset + 1 + head * CHECKPOINT_FIELDS;
      targetEdge = this.checkpointArray[cpOffset + 0];
    }

    // pathBuffer에서 targetEdge까지 NEXT_EDGE 채우기
    const pathPtr = vehicleId * MAX_PATH_LENGTH;
    const pathLen = this.pathBuffer[pathPtr + PATH_LEN];

    // pathBuffer 현재 상태 로그
    const pathEdges: number[] = [];
    for (let i = 0; i < Math.min(pathLen, 10); i++) {
      pathEdges.push(this.pathBuffer[pathPtr + PATH_EDGES_START + i]);
    }
    devLog.veh(vehicleId).debug(
      `[MOVE_PREP] targetEdge=${targetEdge} pathLen=${pathLen} pathBuf=[${pathEdges.join(',')}] head=${head}/${count}`
    );

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

      const edgeIdx = this.pathBuffer[pathPtr + PATH_EDGES_START + i];
      if (edgeIdx < 1) {
        data[ptr + nextEdgeOffsets[i]] = 0;
        filledEdges.push(0);
        continue;
      }

      data[ptr + nextEdgeOffsets[i]] = edgeIdx;
      filledEdges.push(edgeIdx);

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

    devLog.veh(vehicleId).debug(
      `[MOVE_PREP] filled=[${filledEdges.join(',')}] state=${firstNext > 0 ? 'READY' : 'EMPTY'}`
    );
  }

  /**
   * Lock 요청 (내부 구현)
   */
  private requestLockInternal(nodeName: string, vehId: number): void {
    if (!this.queues.has(nodeName)) {
      this.queues.set(nodeName, []);
    }

    const queue = this.queues.get(nodeName)!;
    if (!queue.includes(vehId)) {
      queue.push(vehId);

      // 큐가 비어있으면 즉시 grant
      if (queue.length === 1 && !this.locks.has(nodeName)) {
        this.locks.set(nodeName, vehId);
      }
    }
  }

  /**
   * Grant 확인 (내부 구현)
   */
  private checkGrantInternal(nodeName: string, vehId: number): boolean {
    return this.locks.get(nodeName) === vehId;
  }

  /**
   * Lock 해제 (내부 구현)
   */
  private releaseLockInternal(nodeName: string, vehId: number): void {
    if (this.locks.get(nodeName) === vehId) {
      this.locks.delete(nodeName);

      // 큐에서도 제거
      const queue = this.queues.get(nodeName);
      if (queue) {
        const idx = queue.indexOf(vehId);
        if (idx !== -1) {
          queue.splice(idx, 1);
        }
      }
    }
  }

  /**
   * 큐 다음 차량에 grant
   */
  private grantNextInQueue(nodeName: string): void {
    const queue = this.queues.get(nodeName);
    if (!queue || queue.length === 0) return;

    // 큐의 첫 번째 차량에 grant
    const nextVeh = queue[0];
    this.locks.set(nodeName, nextVeh);
  }

  /**
   * merge node 여부 확인
   */
  isMergeNode(nodeName: string): boolean {
    return this.mergeNodes.has(nodeName);
  }

  /**
   * 리셋
   */
  reset(): void {
    this.locks.clear();
    this.queues.clear();
  }

  // ============================================================================
  // Legacy 호환용 stub (점진적 제거 예정)
  // ============================================================================

  initFromEdges(edges: Edge[]): void {
    this.edges = edges;
    this.buildMergeNodes();
  }

  checkGrant(_nodeName: string, _vehId: number): boolean {
    return true; // stub
  }

  requestLock(_nodeName: string, _edgeName: string, _vehId: number): void {
    // stub
  }

  releaseLock(_nodeName: string, _vehId: number): void {
    // stub
  }

  cancelLock(_nodeName: string, _vehId: number): boolean {
    return true; // stub
  }

  getLocksForVehicle(_vehId: number): { nodeName: string; edgeName: string; isGranted: boolean }[] {
    return [];
  }

  setLockConfig(_config: unknown): void {}
  setLockPolicy(_policy: unknown): void {}

  getWaitDistanceFromMergingStr(): number { return 5; }
  getRequestDistanceFromMergingStr(): number { return 20; }
  getWaitDistanceFromMergingCurve(): number { return 5; }
  getRequestDistanceFromMergingCurve(): number { return 30; }

  isDeadlockZoneNode(_nodeName: string): boolean { return false; }
  isDeadlockBranchNode(_nodeName: string): boolean { return false; }
  getDeadlockZoneStrategy(): string { return 'NONE'; }
  notifyArrival(_nodeName: string, _vehId: number): void {}

  getTable(): Map<string, MergeLockNode> {
    return new Map();
  }

  getGrantStrategy(): GrantStrategy {
    return 'FIFO';
  }
}

// ============================================================================
// Legacy 타입 (호환용)
// ============================================================================

export interface LockRequest {
  vehId: number;
  edgeName: string;
}

export interface Grant {
  edge: string;
  veh: number;
}

export interface MergeLockNode {
  name: string;
  nodeName: string;
  requests: LockRequest[];
  granted: Grant[];
  edgeQueues: Map<string, LockRequest[]>;
}

export type GrantStrategy = 'FIFO' | 'BATCH';

export interface LockConfig {
  waitDistanceFromMergingStr: number;
  requestDistanceFromMergingStr: number;
  waitDistanceFromMergingCurve: number;
  requestDistanceFromMergingCurve: number;
}

// Singleton
let lockMgrInstance: LockMgr | null = null;

export function getLockMgr(): LockMgr {
  if (!lockMgrInstance) {
    lockMgrInstance = new LockMgr();
  }
  return lockMgrInstance;
}

export function resetLockMgr(): void {
  lockMgrInstance = null;
}
