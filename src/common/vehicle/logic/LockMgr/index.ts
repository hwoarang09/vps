// LockMgr/index.ts
// LockMgr 메인 클래스

import type { Edge } from "@/types/edge";
import type { Node } from "@/types/node";
import { devLog } from "@/logger/DevLogger";
import type {
  LockPolicy,
  LockMgrState,
  MergeLockNode,
  GrantStrategy,
} from "./types";
import { DEFAULT_LOCK_POLICY } from "./types";
import { processCheckpoint } from "./checkpoint-processor";
import { checkAutoRelease } from "./lock-handlers";
import { getLockSnapshot } from "./snapshot";

/**
 * LockMgr - 단순한 락 시스템
 */
export class LockMgr {
  // 내부 상태
  private readonly state: LockMgrState = {
    vehicleDataArray: null,
    checkpointArray: null,
    pathBuffer: null,
    nodes: [],
    edges: [],
    mergeNodes: new Set<string>(),
    mergeNodeNames: new Map<string, string>(),
    locks: new Map<string, number>(),
    queues: new Map<string, number[]>(),
    pendingReleases: new Map<number, Array<{ nodeName: string; releaseEdgeIdx: number }>>(),
  };

  /** 1-based edge index → edge name (e.g. "E_29") */
  private readonly eName = (idx: number): string => {
    if (idx < 1) return '?';
    const edge = this.state.edges[idx - 1];
    return edge ? edge.edge_name : `?${idx}`;
  };

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
    this.state.vehicleDataArray = vehicleDataArray;
    this.state.checkpointArray = checkpointArray;
    this.state.pathBuffer = pathBuffer;
    this.state.nodes = nodes;
    this.state.edges = edges;

    // merge node 목록 구축
    this.buildMergeNodes();
  }

  /**
   * Edge 정보에서 merge node 찾기
   */
  private buildMergeNodes(): void {
    this.state.mergeNodes.clear();
    this.state.mergeNodeNames.clear();
    const incomingCount = new Map<string, number>();

    for (const edge of this.state.edges) {
      const count = incomingCount.get(edge.to_node) ?? 0;
      incomingCount.set(edge.to_node, count + 1);
    }

    for (const [nodeName, count] of incomingCount) {
      if (count >= 2) {
        this.state.mergeNodes.add(nodeName);
        this.state.mergeNodeNames.set(nodeName, nodeName);
      }
    }
  }

  /**
   * 매 프레임 호출 - 전체 차량 순회
   */
  updateAll(numVehicles: number, policy: LockPolicy = DEFAULT_LOCK_POLICY): void {
    // 자동 해제 체크 (checkpoint 처리 전에)
    checkAutoRelease(this.state, this.eName);

    for (let i = 0; i < numVehicles; i++) {
      this.processLock(i, policy);
    }
  }

  /**
   * 개별 차량 락 처리 (Checkpoint 시스템)
   */
  processLock(vehicleId: number, _policy: LockPolicy): void {
    if (!this.state.vehicleDataArray || !this.state.checkpointArray) {
      devLog.veh(vehicleId).debug(
        `[processLock] SKIP: dataArray=${!!this.state.vehicleDataArray} cpArray=${!!this.state.checkpointArray}`
      );
      return;
    }
    if (!this.state.nodes.length || !this.state.edges.length) {
      devLog.veh(vehicleId).debug(
        `[processLock] SKIP: nodes=${this.state.nodes.length} edges=${this.state.edges.length}`
      );
      return;
    }

    processCheckpoint(vehicleId, this.state, this.eName);
  }

  /**
   * merge node 여부 확인
   */
  isMergeNode(nodeName: string): boolean {
    return this.state.mergeNodes.has(nodeName);
  }

  /**
   * 리셋
   */
  reset(): void {
    this.state.locks.clear();
    this.state.queues.clear();
    this.state.pendingReleases.clear();
  }

  /**
   * Lock 상태 스냅샷 반환 (Lock Info Panel용)
   */
  getLockSnapshot(): Array<{
    nodeName: string;
    holderVehId: number | undefined;
    holderEdge: string;
    waiters: Array<{ vehId: number; edgeName: string }>;
  }> {
    return getLockSnapshot(this.state, this.eName);
  }

  // ============================================================================
  // Legacy 호환용 stub (점진적 제거 예정)
  // ============================================================================

  initFromEdges(edges: Edge[]): void {
    this.state.edges = edges;
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

  setLockConfig(_config: unknown): void {
    // Legacy stub - no-op
  }

  setLockPolicy(_policy: unknown): void {
    // Legacy stub - no-op
  }

  getWaitDistanceFromMergingStr(): number { return 5; }
  getRequestDistanceFromMergingStr(): number { return 20; }
  getWaitDistanceFromMergingCurve(): number { return 5; }
  getRequestDistanceFromMergingCurve(): number { return 30; }

  isDeadlockZoneNode(_nodeName: string): boolean { return false; }
  isDeadlockBranchNode(_nodeName: string): boolean { return false; }
  getDeadlockZoneStrategy(): string { return 'NONE'; }
  notifyArrival(_nodeName: string, _vehId: number): void {
    // Legacy stub - no-op
  }

  getTable(): Map<string, MergeLockNode> {
    return new Map();
  }

  getGrantStrategy(): GrantStrategy {
    return 'FIFO';
  }
}

// ============================================================================
// Exports
// ============================================================================

export type {
  LockPolicy,
  LockPolicyType,
  LockRequest,
  Grant,
  MergeLockNode,
  GrantStrategy,
  LockConfig,
} from "./types";

// Singleton
let lockMgrInstance: LockMgr | null = null;

export function getLockMgr(): LockMgr {
  lockMgrInstance ??= new LockMgr();
  return lockMgrInstance;
}

export function resetLockMgr(): void {
  lockMgrInstance = null;
}
