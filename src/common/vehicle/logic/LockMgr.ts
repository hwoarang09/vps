// common/vehicle/logic/LockMgr.ts
// Shared LockMgr for vehicleArrayMode and shmSimulator

import type { Edge } from "@/types/edge";
import { EdgeType } from "@/types";
import { getLockWaitDistance, getLockRequestDistance, getLockGrantStrategy, type GrantStrategy } from "@/config/simulationConfig";

const DEBUG = false;

/**
 * Lock 설정 인터페이스
 */
export interface LockConfig {
  waitDistance: number;
  requestDistance: number; // -1이면 진입 즉시 요청
}

/**
 * Lock 정책 인터페이스
 */
export interface LockPolicy {
  grantStrategy: GrantStrategy;
}

export { type GrantStrategy };

// Ring buffer for O(1) enqueue/dequeue
export class RingBuffer<T> {
  private buffer: (T | undefined)[];
  private head = 0; // 다음에 읽을 위치
  private tail = 0; // 다음에 쓸 위치
  private count = 0;
  private capacity: number;

  constructor(initialCapacity = 16) {
    this.capacity = initialCapacity;
    this.buffer = new Array(initialCapacity);
  }

  get size(): number {
    return this.count;
  }

  enqueue(item: T): void {
    if (this.count === this.capacity) {
      this.grow();
    }
    this.buffer[this.tail] = item;
    this.tail = (this.tail + 1) % this.capacity;
    this.count++;
  }

  dequeue(): T | undefined {
    if (this.count === 0) return undefined;
    const item = this.buffer[this.head];
    this.buffer[this.head] = undefined;
    this.head = (this.head + 1) % this.capacity;
    this.count--;
    return item;
  }

  peek(): T | undefined {
    if (this.count === 0) return undefined;
    return this.buffer[this.head];
  }

  private grow(): void {
    const newCapacity = this.capacity * 2;
    const newBuffer = new Array<T | undefined>(newCapacity);
    for (let i = 0; i < this.count; i++) {
      newBuffer[i] = this.buffer[(this.head + i) % this.capacity];
    }
    this.buffer = newBuffer;
    this.head = 0;
    this.tail = this.count;
    this.capacity = newCapacity;
  }
}

export type Grant = {
  edge: string;
  veh: number;
} | null;

export type LockRequest = {
  vehId: number;
  edgeName: string;
  requestTime: number;
};

export type MergeLockNode = {
  name: string;
  requests: LockRequest[];
  edgeQueues: Record<string, RingBuffer<number>>;
  mergedQueue: number[];
  granted: Grant;
  strategyState: Record<string, unknown>;
};

/**
 * requests 배열에서 다음 grant 대상을 반환하는 유틸리티 함수
 */
function getNextFromQueue(node: MergeLockNode): Grant | null {
  if (node.requests.length === 0) return null;

  const target = node.requests[0];
  return { veh: target.vehId, edge: target.edgeName };
}

export type LockTable = Record<string, MergeLockNode>;

export class LockMgr {
  private lockTable: LockTable = {};

  // Fab별 설정 가능한 lock 파라미터
  private lockWaitDistance: number;
  private lockRequestDistance: number;
  private strategyType: GrantStrategy;

  constructor(policy?: LockPolicy) {
    // 기본값은 전역 config에서 가져옴
    this.lockWaitDistance = getLockWaitDistance();
    this.lockRequestDistance = getLockRequestDistance();
    this.strategyType = policy?.grantStrategy ?? getLockGrantStrategy();
    console.log(`[LockMgr] strategyType=${this.strategyType}`);
  }

  /**
   * Lock 설정 변경 (fab별 오버라이드 적용 시 사용)
   */
  setLockConfig(config: LockConfig) {
    this.lockWaitDistance = config.waitDistance;
    this.lockRequestDistance = config.requestDistance;
  }

  /**
   * Lock 정책 변경 (fab별 오버라이드 적용 시 사용)
   */
  setLockPolicy(policy: LockPolicy) {
    const prev = this.strategyType;
    this.strategyType = policy.grantStrategy;
    console.log(`[LockMgr] setLockPolicy: ${prev} -> ${policy.grantStrategy}`);
  }

  /**
   * 현재 lock 설정 반환
   */
  getLockConfig(): LockConfig {
    return {
      waitDistance: this.lockWaitDistance,
      requestDistance: this.lockRequestDistance,
    };
  }

  /**
   * 현재 lock 정책 반환
   */
  getLockPolicy(): LockPolicy {
    return { grantStrategy: this.strategyType };
  }

