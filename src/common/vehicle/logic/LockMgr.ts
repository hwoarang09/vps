// common/vehicle/logic/LockMgr.ts
// 새로운 단순한 락 시스템

import type { Edge } from "@/types/edge";
import type { Node } from "@/types/node";

/**
 * Lock 정책
 */
export type LockPolicy = 'FIFO' | 'BATCH';

/**
 * LockMgr - 단순한 락 시스템
 */
export class LockMgr {
  // 참조 저장
  private vehicleDataArray: Float32Array | null = null;
  private nodes: Node[] = [];
  private edges: Edge[] = [];

  // merge node 목록 (빠른 조회용)
  private mergeNodes = new Set<string>();

  // 락 상태
  private locks = new Map<string, number>();        // nodeName -> vehId (현재 잡고 있는 차량)
  private queues = new Map<string, number[]>();     // nodeName -> vehId[] (대기 큐)

  constructor() {}

  /**
   * 초기화 - 참조 저장
   */
  init(vehicleDataArray: Float32Array, nodes: Node[], edges: Edge[]): void {
    this.vehicleDataArray = vehicleDataArray;
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
    const incomingCount = new Map<string, number>();

    for (const edge of this.edges) {
      const count = incomingCount.get(edge.to_node) ?? 0;
      incomingCount.set(edge.to_node, count + 1);
    }

    for (const [nodeName, count] of incomingCount) {
      if (count >= 2) {
        this.mergeNodes.add(nodeName);
      }
    }
  }

  /**
   * 매 프레임 호출 - 전체 차량 순회
   */
  updateAll(numVehicles: number, policy: LockPolicy = 'FIFO'): void {
    for (let i = 0; i < numVehicles; i++) {
      this.processLock(i, policy);
    }
  }

  /**
   * 개별 차량 락 처리
   */
  processLock(_vehicleId: number, _policy: LockPolicy): void {
    if (!this.vehicleDataArray || !this.nodes.length || !this.edges.length) return;

    // TODO: 실제 로직 구현
    // 1. 현재 edge, ratio 읽기
    // 2. 다음 edge의 to_node가 merge인지 확인
    // 3. merge면 → grant 체크/요청
    // 4. grant 못 받으면 → 멈춤 처리
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

  step(): void {
    // stub - updateAll로 대체 예정
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
