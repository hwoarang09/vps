// common/vehicle/logic/LockMgr.ts
// Shared LockMgr for vehicleArrayMode and shmSimulator

import type { Edge } from "@/types/edge";
import { EdgeType } from "@/types";
import { getLockWaitDistance, getLockRequestDistance, getLockGrantStrategy, type GrantStrategy } from "@/config/simulationConfig";

const DEBUG = true;

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
};

export type LockRequest = {
  vehId: number;
  edgeName: string;
  requestTime: number;
};

export type BatchState = {
  currentBatchEdge: string | null;
  batchGrantedCount: number;
  batchReleasedCount: number;
  batchSize: number;
};

/**
 * BATCH 전략을 위한 컨트롤러
 * merge node별로 batch 상태를 관리하고 grant 결정을 담당
 */
class BatchController {
  private state: BatchState;

  constructor(batchSize: number) {
    this.state = {
      currentBatchEdge: null,
      batchGrantedCount: 0,
      batchReleasedCount: 0,
      batchSize,
    };
  }

  /**
   * request 이벤트 처리
   * (현재는 step()에서 처리하므로 아무것도 안 함)
   */
  onRequest(): void {
    // BATCH는 step()에서 처리
  }

  /**
   * 매 프레임 호출되는 step 함수
   * 현재 batch 상태를 확인하고 grant를 결정
   * 새 batch 시작 시 batchSize만큼 한 번에 grant 반환
   */
  step(node: MergeLockNode): Grant[] {
    // 새 batch 시작
    if (!this.state.currentBatchEdge) {
      const nextEdge = this.selectNextBatchEdge(node);
      if (!nextEdge) {
        return [];
      }

      this.state.currentBatchEdge = nextEdge;
      this.state.batchGrantedCount = 0;
      this.state.batchReleasedCount = 0;
      if (DEBUG) console.log(`[BATCH] Starting new batch on edge: ${nextEdge}, batchSize: ${this.state.batchSize}`);
    }

    // 현재 batch edge에서 아직 grant 안 받은 request들 확인
    const requestsFromEdge = node.requests.filter((r) => r.edgeName === this.state.currentBatchEdge);

    // batchSize 도달 여부 확인
    if (this.state.batchGrantedCount >= this.state.batchSize) {
      if (DEBUG && requestsFromEdge.length > 0) {
        console.log(`[BatchController.step] Batch full (${this.state.batchGrantedCount}/${this.state.batchSize}), waiting for releases`);
      }
      return [];
    }

    // batchSize까지 여유가 있으면 추가 grant
    const grants: Grant[] = [];
    const availableSlots = this.state.batchSize - this.state.batchGrantedCount;
    const grantCount = Math.min(availableSlots, requestsFromEdge.length);

    for (let i = 0; i < grantCount; i++) {
      const req = requestsFromEdge[i];
      grants.push({ veh: req.vehId, edge: req.edgeName });
      this.state.batchGrantedCount++;
      if (DEBUG) console.log(`[BATCH] Granted to veh ${req.vehId} from edge ${req.edgeName} (${this.state.batchGrantedCount}/${this.state.batchSize})`);
    }

    return grants;
  }

  /**
   * release 이벤트 처리
   * released count만 증가시키고 batch 완료 시 상태 초기화
   */
  onRelease(): void {
    if (!this.state.currentBatchEdge) return;

    this.state.batchReleasedCount++;
    if (DEBUG) console.log(`[BATCH] Released (${this.state.batchReleasedCount}/${this.state.batchGrantedCount})`);

    // Batch 완료 체크
    if (this.isBatchComplete()) {
      if (DEBUG) console.log(`[BATCH] Batch completed on edge: ${this.state.currentBatchEdge}`);

      // 현재 batch 종료 - 다음 batch는 step()에서 시작
      this.state.currentBatchEdge = null;
      this.state.batchGrantedCount = 0;
      this.state.batchReleasedCount = 0;
    }
  }

