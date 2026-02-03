// common/vehicle/logic/LockMgr.ts
// TODO: 새로운 단순한 락 시스템으로 교체 예정

import type { Edge } from "@/types/edge";

/**
 * Lock 설정 인터페이스 (stub)
 */
export interface LockConfig {
  waitDistanceFromMergingStr: number;
  requestDistanceFromMergingStr: number;
  waitDistanceFromMergingCurve: number;
  requestDistanceFromMergingCurve: number;
}

/**
 * Lock 정책 인터페이스 (stub)
 */
export interface LockPolicy {
  grantStrategy: string;
  deadlockZoneStrategy?: string;
}

/**
 * LockRequest (stub - 컴파일 호환용)
 */
export interface LockRequest {
  vehId: number;
  edgeName: string;
}

/**
 * Grant (stub - 컴파일 호환용)
 */
export interface Grant {
  edge: string;
  veh: number;
}

/**
 * MergeLockNode (stub - 컴파일 호환용)
 */
export interface MergeLockNode {
  name: string;
  nodeName: string;
  requests: LockRequest[];
  granted: Grant[];
  edgeQueues: Map<string, LockRequest[]>;
}

// GrantStrategy type (stub)
export type GrantStrategy = 'FIFO' | 'BATCH';

// Singleton instance
let lockMgrInstance: LockMgr | null = null;

/**
 * LockMgr - 빈 stub
 * 새로운 락 시스템이 구현되면 교체됨
 */
export class LockMgr {
  // merge node 목록 (topology에서 설정)
  private mergeNodes = new Set<string>();

  constructor() {}

  // topology 초기화
  initFromEdges(edges: Edge[]): void {
    this.mergeNodes.clear();
    const incomingCount = new Map<string, number>();
    for (const edge of edges) {
      const count = incomingCount.get(edge.to_node) ?? 0;
      incomingCount.set(edge.to_node, count + 1);
    }
    for (const [node, count] of incomingCount) {
      if (count >= 2) {
        this.mergeNodes.add(node);
      }
    }
  }

  // merge node 여부
  isMergeNode(nodeName: string): boolean {
    return this.mergeNodes.has(nodeName);
  }

  // stub - 항상 true 반환 (락 시스템 비활성화)
  checkGrant(_nodeName: string, _vehId: number): boolean {
    return true;
  }

  // stub - 아무것도 안 함
  requestLock(_nodeName: string, _edgeName: string, _vehId: number): void {}

  // stub - 아무것도 안 함
  releaseLock(_nodeName: string, _vehId: number): void {}

  // stub - 아무것도 안 함
  cancelLock(_nodeName: string, _vehId: number): boolean {
    return true;
  }

  // stub
  step(): void {}

  // stub
  reset(): void {
    this.mergeNodes.clear();
  }

  // stub
  getLocksForVehicle(_vehId: number): { nodeName: string; edgeName: string; isGranted: boolean }[] {
    return [];
  }

  // config setters (stub)
  setLockConfig(_config: LockConfig): void {}
  setLockPolicy(_policy: LockPolicy): void {}

  // config getters (stub - 기본값)
  getWaitDistanceFromMergingStr(): number { return 5; }
  getRequestDistanceFromMergingStr(): number { return 20; }
  getWaitDistanceFromMergingCurve(): number { return 5; }
  getRequestDistanceFromMergingCurve(): number { return 30; }

  // deadlock zone (stub)
  isDeadlockZoneNode(_nodeName: string): boolean { return false; }
  isDeadlockBranchNode(_nodeName: string): boolean { return false; }
  getDeadlockZoneStrategy(): string { return 'NONE'; }
  notifyArrival(_nodeName: string, _vehId: number): void {}

  // table getter (stub)
  getTable(): Map<string, MergeLockNode> {
    return new Map();
  }

  // strategy getter (stub)
  getGrantStrategy(): GrantStrategy {
    return 'FIFO';
  }
}

// Singleton getters/setters
export function getLockMgr(): LockMgr {
  if (!lockMgrInstance) {
    lockMgrInstance = new LockMgr();
  }
  return lockMgrInstance;
}

export function resetLockMgr(): void {
  lockMgrInstance = null;
}
