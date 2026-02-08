// LockMgr/types.ts
// Type definitions for LockMgr

import type { Edge } from "@/types/edge";
import type { Node } from "@/types/node";

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
 * 기본 Lock 정책
 */
export const DEFAULT_LOCK_POLICY: LockPolicy = { default: 'FIFO' };

/**
 * Checkpoint 상태
 */
export interface CheckpointState {
  edge: number;
  ratio: number;
  flags: number;
  target: number;
}

/**
 * Checkpoint 도달 체크 결과
 */
export interface ReachCheckResult {
  reached: boolean;    // checkpoint에 도달했는지
  missed: boolean;     // checkpoint를 놓쳤는지
  waiting: boolean;    // 아직 도달하지 않음 (waiting)
}

/**
 * LockMgr 내부 상태
 */
export interface LockMgrState {
  vehicleDataArray: Float32Array | null;
  checkpointArray: Float32Array | null;
  pathBuffer: Int32Array | null;
  nodes: Node[];
  edges: Edge[];
  mergeNodes: Set<string>;
  mergeNodeNames: Map<string, string>;
  locks: Map<string, number>;
  queues: Map<string, number[]>;
  pendingReleases: Map<number, Array<{ nodeName: string; releaseEdgeIdx: number }>>;
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