  /**
   * 현재 strategyType 반환
   */
  getGrantStrategy(): GrantStrategy {
    return this.strategyType;
  }

  /**
   * Request Distance 반환 (-1이면 진입 즉시 요청)
   */
  getRequestDistance(): number {
    return this.lockRequestDistance;
  }

  reset() {
    this.lockTable = {};
    // 설정값은 유지 (reset은 테이블만 초기화)
  }

  initFromEdges(edges: Edge[]) {
    this.lockTable = {};
    const incomingEdgesByNode = new Map<string, string[]>();

    for (const edge of edges) {
      const toNode = edge.to_node;
      const edgeNames = incomingEdgesByNode.get(toNode);
      if (edgeNames) {
        edgeNames.push(edge.edge_name);
      } else {
        incomingEdgesByNode.set(toNode, [edge.edge_name]);
      }
    }

    for (const [mergeName, incomingEdgeNames] of incomingEdgesByNode.entries()) {
      if (incomingEdgeNames.length < 2) continue;

      const edgeQueues: Record<string, RingBuffer<number>> = {};
      for (const edgeName of incomingEdgeNames) {
        edgeQueues[edgeName] = new RingBuffer<number>();
      }

      this.lockTable[mergeName] = {
        name: mergeName,
        requests: [],
        edgeQueues,
        mergedQueue: [],
        granted: null,
        strategyState: {},
      };
    }
  }

  getTable() {
    return this.lockTable;
  }

  isMergeNode(nodeName: string): boolean {
    return !!this.lockTable[nodeName];
  }

  checkGrant(nodeName: string, vehId: number): boolean {
    const node = this.lockTable[nodeName];
    if (!node) return true;
    return node.granted?.veh === vehId;
  }

  getWaitDistance(edge: Edge): number {
    if (edge.vos_rail_type !== EdgeType.LINEAR) {
      return 0;
    }

    if (edge.distance >= this.lockWaitDistance) {
      return edge.distance - this.lockWaitDistance;
    } else {
      return 0;
    }
  }

  requestLock(nodeName: string, edgeName: string, vehId: number) {
    const node = this.lockTable[nodeName];
    if (!node) return;

    const existing = node.requests.find((r) => r.vehId === vehId);
    if (existing || node.granted?.veh === vehId) return;

    // 큐에 추가
    node.requests.push({
      vehId,
      edgeName,
      requestTime: Date.now(),
    });
    node.edgeQueues[edgeName]?.enqueue(vehId);
    if (DEBUG) this.logNodeState(nodeName);

    // 전략별 처리
    if (this.strategyType === 'FIFO') {
      this.handleFIFO_Request(node);
    } else if (this.strategyType === 'BATCH') {
      // TODO: BATCH 구현
    }
  }

  releaseLock(nodeName: string, vehId: number) {
    const node = this.lockTable[nodeName];
    if (!node) return;
    if (node.granted?.veh !== vehId) return;

    const grantedEdge = node.granted.edge;
    node.granted = null;

    node.requests = node.requests.filter((r) => r.vehId !== vehId);

    // grant 받은 veh는 해당 edge queue의 맨 앞에 있으므로 dequeue로 O(1) 제거
    node.edgeQueues[grantedEdge]?.dequeue();

    if (DEBUG) this.logNodeState(nodeName);

    // 전략별 처리
    if (this.strategyType === 'FIFO') {
      this.handleFIFO_Release(node);
    } else if (this.strategyType === 'BATCH') {
      // TODO: BATCH 구현
    }
  }

  private handleFIFO_Request(node: MergeLockNode) {
    if (node.granted) return;

    const decision = getNextFromQueue(node);
    if (decision) {
      node.granted = decision;
      node.requests.shift(); // 첫 번째 제거
      if (DEBUG) this.logNodeState(node.name);
    }
  }

  private handleFIFO_Release(node: MergeLockNode) {
    const decision = getNextFromQueue(node);
    if (decision) {
      node.granted = decision;
      node.requests.shift(); // 첫 번째 제거
      if (DEBUG) this.logNodeState(node.name);
    }
  }

  logNodeState(nodeName: string) {
    if (!DEBUG) return;
    const node = this.lockTable[nodeName];
    if (!node) return;
    const queue = node.requests.map((r) => r.vehId).join(", ");
    const cur = node.granted ? `[${node.granted.veh}]` : "[FREE]";
  }
}

// Singleton for vehicleArrayMode
let _lockMgr: LockMgr | null = null;

export function getLockMgr() {
  _lockMgr ??= new LockMgr();
  return _lockMgr;
}

export function resetLockMgr() {
  _lockMgr = new LockMgr();
  return _lockMgr;
}