  /**
   * Batch가 완료되었는지 확인
   */
  isBatchComplete(): boolean {
    return this.state.batchGrantedCount === this.state.batchReleasedCount;
  }

  /**
   * edgeQueues에서 대기 중인 차량이 있는 edge 선택
   */
  private selectNextBatchEdge(node: MergeLockNode): string | null {
    for (const edgeName of Object.keys(node.edgeQueues)) {
      const queue = node.edgeQueues[edgeName];
      if (queue && queue.size > 0) {
        return edgeName;
      }
    }
    return null;
  }
}

export type MergeLockNode = {
  name: string;
  requests: LockRequest[];
  edgeQueues: Record<string, RingBuffer<number>>;
  mergedQueue: number[];
  granted: Grant[]; // 여러 대에게 동시 grant 가능
  strategyState: Record<string, unknown>;
};

/**
 * requests 배열에서 다음 grant 대상을 반환하는 유틸리티 함수
 */
function getNextFromQueue(node: MergeLockNode): Grant | undefined {
  if (node.requests.length === 0) return undefined;

  const target = node.requests[0];
  return { veh: target.vehId, edge: target.edgeName };
}

export type LockTable = Record<string, MergeLockNode>;

export class LockMgr {
  private lockTable: LockTable = {};
  private batchControllers: Map<string, BatchController> = new Map();

  // Fab별 설정 가능한 lock 파라미터
  private lockWaitDistance: number;
  private lockRequestDistance: number;
  private strategyType: GrantStrategy;
  private batchSize: number;

  constructor(policy?: LockPolicy) {
    // 기본값은 전역 config에서 가져옴
    this.lockWaitDistance = getLockWaitDistance();
    this.lockRequestDistance = getLockRequestDistance();
    this.strategyType = policy?.grantStrategy ?? getLockGrantStrategy();
    this.batchSize = 3; // 기본 batch size
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

    // BATCH 전략으로 변경 시 기존 node들에 대해 controller 생성
    if (this.strategyType === 'BATCH' && prev !== 'BATCH') {
      for (const nodeName of Object.keys(this.lockTable)) {
        if (!this.batchControllers.has(nodeName)) {
          this.batchControllers.set(nodeName, new BatchController(this.batchSize));
          if (DEBUG) console.log(`[LockMgr] Created BatchController for ${nodeName}`);
        }
      }
    }
    // BATCH에서 다른 전략으로 변경 시 controller 제거
    else if (this.strategyType !== 'BATCH' && prev === 'BATCH') {
      this.batchControllers.clear();
    }
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
    this.batchControllers.clear();
    // 설정값은 유지 (reset은 테이블만 초기화)
  }

  initFromEdges(edges: Edge[]) {
    this.lockTable = {};
    this.batchControllers.clear();
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
        granted: [],
        strategyState: {},
      };

