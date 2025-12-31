// common/vehicle/logic/LockMgr.ts
// Shared LockMgr for vehicleArrayMode and shmSimulator

import type { Edge } from "@/types/edge";
import { EdgeType } from "@/types";

const DEBUG = false;

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

export type MergeStrategy = (node: MergeLockNode) => Grant | null;

const FIFO_Strategy: MergeStrategy = (node) => {
  if (node.granted) return null;
  if (node.requests.length === 0) return null;

  node.requests.sort((a, b) => a.requestTime - b.requestTime);

  const target = node.requests[0];
  return { veh: target.vehId, edge: target.edgeName };
};

export type LockTable = Record<string, MergeLockNode>;

export class LockMgr {
  private lockTable: LockTable = {};
  private currentStrategy: MergeStrategy = FIFO_Strategy;

  setStrategy(strategy: MergeStrategy) {
    this.currentStrategy = strategy;
  }

  reset() {
    this.lockTable = {};
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

    console.log(`\n========== MAP TOPOLOGY: MERGE NODES ==========`);
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
    console.log(`[LockMgr] Total Merge Nodes: ${Object.keys(this.lockTable).length}`);
    console.log(`===============================================\n`);
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

    if (edge.distance >= 3) {
      return edge.distance - 3;
    } else {
      return 0;
    }
  }

  requestLock(nodeName: string, edgeName: string, vehId: number) {
    const node = this.lockTable[nodeName];
    if (!node) return;

    const existing = node.requests.find((r) => r.vehId === vehId);
    if (!existing && node.granted?.veh !== vehId) {
      if (DEBUG)
        console.log(`[LockMgr ${nodeName} VEH${vehId}] REQUEST (Edge: ${edgeName})`);
      node.requests.push({
        vehId,
        edgeName,
        requestTime: Date.now(),
      });
      node.edgeQueues[edgeName]?.enqueue(vehId);
      if (DEBUG) this.logNodeState(nodeName);
    }

    this.tryGrant(nodeName);
  }

  releaseLock(nodeName: string, vehId: number) {
    const node = this.lockTable[nodeName];
    if (!node) return;

    if (node.granted?.veh === vehId) {
      if (DEBUG) console.log(`[LockMgr ${nodeName} VEH${vehId}] RELEASE`);
      const grantedEdge = node.granted.edge;
      node.granted = null;

      node.requests = node.requests.filter((r) => r.vehId !== vehId);

      // grant 받은 veh는 해당 edge queue의 맨 앞에 있으므로 dequeue로 O(1) 제거
      node.edgeQueues[grantedEdge]?.dequeue();

      if (DEBUG) this.logNodeState(nodeName);
      this.tryGrant(nodeName);
    } else if (DEBUG)
      console.warn(
        `[LockMgr ${nodeName} VEH${vehId}] RELEASE IGNORED (Holder: ${node.granted?.veh})`
      );
  }

  tryGrant(nodeName: string) {
    const node = this.lockTable[nodeName];
    if (!node) return;
    if (node.granted) {
      if (DEBUG) console.log(`[LockMgr ${nodeName}] TryGrant: Blocked by ${node.granted.veh}`);
      return;
    }

    const decision = this.currentStrategy(node);

    if (decision) {
      if (DEBUG)
        console.log(`[LockMgr ${nodeName} VEH${decision.veh}] GRANT`);
      node.granted = decision;
      node.requests = node.requests.filter((r) => r.vehId !== decision.veh);
      if (DEBUG) this.logNodeState(nodeName);
    } else if (DEBUG) {
      console.log(
        `[LockMgr ${nodeName}] TryGrant: No one selected (Queue len: ${node.requests.length})`
      );
    }
  }

  logNodeState(nodeName: string) {
    if (!DEBUG) return;
    const node = this.lockTable[nodeName];
    if (!node) return;
    const queue = node.requests.map((r) => r.vehId).join(", ");
    const cur = node.granted ? `[${node.granted.veh}]` : "[FREE]";
    console.log(`[LockMgr ${nodeName}] STATE: Holder=${cur}, Queue={${queue}}`);
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
