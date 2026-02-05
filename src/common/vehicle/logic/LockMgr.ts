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
} from "@/common/vehicle/initialize/constants";

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
    checkpointArray: Float32Array | null = null
  ): void {
    this.vehicleDataArray = vehicleDataArray;
    this.checkpointArray = checkpointArray;
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
    if (!this.vehicleDataArray || !this.checkpointArray) return;
    if (!this.nodes.length || !this.edges.length) return;

    this.processCheckpoint(vehicleId);
  }

  /**
   * Checkpoint 기반 락 처리
   */
  private processCheckpoint(vehicleId: number): void {
    if (!this.vehicleDataArray || !this.checkpointArray) return;

    const data = this.vehicleDataArray;
    const ptr = vehicleId * VEHICLE_DATA_SIZE;

    // Checkpoint 배열에서 현재 vehicle의 checkpoint 읽기
    const vehicleOffset = 1 + vehicleId * CHECKPOINT_SECTION_SIZE;
    const count = this.checkpointArray[vehicleOffset];
    const head = data[ptr + LogicData.CHECKPOINT_HEAD];

    // 끝 확인
    if (head >= count) return;

    // 다음 checkpoint 읽기
    const cpOffset = vehicleOffset + 1 + head * CHECKPOINT_FIELDS;
    const cpEdge = this.checkpointArray[cpOffset + 0];
    const cpRatio = this.checkpointArray[cpOffset + 1];
    const cpFlags = this.checkpointArray[cpOffset + 2];

    // 🚀 초고속 체크
    const currentEdge = data[ptr + MovementData.CURRENT_EDGE];
    const currentRatio = data[ptr + MovementData.EDGE_RATIO];

    if (currentEdge !== cpEdge) return;
    if (currentRatio < cpRatio) return;

    // ✅ Checkpoint 도달! Flags 처리
    if (cpFlags & CheckpointFlags.LOCK_RELEASE) {
      this.handleLockRelease(vehicleId, data, ptr);
    }

    if (cpFlags & CheckpointFlags.LOCK_REQUEST) {
      this.handleLockRequest(vehicleId, data, ptr);
    }

    if (cpFlags & CheckpointFlags.LOCK_WAIT) {
      this.handleLockWait(vehicleId, data, ptr);
    }

    if (cpFlags & CheckpointFlags.MOVE_PREPARE) {
      this.handleMovePrepare(vehicleId, data, ptr);
    }

    // 다음 checkpoint로
    data[ptr + LogicData.CHECKPOINT_HEAD]++;
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
   */
  private handleLockRequest(vehicleId: number, data: Float32Array, ptr: number): void {
    // pathBuffer에서 다음 merge node 찾기 (현재는 간단히 NEXT_EDGE_0 사용)
    const nextEdgeIdx = Math.trunc(data[ptr + MovementData.NEXT_EDGE_0]);
    if (nextEdgeIdx < 1) return;

    const nextEdge = this.edges[nextEdgeIdx - 1];
    if (!nextEdge) return;

    const nodeName = nextEdge.to_node;
    if (!this.isMergeNode(nodeName)) return;

    // Lock 요청
    this.requestLockInternal(nodeName, vehicleId);

    // Grant 확인
    if (this.checkGrantInternal(nodeName, vehicleId)) {
      // Grant 받음 → 계속 진행 (별도 처리 불필요)
    } else {
      // Grant 못 받음 → 다음 LOCK_WAIT checkpoint에서 정지
      // (LOCK_WAIT는 이미 checkpoint에 설정되어 있음)
    }
  }

  /**
   * Lock 대기 지점 처리
   */
  private handleLockWait(vehicleId: number, data: Float32Array, ptr: number): void {
    const nextEdgeIdx = Math.trunc(data[ptr + MovementData.NEXT_EDGE_0]);
    if (nextEdgeIdx < 1) return;

    const nextEdge = this.edges[nextEdgeIdx - 1];
    if (!nextEdge) return;

    const nodeName = nextEdge.to_node;
    if (!this.isMergeNode(nodeName)) return;

    const velocity = data[ptr + MovementData.VELOCITY];

    if (!this.checkGrantInternal(nodeName, vehicleId)) {
      // 아직 grant 안 받음 → 멈춤 유지
      if (velocity === 0) {
        data[ptr + LogicData.STOP_REASON] |= StopReason.LOCKED;
      }
    } else {
      // Grant 받음! → 출발
      data[ptr + LogicData.STOP_REASON] &= ~StopReason.LOCKED;
      data[ptr + MovementData.MOVING_STATUS] = MovingStatus.MOVING;
    }
  }

  /**
   * 이동 준비 처리 (곡선 등)
   */
  private handleMovePrepare(_vehicleId: number, _data: Float32Array, _ptr: number): void {
    // TODO: 곡선 진입 전 처리 (필요 시)
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
