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
 * Lock 이벤트 콜백 타입
 * @param vehId - Vehicle ID
 * @param nodeIdx - Node index (0-based)
 * @param eventType - 0=REQUEST, 1=GRANT, 2=RELEASE, 3=WAIT
 * @param waitMs - 대기 시간 (ms), WAIT 이벤트에서만 유효
 * @param holderVehId - Lock holder Vehicle ID (-1 = 없음, WAIT 이벤트에서 유효)
 */
export type OnLockEventCallback = (
  vehId: number,
  nodeIdx: number,
  eventType: number,
  waitMs: number,
  holderVehId: number
) => void;

/**
 * Checkpoint 이벤트 콜백 타입
 * @param vehId - Vehicle ID
 * @param cpEdge - Checkpoint edge (1-based)
 * @param cpFlags - Checkpoint flags bitmask
 * @param action - 0=LOADED, 1=HIT, 2=MISS, 3=WAITING, 4=WAIT_BLOCKED
 * @param cpRatio - Checkpoint ratio
 * @param currentEdge - Current vehicle edge
 * @param currentRatio - Current vehicle ratio
 */
export type OnCheckpointEventCallback = (
  vehId: number,
  cpEdge: number,
  cpFlags: number,
  action: number,
  cpRatio: number,
  currentEdge: number,
  currentRatio: number
) => void;

/** Checkpoint action constants */
export const CheckpointAction = {
  LOADED: 0,
  HIT: 1,
  MISS: 2,
  WAITING: 3,
  WAIT_BLOCKED: 4,
} as const;

/** Lock event type constants */
export const LockEventType = {
  REQUEST: 0,
  GRANT: 1,
  RELEASE: 2,
  WAIT: 3,
} as const;

/**
 * DEV_LOCK_DETAIL subtype 코드 — 의심 메커니즘 추적용.
 * SimLogger.logLockDetail 의 type 바이트에 들어감.
 *
 * 10번대: deadlock-zone.ts 자동 처리 (cp 흐름 우회)
 * 20번대: lock-handlers.ts requestLockWithPriority (path 변경 시 priority/swap)
 */
export const LockDetailType = {
  /** grantNextInQueue 가 queue[0] 가 아닌 차량을 zone-internal 우선순위로 grant */
  ZONE_PREEMPT: 10,
  /** updateDeadlockZoneGates 가 cp 우회로 자동 REQ (큐에 push) */
  DZ_GATE_AUTO_REQ: 11,
  /** updateDeadlockZoneGates 가 자동 REQ 후 holder 없어 즉시 grant */
  DZ_GATE_AUTO_GRANT: 12,
  /** updateDeadlockZoneGates 가 lock 못 받아 차량 강제 정지 */
  DZ_GATE_BLOCK: 13,
  /** requestLockWithPriority 가 거리 기반 우선순위로 큐 insert (FIFO 위반 가능) */
  PRIORITY_INSERT: 20,
  /** requestLockWithPriority 가 현재 holder 박탈 (holder swap) */
  HOLDER_SWAP: 21,
  /** requestLockWithPriority 가 holder 없을 때 즉시 grant */
  PRIORITY_GRANT: 22,
  /** preLockMergeNodes 가 t=0 에 차량을 merge 큐에 push (silent — REQ 이벤트 없음) */
  PRELOCK_REGISTER: 30,
  /** preLockMergeNodes 결과 holder 가 됨 (silent grant) */
  PRELOCK_HOLDER: 31,
  /** stopNonHolderVehiclesNearMerge 가 차량을 LOCKED 으로 강제 정지 */
  PRELOCK_STOP: 32,
  /** 버퍼링된 preLock 이벤트 flush 시작 marker (extra=flush 된 이벤트 수) */
  FLUSH_MARKER: 90,
} as const;
export type LockDetailTypeValue = typeof LockDetailType[keyof typeof LockDetailType];

/**
 * DEV_LOCK_DETAIL 이벤트 콜백 타입.
 * @param vehId        영향받는 차량
 * @param nodeIdx      merge node index (0-based)
 * @param detailType   LockDetailType 값
 * @param holderVehId  관련 holder 차량 (swap 의 박탈당한 holder, preempt 의 큐 1등 등). 없으면 -1
 * @param extra        추가 정보 (예: 큐 위치, 거리값을 mm 단위로 등). 미사용시 0
 */
export type OnLockDetailEventCallback = (
  vehId: number,
  nodeIdx: number,
  detailType: number,
  holderVehId: number,
  extra: number
) => void;

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
  /** 현재 WAIT 중인 차량 Set (중복 WAIT 이벤트 방지) */
  waitingVehicles: Set<number>;
  /** Lock 이벤트 콜백 (SimLogger 연결용) */
  onLockEvent?: OnLockEventCallback;
  /** Checkpoint 이벤트 콜백 (SimLogger 연결용) */
  onCheckpointEvent?: OnCheckpointEventCallback;
  /** Lock detail 이벤트 콜백 (의심 메커니즘 디버그용 — DEV_LOCK_DETAIL 로 OPFS 기록) */
  onLockDetailEvent?: OnLockDetailEventCallback;
  /**
   * preLock 시점엔 callback 미설정 → 이벤트 버퍼링.
   * setOnLockDetailEvent 시 flush. 각 항목: [vehId, nodeIdx, detailType, holderVehId, extra]
   */
  pendingLockDetailEvents?: Array<[number, number, number, number, number]>;
  /** Node name → index (0-based) 맵 */
  nodeNameToIndex?: Map<string, number>;
  /** Deadlock zone merge 노드 이름 Set */
  deadlockZoneMerges?: Set<string>;
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
