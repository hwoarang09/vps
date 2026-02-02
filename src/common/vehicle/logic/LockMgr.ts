// common/vehicle/logic/LockMgr.ts
// Shared LockMgr for vehicleArrayMode and shmSimulator

import type { Edge } from "@/types/edge";
import { getLockWaitDistanceFromMergingStr, getLockRequestDistanceFromMergingStr, getLockWaitDistanceFromMergingCurve, getLockRequestDistanceFromMergingCurve, getLockGrantStrategy, getDeadlockZoneStrategy, type GrantStrategy, type DeadlockZoneStrategy } from "@/config/simulationConfig";
import { devLog } from "@/logger/DevLogger";

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
  deadlockZoneStrategy?: DeadlockZoneStrategy;
}

// Rule C.1: Use export...from syntax for re-exports
export type { GrantStrategy, DeadlockZoneStrategy } from "@/config/simulationConfig";

/**
 * 데드락 존 정보
 * 순환 구조에서 상호 도달 가능한 합류점들을 그룹으로 관리
 */
export interface DeadlockZone {
  /** 존에 포함된 합류점 노드들 */
  nodes: Set<string>;
  /** 관련 분기 노드들 (합류점 직전 노드) */
  branchNodes: Set<string>;
}

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
  arrivalTime?: number;  // waiting point 도착 시점 (ARRIVAL_ORDER용)
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
  readonly state: BatchState;

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
      devLog.debug(`[BATCH] passLimit reached, waiting for all vehicles to pass`);
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
      devLog.debug(`[BATCH] Starting new batch on edge: ${nextEdge}, batchSize: ${this.state.batchSize}, passLimit: ${this.state.passLimit}`);
    }

    // 현재 batch edge에서 아직 grant 안 받은 request들 확인
    const requestsFromEdge = node.requests.filter((r) => r.edgeName === this.state.currentBatchEdge);

    // batchSize 도달 여부 확인
    if (this.state.batchGrantedCount >= this.state.batchSize) {
      if (requestsFromEdge.length > 0) {
        devLog.debug(`[BatchController.step] Batch full (${this.state.batchGrantedCount}/${this.state.batchSize}), waiting for releases`);
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
      devLog.veh(req.vehId).debug(`[BATCH] Granted from edge ${req.edgeName} (${this.state.batchGrantedCount}/${this.state.batchSize})`);
    }

    return grants;
  }

  /**
   * release 이벤트 처리
   * released count와 passCount 증가
   * passLimit 도달 시 새 grant 중단하고, 다른 edge에 대기 차량이 있을 때만 전환
   */
  onRelease(node: MergeLockNode): void {
    if (!this.state.currentBatchEdge) return;

    this.state.batchReleasedCount++;
    this.state.edgePassCount++; // 통과 차량 수 증가
    devLog.debug(`[BATCH] Released (${this.state.batchReleasedCount}/${this.state.batchGrantedCount}), edgePassCount: ${this.state.edgePassCount}/${this.state.passLimit}`);

    // passLimit 도달 체크 - 다른 edge에 대기 차량이 있을 때만 의미있음
    if (this.state.edgePassCount >= this.state.passLimit && !this.state.passLimitReached) {
      // 다른 edge에 대기 차량이 있는지 확인
      const hasWaitingOnOtherEdge = this.hasWaitingVehiclesOnOtherEdges(node, this.state.currentBatchEdge);

      if (hasWaitingOnOtherEdge) {
        this.state.passLimitReached = true;
        devLog.debug(`[BATCH] passLimit reached (${this.state.edgePassCount}/${this.state.passLimit}), other edges have waiting vehicles, stopping new grants on edge: ${this.state.currentBatchEdge}`);
      } else {
        // 다른 edge에 대기 차량 없으면 passLimit 리셋하고 계속 진행
        devLog.debug(`[BATCH] passLimit reached but no waiting vehicles on other edges, resetting passCount and continuing on ${this.state.currentBatchEdge}`);
        this.state.edgePassCount = 0;
        // passLimitReached는 false 유지
      }
    }

    // Batch 완료 체크
    if (this.isBatchComplete()) {
      const currentQueue = node.edgeQueues[this.state.currentBatchEdge];
      const hasMoreVehicles = currentQueue && currentQueue.size > 0;

      // passLimit 도달했고 모든 차량이 통과했으면 다음 edge로 전환
      if (this.state.passLimitReached) {
        devLog.debug(`[BATCH] All vehicles passed after passLimit, switching to next edge`);
        this.state.lastUsedEdge = this.state.currentBatchEdge;
        this.state.currentBatchEdge = null;
        this.state.batchGrantedCount = 0;
        this.state.batchReleasedCount = 0;
        this.state.edgePassCount = 0;
        this.state.passLimitReached = false;
      } else if (hasMoreVehicles) {
        // Rule B.1: Use positive condition instead of negated condition
        // passLimit 미달이고 차량 있으면 같은 edge 유지 (다음 batch)
        devLog.debug(`[BATCH] Batch completed on edge: ${this.state.currentBatchEdge}, continuing (${this.state.edgePassCount}/${this.state.passLimit})`);
        // currentBatchEdge는 유지 (null로 설정하지 않음)
        this.state.batchGrantedCount = 0;
        this.state.batchReleasedCount = 0;
        // edgePassCount는 유지 (누적)
      } else {
        // 현재 edge 큐가 비어있으면 즉시 다음 edge로 전환
        devLog.debug(`[BATCH] Current edge ${this.state.currentBatchEdge} queue empty, switching to next edge`);
        this.state.lastUsedEdge = this.state.currentBatchEdge;
        this.state.currentBatchEdge = null;
        this.state.batchGrantedCount = 0;
        this.state.batchReleasedCount = 0;
        this.state.edgePassCount = 0;
        this.state.passLimitReached = false;
      }
    }
  }

  /**
   * 다른 edge에 대기 차량이 있는지 확인
   * @param node - merge node
   * @param currentEdge - 현재 batch edge (제외할 edge)
   * @returns 다른 edge에 대기 차량이 있으면 true
   */
  private hasWaitingVehiclesOnOtherEdges(node: MergeLockNode, currentEdge: string): boolean {
    for (const [edgeName, queue] of Object.entries(node.edgeQueues)) {
      if (edgeName !== currentEdge && queue.size > 0) {
        return true;
      }
    }
    return false;
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
  // Rule D.1: Add readonly modifier - never reassigned after constructor
  private readonly batchControllers: Map<string, BatchController> = new Map();

  // Fab별 설정 가능한 lock 파라미터
  private lockWaitDistanceFromMergingStr: number;
  private lockRequestDistanceFromMergingStr: number;
  private lockWaitDistanceFromMergingCurve: number;
  private lockRequestDistanceFromMergingCurve: number;
  private strategyType: GrantStrategy;
  private deadlockZoneStrategyType: DeadlockZoneStrategy;
  // Rule D.1: Add readonly modifier - only assigned in constructor
  private readonly batchSize: number;
  private readonly passLimit: number;

  // 데드락 존 관련 필드 (Edge에서 읽어온 정보)
  /** 데드락 유발 합류점 집합 (빠른 조회용) */
  private readonly deadlockZoneNodes: Set<string> = new Set();
  /** 데드락 유발 분기점 집합 (빠른 조회용) */
  private readonly deadlockZoneBranchNodes: Set<string> = new Set();
  /** 데드락 존 정보 (그룹별) */
  private readonly deadlockZones: DeadlockZone[] = [];

  constructor(policy?: LockPolicy) {
    // 기본값은 전역 config에서 가져옴
    this.lockWaitDistanceFromMergingStr = getLockWaitDistanceFromMergingStr();
    this.lockRequestDistanceFromMergingStr = getLockRequestDistanceFromMergingStr();
    this.lockWaitDistanceFromMergingCurve = getLockWaitDistanceFromMergingCurve();
    this.lockRequestDistanceFromMergingCurve = getLockRequestDistanceFromMergingCurve();
    this.strategyType = policy?.grantStrategy ?? getLockGrantStrategy();
    this.deadlockZoneStrategyType = policy?.deadlockZoneStrategy ?? getDeadlockZoneStrategy();
    this.batchSize = 5; // 동시에 grant 가능한 최대 대수
    this.passLimit = 3; // 전환 체크 기준 (이만큼 통과하면 다른 edge 체크)
    devLog.info(`[LockMgr] strategyType=${this.strategyType}, deadlockZoneStrategy=${this.deadlockZoneStrategyType}`);
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
    if (policy.deadlockZoneStrategy) {
      this.deadlockZoneStrategyType = policy.deadlockZoneStrategy;
    }
    devLog.info(`[LockMgr] setLockPolicy: ${prev} -> ${policy.grantStrategy}, deadlockZone=${this.deadlockZoneStrategyType}`);

    // BATCH 전략으로 변경 시 기존 node들에 대해 controller 생성
    if (this.strategyType === 'BATCH' && prev !== 'BATCH') {
      for (const nodeName of Object.keys(this.lockTable)) {
        if (!this.batchControllers.has(nodeName)) {
          this.batchControllers.set(nodeName, new BatchController(this.batchSize, this.passLimit));
          devLog.debug(`[LockMgr] Created BatchController for ${nodeName}`);
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
    return {
      grantStrategy: this.strategyType,
      deadlockZoneStrategy: this.deadlockZoneStrategyType,
    };
  }

  /**
   * 현재 deadlockZoneStrategy 반환
   */
  getDeadlockZoneStrategy(): DeadlockZoneStrategy {
    return this.deadlockZoneStrategyType;
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
    this.deadlockZoneNodes.clear();
    this.deadlockZoneBranchNodes.clear();
    this.deadlockZones.length = 0;
    // 설정값은 유지 (reset은 테이블만 초기화)
  }

  initFromEdges(edges: Edge[]) {
    this.lockTable = {};
    this.batchControllers.clear();
    this.deadlockZoneNodes.clear();
    this.deadlockZoneBranchNodes.clear();
    this.deadlockZones.length = 0;

    const incomingEdgesByNode = new Map<string, string[]>();

    // 1. Edge 정보 수집 (incoming edges)
    for (const edge of edges) {
      const edgeNames = incomingEdgesByNode.get(edge.to_node);
      if (edgeNames) {
        edgeNames.push(edge.edge_name);
      } else {
        incomingEdgesByNode.set(edge.to_node, [edge.edge_name]);
      }
    }

    // 2. 데드락 존 직접 계산 (edge.isDeadlockZoneInside 의존 안 함)
    this.detectAndBuildDeadlockZones(edges, incomingEdgesByNode);

    // 3. 합류점(merge node) 등록
    this.registerMergeNodes(incomingEdgesByNode);
  }

  /**
   * 데드락 존 감지 및 구성
   * - 분기점 2개 → 합류점 2개 구조 찾기
   * - edge.isDeadlockZoneInside 플래그 없이도 동작
   */
  private detectAndBuildDeadlockZones(
    edges: Edge[],
    incomingEdgesByNode: Map<string, string[]>
  ): void {
    // 분기점별 toNode 집합
    const divergeToNodes = new Map<string, Set<string>>();
    // 합류점별 incoming count
    const incomingCount = new Map<string, number>();

    for (const edge of edges) {
      if (!divergeToNodes.has(edge.from_node)) {
        divergeToNodes.set(edge.from_node, new Set());
      }
      divergeToNodes.get(edge.from_node)!.add(edge.to_node);
      incomingCount.set(edge.to_node, (incomingCount.get(edge.to_node) || 0) + 1);
    }

    // 분기점 목록 (outgoing >= 2)
    const divergeNodes: string[] = [];
    for (const [node, toNodes] of divergeToNodes) {
      if (toNodes.size >= 2) {
        divergeNodes.push(node);
      }
    }

    // 합류점 집합 (incoming >= 2)
    const mergeNodeSet = new Set<string>();
    for (const [node, count] of incomingCount) {
      if (count >= 2) {
        mergeNodeSet.add(node);
      }
    }

    const usedDiverge = new Set<string>();
    let zoneId = 0;

    // 분기점 쌍 중 같은 합류점 2개로 분기하는 경우 찾기
    for (let i = 0; i < divergeNodes.length; i++) {
      const nodeA = divergeNodes[i];
      if (usedDiverge.has(nodeA)) continue;

      const toNodesA = divergeToNodes.get(nodeA)!;

      for (let j = i + 1; j < divergeNodes.length; j++) {
        const nodeD = divergeNodes[j];
        if (usedDiverge.has(nodeD)) continue;

        const toNodesD = divergeToNodes.get(nodeD)!;

        // 공통 toNode 찾기
        const commonToNodes: string[] = [];
        for (const toNode of toNodesA) {
          if (toNodesD.has(toNode)) {
            commonToNodes.push(toNode);
          }
        }

        // 공통 toNode가 정확히 2개이고, 둘 다 합류점이면 데드락 존
        if (commonToNodes.length === 2) {
          const [nodeB, nodeC] = commonToNodes;
          if (mergeNodeSet.has(nodeB) && mergeNodeSet.has(nodeC)) {
            // 데드락 존 등록
            this.deadlockZoneNodes.add(nodeB);
            this.deadlockZoneNodes.add(nodeC);
            this.deadlockZoneBranchNodes.add(nodeA);
            this.deadlockZoneBranchNodes.add(nodeD);

            this.deadlockZones.push({
              nodes: new Set([nodeB, nodeC]),
              branchNodes: new Set([nodeA, nodeD]),
            });

            console.log(`[LockMgr] Deadlock zone ${zoneId}: merges=[${nodeB}, ${nodeC}], branches=[${nodeA}, ${nodeD}]`);
            zoneId++;

            usedDiverge.add(nodeA);
            usedDiverge.add(nodeD);
            break;
          }
        }
      }
    }

    if (this.deadlockZoneNodes.size > 0) {
      console.log(`[LockMgr] Total deadlock zone nodes: ${this.deadlockZoneNodes.size}, zones: ${this.deadlockZones.length}`);
    } else {
      console.log(`[LockMgr] No deadlock zones detected`);
    }
  }

  /** 합류점(merge node) 등록 */
  private registerMergeNodes(incomingEdgesByNode: Map<string, string[]>): void {
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

      if (this.strategyType === 'BATCH') {
        this.batchControllers.set(mergeName, new BatchController(this.batchSize, this.passLimit));
      }
    }
  }

  /**
   * 특정 노드가 데드락 유발 합류점인지 확인
   */
  isDeadlockZoneNode(nodeName: string): boolean {
    return this.deadlockZoneNodes.has(nodeName);
  }

  /**
   * 특정 노드가 데드락 유발 분기점인지 확인
   */
  isDeadlockBranchNode(nodeName: string): boolean {
    return this.deadlockZoneBranchNodes.has(nodeName);
  }

  /**
   * 데드락 존 정보 반환
   */
  getDeadlockZones(): DeadlockZone[] {
    return this.deadlockZones;
  }

  /**
   * 특정 노드가 속한 데드락 존의 분기 노드들 반환
   */
  getBranchNodesForDeadlockZone(nodeName: string): Set<string> | undefined {
    for (const zone of this.deadlockZones) {
      if (zone.nodes.has(nodeName)) {
        return zone.branchNodes;
      }
    }
    return undefined;
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
   * 차량이 waiting point에 도착했음을 알림 (ARRIVAL_ORDER용)
   * @param nodeName 합류점 이름
   * @param vehId 차량 ID
   */
  notifyArrival(nodeName: string, vehId: number): void {
    const node = this.lockTable[nodeName];
    if (!node) return;

    const request = node.requests.find(r => r.vehId === vehId);
    if (request && !request.arrivalTime) {
      request.arrivalTime = Date.now();
      devLog.veh(vehId).debug(`[notifyArrival] node=${nodeName}, arrivalTime=${request.arrivalTime}`);
    }
  }

  /**
   * 데드락 존 합류점에 대해 도착 순서 기반 grant
   * - arrivalTime이 있는 요청 중 가장 먼저 도착한 차량에게 우선 grant
   * - arrivalTime 없으면 요청 순서(FIFO) 기반
   * - 한 번에 1대만 grant (BATCH와 다름)
   */
  private handleArrivalOrder_Grant(node: MergeLockNode): Grant | null {
    // 이미 grant된 차량이 있으면 대기
    if (node.granted.length > 0) {
      return null;
    }

    if (node.requests.length === 0) {
      return null;
    }

    // arrivalTime이 있는 요청 우선
    const arrivedRequests = node.requests.filter(r => r.arrivalTime !== undefined);

    if (arrivedRequests.length > 0) {
      // 도착 순서 기반 grant
      arrivedRequests.sort((a, b) => a.arrivalTime! - b.arrivalTime!);
      const earliest = arrivedRequests[0];
      devLog.veh(earliest.vehId).debug(`[ARRIVAL_ORDER] Grant to earliest arrival at ${node.name}, arrivalTime=${earliest.arrivalTime}`);
      return { veh: earliest.vehId, edge: earliest.edgeName };
    }

    // arrivalTime 없으면 요청 순서(FIFO) 기반
    const first = node.requests[0];
    devLog.veh(first.vehId).debug(`[ARRIVAL_ORDER] Grant to first request (no arrivalTime) at ${node.name}`);
    return { veh: first.vehId, edge: first.edgeName };
  }

  /**
   * 매 프레임 호출되는 step 함수
   * - 데드락 존 합류점: ARRIVAL_ORDER로 처리
   * - 일반 합류점: BATCH 전략으로 처리
   */
  step() {
    for (const [nodeName, node] of Object.entries(this.lockTable)) {
      // 데드락 존 합류점은 ARRIVAL_ORDER로 처리
      if (this.isDeadlockZoneNode(nodeName)) {
        const grant = this.handleArrivalOrder_Grant(node);
        if (grant) {
          node.granted.push(grant);
          node.requests = node.requests.filter(r => r.vehId !== grant.veh);
          devLog.debug(`[LockMgr.step] ARRIVAL_ORDER granted to veh ${grant.veh} at ${nodeName}`);
          this.logNodeState(nodeName);
        }
        continue;
      }

      // 일반 합류점은 기존 전략(BATCH/FIFO)으로 처리
      if (this.strategyType !== 'BATCH') continue;

      let controller = this.batchControllers.get(nodeName);
      if (!controller) {
        controller = new BatchController(this.batchSize, this.passLimit);
        this.batchControllers.set(nodeName, controller);
        devLog.debug(`[LockMgr.step] Created BatchController for ${nodeName}`);
      }

      if (node.requests.length > 0) {
        devLog.debug(`[LockMgr.step] Calling controller.step for ${nodeName}, requests: ${node.requests.map(r => r.vehId).join(',')}`);
      }

      const newGrants = controller.step(node);
      if (newGrants.length > 0) {
        node.granted.push(...newGrants);
        const grantedVehIds = newGrants.map(g => g.veh);
        node.requests = node.requests.filter((r) => !grantedVehIds.includes(r.vehId));
        devLog.debug(`[LockMgr.step] Granted to vehs ${grantedVehIds.join(',')} at ${nodeName}`);
        this.logNodeState(nodeName);
      } else if (node.requests.length > 0) {
        const reqEdges = node.requests.map(r => `${r.vehId}(${r.edgeName})`).join(', ');
        devLog.debug(`[LockMgr.step] controller.step returned empty for ${nodeName}, requests=[${reqEdges}], currentBatchEdge=${controller.state.currentBatchEdge}, passLimitReached=${controller.state.passLimitReached}, batchGrantedCount=${controller.state.batchGrantedCount}`);
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
    devLog.veh(vehId).debug(`[requestLock] node=${nodeName} edge=${edgeName}`);
    node.requests.push({
      vehId,
      edgeName,
      requestTime: Date.now(),
    });
    const hasQueue = !!node.edgeQueues[edgeName];
    node.edgeQueues[edgeName]?.enqueue(vehId);

    // 디버그: 락 요청 상세
    const requestVehs = node.requests.map(r => `${r.vehId}(${r.edgeName})`).join(', ');
    const grantedVehs = node.granted.map(g => `${g.veh}(${g.edge})`).join(', ');
    devLog.veh(vehId).debug(`[requestLock] 상세: node=${nodeName}, edge=${edgeName}, hasQueue=${hasQueue}, strategy=${this.strategyType}, requests=[${requestVehs}], granted=[${grantedVehs}]`);

    this.logNodeState(nodeName);

    // 전략별 처리
    if (this.strategyType === 'FIFO') {
      this.handleFIFO_Request(node);
    } else if (this.strategyType === 'BATCH') {
      const controller = this.batchControllers.get(nodeName);
      if (controller) {
        devLog.debug(`[requestLock] Calling controller.onRequest()`);
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
      devLog.veh(vehId).debug(`[releaseLock] tried to release ${nodeName} but not in granted list`);
      return;
    }

    const grantedEdge = node.granted[grantIdx].edge;
    devLog.veh(vehId).debug(`[releaseLock] node=${nodeName} edge=${grantedEdge}`);

    // granted 배열에서 제거
    node.granted.splice(grantIdx, 1);

    node.requests = node.requests.filter((r) => r.vehId !== vehId);

    // grant 받은 veh는 해당 edge queue의 맨 앞에 있으므로 dequeue로 O(1) 제거
    node.edgeQueues[grantedEdge]?.dequeue();

    this.logNodeState(nodeName);

    // 전략별 처리
    if (this.strategyType === 'FIFO') {
      this.handleFIFO_Release(node);
    } else if (this.strategyType === 'BATCH') {
      const controller = this.batchControllers.get(nodeName);
      if (controller) {
        devLog.debug(`[releaseLock] Calling controller.onRelease()`);
        controller.onRelease(node);
      } else {
        devLog.debug(`[releaseLock] No controller for ${nodeName}`);
      }
    }
    // BATCH의 다음 grant는 step()에서 처리
  }

  private handleFIFO_Request(node: MergeLockNode) {
    devLog.debug(`[handleFIFO_Request] node=${node.name}, grantedLen=${node.granted.length}, requestsLen=${node.requests.length}`);
    if (node.granted.length > 0) {
      devLog.debug(`[handleFIFO_Request] 스킵: 이미 granted 있음`);
      return;
    }

    const decision = getNextFromQueue(node);
    devLog.debug(`[handleFIFO_Request] decision: veh=${decision?.veh}, edge=${decision?.edge}`);
    if (decision) {
      node.granted = [decision]; // 배열로 래핑
      node.requests.shift(); // 첫 번째 제거
      devLog.veh(decision.veh).debug(`[handleFIFO_Request] GRANT 완료: edge=${decision.edge}`);
      this.logNodeState(node.name);
    }
  }

  private handleFIFO_Release(node: MergeLockNode) {
    const decision = getNextFromQueue(node);
    if (decision) {
      node.granted = [decision]; // 배열로 래핑
      node.requests.shift(); // 첫 번째 제거
      this.logNodeState(node.name);
    }
  }

  logNodeState(nodeName: string) {
    const node = this.lockTable[nodeName];
    if (!node) return;
    const grantedVehs = node.granted.length > 0 ? node.granted.map(g => g.veh).join(',') : 'FREE';
    devLog.debug(`[LockMgr] ${nodeName} - granted: [${grantedVehs}], requests: ${node.requests.map((r) => r.vehId).join(", ")}`);
  }

  /**
   * 특정 차량이 가지고 있는 모든 락 정보 반환
   * @returns Array of { nodeName, edgeName, isGranted }
   */
  getLocksForVehicle(vehId: number): Array<{ nodeName: string; edgeName: string; isGranted: boolean }> {
    const result: Array<{ nodeName: string; edgeName: string; isGranted: boolean }> = [];

    for (const [nodeName, node] of Object.entries(this.lockTable)) {
      // granted 확인
      const grantedEntry = node.granted.find(g => g.veh === vehId);
      if (grantedEntry) {
        result.push({ nodeName, edgeName: grantedEntry.edge, isGranted: true });
        continue;
      }

      // requests 확인
      const requestEntry = node.requests.find(r => r.vehId === vehId);
      if (requestEntry) {
        result.push({ nodeName, edgeName: requestEntry.edgeName, isGranted: false });
      }
    }

    return result;
  }

  /**
   * 특정 노드에서 차량의 락을 취소
   * requests 또는 granted에서 제거
   * @returns true if cancelled, false if not found
   */
  cancelLock(nodeName: string, vehId: number): boolean {
    const node = this.lockTable[nodeName];
    if (!node) return false;

    // granted에서 취소 시도
    if (this.cancelFromGranted(node, nodeName, vehId)) {
      return true;
    }

    // requests에서 취소 시도
    return this.cancelFromRequests(node, nodeName, vehId);
  }

  /** granted에서 락 취소 */
  private cancelFromGranted(node: MergeLockNode, nodeName: string, vehId: number): boolean {
    const grantIdx = node.granted.findIndex(g => g.veh === vehId);
    if (grantIdx === -1) return false;

    const grantedEdge = node.granted[grantIdx].edge;
    devLog.veh(vehId).debug(`[cancelLock] node=${nodeName} edge=${grantedEdge} (was granted)`);

    node.granted.splice(grantIdx, 1);
    node.edgeQueues[grantedEdge]?.dequeue();

    // BATCH 전략인 경우 controller 상태 업데이트
    if (this.strategyType === 'BATCH') {
      const controller = this.batchControllers.get(nodeName);
      if (controller?.state.currentBatchEdge === grantedEdge) {
        controller.state.batchReleasedCount++;
        devLog.debug(`[cancelLock] BATCH: adjusted batchReleasedCount for cancelled vehicle`);
      }
    }

    this.logNodeState(nodeName);
    return true;
  }

  /** requests에서 락 취소 */
  private cancelFromRequests(node: MergeLockNode, nodeName: string, vehId: number): boolean {
    const reqIdx = node.requests.findIndex(r => r.vehId === vehId);
    if (reqIdx === -1) return false;

    const requestEdge = node.requests[reqIdx].edgeName;
    devLog.veh(vehId).debug(`[cancelLock] node=${nodeName} edge=${requestEdge} (was pending)`);

    node.requests.splice(reqIdx, 1);

    // edgeQueue에서 해당 vehId 제거 (큐 재구성)
    const queue = node.edgeQueues[requestEdge];
    if (queue) {
      const newQueue = new RingBuffer<number>();
      const size = queue.size;
      for (let i = 0; i < size; i++) {
        const item = queue.dequeue();
        if (item !== undefined && item !== vehId) {
          newQueue.enqueue(item);
        }
      }
      node.edgeQueues[requestEdge] = newQueue;
    }

    this.logNodeState(nodeName);
    return true;
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
