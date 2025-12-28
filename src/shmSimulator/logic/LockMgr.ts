// shmSimulator/logic/LockMgr.ts

import type { Edge } from "@/types/edge";
import { EdgeType } from "@/types";

const DEBUG = false;

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
  edgeQueues: Record<string, number[]>;
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

      const edgeQueues: Record<string, number[]> = {};
      for (const edgeName of incomingEdgeNames) {
        edgeQueues[edgeName] = [];
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
      node.edgeQueues[edgeName]?.push(vehId);
      if (DEBUG) this.logNodeState(nodeName);
    }

    this.tryGrant(nodeName);
  }

  releaseLock(nodeName: string, vehId: number) {
    const node = this.lockTable[nodeName];
    if (!node) return;

    if (node.granted?.veh === vehId) {
      if (DEBUG) console.log(`[LockMgr ${nodeName} VEH${vehId}] RELEASE`);
      node.granted = null;

      node.requests = node.requests.filter((r) => r.vehId !== vehId);

      for (const key in node.edgeQueues) {
        node.edgeQueues[key] = node.edgeQueues[key].filter((id) => id !== vehId);
      }

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