      // BATCH 전략인 경우 BatchController 생성
      if (this.strategyType === 'BATCH') {
        this.batchControllers.set(mergeName, new BatchController(this.batchSize));
      }
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
    return node.granted.some(g => g.veh === vehId);
  }

  /**
   * 매 프레임 호출되는 step 함수
   * BATCH 전략에서 grant 결정을 수행
   */
  step() {
    if (this.strategyType !== 'BATCH') return;

    for (const [nodeName, node] of Object.entries(this.lockTable)) {
      let controller = this.batchControllers.get(nodeName);
      if (!controller) {
        // Controller가 없으면 즉시 생성 (lazy initialization)
        controller = new BatchController(this.batchSize);
        this.batchControllers.set(nodeName, controller);
        if (DEBUG) console.log(`[LockMgr.step] Created BatchController for ${nodeName}`);
      }

      if (DEBUG && node.requests.length > 0) {
        console.log(`[LockMgr.step] Calling controller.step for ${nodeName}, requests: ${node.requests.map(r => r.vehId).join(',')}`);
      }

      const newGrants = controller.step(node);
      if (newGrants.length > 0) {
        // 여러 대에게 추가 grant (기존 granted에 append)
        node.granted.push(...newGrants);
        const grantedVehIds = newGrants.map(g => g.veh);
        node.requests = node.requests.filter((r) => !grantedVehIds.includes(r.vehId));
        if (DEBUG) console.log(`[LockMgr.step] Granted to vehs ${grantedVehIds.join(',')} at ${nodeName}`);
        if (DEBUG) this.logNodeState(nodeName);
      } else if (DEBUG && node.requests.length > 0) {
        console.log(`[LockMgr.step] controller.step returned empty array for ${nodeName}`);
      }
    }
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
    const alreadyGranted = node.granted.some(g => g.veh === vehId);
    if (existing || alreadyGranted) return;

    // 큐에 추가
    if (DEBUG) console.log(`[requestLock] veh ${vehId} requesting ${nodeName} via ${edgeName}`);
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
      const controller = this.batchControllers.get(nodeName);
      if (controller) {
        if (DEBUG) console.log(`[requestLock] Calling controller.onRequest()`);
        controller.onRequest();
      }
    }
    // BATCH의 grant는 step()에서 처리
  }

  releaseLock(nodeName: string, vehId: number) {
    const node = this.lockTable[nodeName];
    if (!node) return;

    const grantIdx = node.granted.findIndex(g => g.veh === vehId);
    if (grantIdx === -1) {
      if (DEBUG) console.log(`[releaseLock] veh ${vehId} tried to release ${nodeName} but not in granted list`);
      return;
    }

    const grantedEdge = node.granted[grantIdx].edge;
    if (DEBUG) console.log(`[releaseLock] veh ${vehId} releasing ${nodeName} (edge: ${grantedEdge})`);

    // granted 배열에서 제거
    node.granted.splice(grantIdx, 1);

    node.requests = node.requests.filter((r) => r.vehId !== vehId);

    // grant 받은 veh는 해당 edge queue의 맨 앞에 있으므로 dequeue로 O(1) 제거
    node.edgeQueues[grantedEdge]?.dequeue();

    if (DEBUG) this.logNodeState(nodeName);

    // 전략별 처리
    if (this.strategyType === 'FIFO') {
      this.handleFIFO_Release(node);
    } else if (this.strategyType === 'BATCH') {
      const controller = this.batchControllers.get(nodeName);
      if (controller) {
        if (DEBUG) console.log(`[releaseLock] Calling controller.onRelease()`);
        controller.onRelease();
      } else {
        if (DEBUG) console.log(`[releaseLock] No controller for ${nodeName}`);
      }
    }
    // BATCH의 다음 grant는 step()에서 처리
  }

  private handleFIFO_Request(node: MergeLockNode) {
    if (node.granted.length > 0) return;

    const decision = getNextFromQueue(node);
    if (decision) {
      node.granted = [decision]; // 배열로 래핑
      node.requests.shift(); // 첫 번째 제거
      if (DEBUG) this.logNodeState(node.name);
    }
  }

  private handleFIFO_Release(node: MergeLockNode) {
    const decision = getNextFromQueue(node);
    if (decision) {
      node.granted = [decision]; // 배열로 래핑
      node.requests.shift(); // 첫 번째 제거
      if (DEBUG) this.logNodeState(node.name);
    }
  }

  logNodeState(nodeName: string) {
    if (!DEBUG) return;
    const node = this.lockTable[nodeName];
    if (!node) return;
    const grantedVehs = node.granted.length > 0 ? node.granted.map(g => g.veh).join(',') : 'FREE';
    console.log(`[LockMgr] ${nodeName} - granted: [${grantedVehs}], requests: ${node.requests.map((r) => r.vehId).join(", ")}`);
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
