// common/vehicle/logic/LockMgr.ts
// Shared LockMgr for vehicleArrayMode and shmSimulator

import type { Edge } from "@/types/edge";
import { getLockWaitDistanceFromMergingStr, getLockRequestDistanceFromMergingStr, getLockWaitDistanceFromMergingCurve, getLockRequestDistanceFromMergingCurve, getLockGrantStrategy, type GrantStrategy } from "@/config/simulationConfig";

const DEBUG = false;

/**
 * Lock 설정 인터페이스
 */
export interface LockConfig {
  waitDistanceFromMergingStr: number;
  requestDistanceFromMergingStr: number;
  waitDistanceFromMergingCurve: number;
  requestDistanceFromMergingCurve: number;
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
  edgePassCount: number; // 현재 edge에서 통과한 총 차량 수
  passLimit: number; // 한 edge에서 최대 통과 가능 대수
  lastUsedEdge: string | null; // round-robin을 위한 마지막 사용 edge
  passLimitReached: boolean; // passLimit 도달 여부 (새 grant 중단)
};

/**
 * BATCH 전략을 위한 컨트롤러
 * merge node별로 batch 상태를 관리하고 grant 결정을 담당
 */
class BatchController {
  private state: BatchState;

  constructor(batchSize: number, passLimit = 5) {
    this.state = {
      currentBatchEdge: null,
      batchGrantedCount: 0,
      batchReleasedCount: 0,
      batchSize,
      edgePassCount: 0,
      passLimit,
      lastUsedEdge: null,
      passLimitReached: false,
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
    // passLimit 도달 시 새 grant 중단
    if (this.state.passLimitReached) {
      if (DEBUG) console.log(`[BATCH] passLimit reached, waiting for all vehicles to pass`);
      return [];
    }

    // 새 batch 시작
    if (!this.state.currentBatchEdge) {
      const nextEdge = this.selectNextBatchEdge(node);
      if (!nextEdge) {
        return [];
      }

      this.state.currentBatchEdge = nextEdge;
      this.state.batchGrantedCount = 0;
      this.state.batchReleasedCount = 0;
      this.state.edgePassCount = 0; // passCount 초기화
      this.state.passLimitReached = false; // 플래그 초기화
      if (DEBUG) console.log(`[BATCH] Starting new batch on edge: ${nextEdge}, batchSize: ${this.state.batchSize}, passLimit: ${this.state.passLimit}`);
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
   * released count와 passCount 증가
   * passLimit 도달 시 새 grant 중단하고, 모든 차량 통과 후 다음 edge로 전환
   */
  onRelease(node: MergeLockNode): void {
    if (!this.state.currentBatchEdge) return;

    this.state.batchReleasedCount++;
    this.state.edgePassCount++; // 통과 차량 수 증가
    if (DEBUG) console.log(`[BATCH] Released (${this.state.batchReleasedCount}/${this.state.batchGrantedCount}), edgePassCount: ${this.state.edgePassCount}/${this.state.passLimit}`);

    // passLimit 도달 체크
    if (this.state.edgePassCount >= this.state.passLimit && !this.state.passLimitReached) {
      this.state.passLimitReached = true;
      if (DEBUG) console.log(`[BATCH] passLimit reached (${this.state.edgePassCount}/${this.state.passLimit}), stopping new grants on edge: ${this.state.currentBatchEdge}`);
    }

    // Batch 완료 체크
    if (this.isBatchComplete()) {
      const currentQueue = node.edgeQueues[this.state.currentBatchEdge];
      const hasMoreVehicles = currentQueue && currentQueue.size > 0;

      // passLimit 도달했고 모든 차량이 통과했으면 다음 edge로 전환
      if (this.state.passLimitReached) {
        if (DEBUG) console.log(`[BATCH] All vehicles passed after passLimit, switching to next edge`);
        this.state.lastUsedEdge = this.state.currentBatchEdge;
        this.state.currentBatchEdge = null;
        this.state.batchGrantedCount = 0;
        this.state.batchReleasedCount = 0;
        this.state.edgePassCount = 0;
        this.state.passLimitReached = false;
      } else if (!hasMoreVehicles) {
        // 현재 edge 큐가 비어있으면 즉시 다음 edge로 전환
        if (DEBUG) console.log(`[BATCH] Current edge ${this.state.currentBatchEdge} queue empty, switching to next edge`);
        this.state.lastUsedEdge = this.state.currentBatchEdge;
        this.state.currentBatchEdge = null;
        this.state.batchGrantedCount = 0;
        this.state.batchReleasedCount = 0;
        this.state.edgePassCount = 0;
        this.state.passLimitReached = false;
      } else {
        // passLimit 미달이고 차량 있으면 같은 edge 유지 (다음 batch)
        if (DEBUG) console.log(`[BATCH] Batch completed on edge: ${this.state.currentBatchEdge}, continuing (${this.state.edgePassCount}/${this.state.passLimit})`);
        // currentBatchEdge는 유지 (null로 설정하지 않음)
        this.state.batchGrantedCount = 0;
        this.state.batchReleasedCount = 0;
        // edgePassCount는 유지 (누적)
      }
    }
  }

  /**
   * Batch가 완료되었는지 확인
   */
  isBatchComplete(): boolean {
    return this.state.batchGrantedCount === this.state.batchReleasedCount;
  }

  /**
   * edgeQueues에서 대기 중인 차량이 있는 edge 선택 (round-robin)
   * lastUsedEdge 다음 edge부터 순회하며 차량이 있는 첫 번째 edge 선택
   */
  private selectNextBatchEdge(node: MergeLockNode): string | null {
    const edgeNames = Object.keys(node.edgeQueues);
    if (edgeNames.length === 0) return null;

    // lastUsedEdge가 없으면 처음부터 시작
    if (!this.state.lastUsedEdge) {
      for (const edgeName of edgeNames) {
        const queue = node.edgeQueues[edgeName];
        if (queue && queue.size > 0) {
          return edgeName;
        }
      }
      return null;
    }

    // lastUsedEdge 다음부터 순회 (round-robin)
    const lastIndex = edgeNames.indexOf(this.state.lastUsedEdge);
    const startIndex = lastIndex === -1 ? 0 : (lastIndex + 1) % edgeNames.length;

    // startIndex부터 한 바퀴 순회
    for (let i = 0; i < edgeNames.length; i++) {
      const index = (startIndex + i) % edgeNames.length;
      const edgeName = edgeNames[index];
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
  private lockWaitDistanceFromMergingStr: number;
  private lockRequestDistanceFromMergingStr: number;
  private lockWaitDistanceFromMergingCurve: number;
  private lockRequestDistanceFromMergingCurve: number;
  private strategyType: GrantStrategy;
  private batchSize: number;

  constructor(policy?: LockPolicy) {
    // 기본값은 전역 config에서 가져옴
    this.lockWaitDistanceFromMergingStr = getLockWaitDistanceFromMergingStr();
    this.lockRequestDistanceFromMergingStr = getLockRequestDistanceFromMergingStr();
    this.lockWaitDistanceFromMergingCurve = getLockWaitDistanceFromMergingCurve();
    this.lockRequestDistanceFromMergingCurve = getLockRequestDistanceFromMergingCurve();
    this.strategyType = policy?.grantStrategy ?? getLockGrantStrategy();
    this.batchSize = 3; // 기본 batch size
    console.log(`[LockMgr] strategyType=${this.strategyType}`);
  }

  /**
   * Lock 설정 변경 (fab별 오버라이드 적용 시 사용)
   */
  setLockConfig(config: LockConfig) {
    this.lockWaitDistanceFromMergingStr = config.waitDistanceFromMergingStr;
    this.lockRequestDistanceFromMergingStr = config.requestDistanceFromMergingStr;
    this.lockWaitDistanceFromMergingCurve = config.waitDistanceFromMergingCurve;
    this.lockRequestDistanceFromMergingCurve = config.requestDistanceFromMergingCurve;
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
      waitDistanceFromMergingStr: this.lockWaitDistanceFromMergingStr,
      requestDistanceFromMergingStr: this.lockRequestDistanceFromMergingStr,
      waitDistanceFromMergingCurve: this.lockWaitDistanceFromMergingCurve,
      requestDistanceFromMergingCurve: this.lockRequestDistanceFromMergingCurve,
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
   * 직선에서 합류할 때 Request Distance 반환
   */
  getRequestDistanceFromMergingStr(): number {
    return this.lockRequestDistanceFromMergingStr;
  }

  /**
   * 곡선에서 합류할 때 Request Distance 반환
   */
  getRequestDistanceFromMergingCurve(): number {
    return this.lockRequestDistanceFromMergingCurve;
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

  /**
   * 직선에서 합류할 때 Wait Distance 반환 (toNode 앞 거리)
   * @deprecated 경로 탐색 시에는 getWaitDistanceFromMergingStr() 사용
   */
  getWaitDistanceForMergingStr(edge: Edge): number {
    if (edge.distance >= this.lockWaitDistanceFromMergingStr) {
      return edge.distance - this.lockWaitDistanceFromMergingStr;
    }
    return 0;
  }

  /**
   * 곡선에서 합류할 때 Wait Distance 반환 (fromNode 앞 거리)
   * 곡선은 fromNode 기준이므로 그대로 반환
   */
  getWaitDistanceForMergingCurve(): number {
    return this.lockWaitDistanceFromMergingCurve;
  }

  /**
   * 직선 합류 시 Wait Distance raw 값 반환 (합류점에서 뒤로 떨어진 거리)
   */
  getWaitDistanceFromMergingStr(): number {
    return this.lockWaitDistanceFromMergingStr;
  }

  /**
   * 곡선 합류 시 Wait Distance raw 값 반환 (곡선 fn에서 떨어진 거리)
   */
  getWaitDistanceFromMergingCurve(): number {
    return this.lockWaitDistanceFromMergingCurve;
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
    const hasQueue = !!node.edgeQueues[edgeName];
    node.edgeQueues[edgeName]?.enqueue(vehId);

    // 디버그: 락 요청 상세
    console.log(`[DEBUG] requestLock 상세: vehId=${vehId}, node=${nodeName}, edge=${edgeName}, hasQueue=${hasQueue}, strategy=${this.strategyType}, requestsLen=${node.requests.length}, grantedLen=${node.granted.length}`);

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
        controller.onRelease(node);
      } else {
        if (DEBUG) console.log(`[releaseLock] No controller for ${nodeName}`);
      }
    }
    // BATCH의 다음 grant는 step()에서 처리
  }

  private handleFIFO_Request(node: MergeLockNode) {
    console.log(`[DEBUG] handleFIFO_Request: node=${node.name}, grantedLen=${node.granted.length}, requestsLen=${node.requests.length}`);
    if (node.granted.length > 0) {
      console.log(`[DEBUG] handleFIFO_Request 스킵: 이미 granted 있음`);
      return;
    }

    const decision = getNextFromQueue(node);
    console.log(`[DEBUG] handleFIFO_Request decision:`, decision);
    if (decision) {
      node.granted = [decision]; // 배열로 래핑
      node.requests.shift(); // 첫 번째 제거
      console.log(`[DEBUG] handleFIFO_Request GRANT 완료: veh=${decision.veh}, edge=${decision.edge}`);
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
