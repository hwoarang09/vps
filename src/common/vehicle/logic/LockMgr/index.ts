// LockMgr/index.ts
// LockMgr 메인 클래스

import type { Edge } from "@/types/edge";
import type { Node } from "@/types/node";
import type {
  LockPolicy,
  LockMgrState,
  MergeLockNode,
  GrantStrategy,
  OnLockEventCallback,
  OnCheckpointEventCallback,
} from "./types";
import { DEFAULT_LOCK_POLICY } from "./types";
import { processCheckpoint } from "./checkpoint-processor";
import { checkAutoRelease, requestLockInternal, releaseOrphanedLocks, requestLockWithPriority } from "./lock-handlers";
import { updateDeadlockZoneGates } from "./deadlock-zone";
import type { PathChangeInfo } from "../TransferMgr/types";
import { getLockSnapshot } from "./snapshot";
import type { IEdgeVehicleQueue } from "@/common/vehicle/initialize/types";
import { LogicData, MovementData, MovingStatus, StopReason, VEHICLE_DATA_SIZE } from "@/common/vehicle/initialize/constants";

/** merge 근처 비holder 차량 정지 거리 (m) */
const PRELOCK_STOP_DISTANCE = 5.1;

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
    waitingVehicles: new Set<number>(),
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

    // nodeNameToIndex 맵 구축
    const nodeNameToIndex = new Map<string, number>();
    for (let i = 0; i < nodes.length; i++) {
      nodeNameToIndex.set(nodes[i].node_name, i);
    }
    this.state.nodeNameToIndex = nodeNameToIndex;

    // merge node 목록 구축
    this.buildMergeNodes();

    // deadlock zone merge 감지
    this.buildDeadlockZoneMerges();
  }

  /**
   * Lock 이벤트 콜백 설정 (SimLogger 연결용)
   */
  setOnLockEvent(callback: OnLockEventCallback): void {
    this.state.onLockEvent = callback;
  }

  /**
   * Checkpoint 이벤트 콜백 설정 (SimLogger 연결용)
   */
  setOnCheckpointEvent(callback: OnCheckpointEventCallback): void {
    this.state.onCheckpointEvent = callback;
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

    // Deadlock zone gate: 직전 edge 도착 시 자동 REQ/GRANT/STOP, 통과 후 자동 RELEASE
    updateDeadlockZoneGates(numVehicles, this.state, this.eName);

    for (let i = 0; i < numVehicles; i++) {
      this.processLock(i, policy);
    }
  }

  /**
   * 개별 차량 락 처리 - 핵심 엔트리 포인트 (Checkpoint 시스템)
   *
   * 매 프레임마다 각 차량에 대해 호출되며, 다음 작업을 수행합니다:
   * 1. Checkpoint 로드 및 검증 (checkpoint-loader)
   * 2. Checkpoint 도달 체크 (edge/ratio 일치 확인)
   * 3. Flag 처리 (checkpoint-processor)
   *    - MOVE_PREPARE: 다음 edge 준비 (NEXT_EDGE 채우기)
   *    - LOCK_REQUEST: Lock 요청 + auto-release 등록
   *    - LOCK_WAIT: Lock 대기 또는 통과 (deadlock zone 우선순위 적용)
   *    - LOCK_RELEASE: Lock 해제 + 다음 차량에 grant
   * 4. 다음 Checkpoint 로드 (flags === 0일 때)
   *
   * 내부적으로 checkpoint-processor.processCheckpoint()를 호출합니다.
   */
  processLock(vehicleId: number, _policy: LockPolicy): void {
    if (!this.state.vehicleDataArray || !this.state.checkpointArray) {
      return;
    }
    if (!this.state.nodes.length || !this.state.edges.length) {
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
   * 전체 merge node 이름 목록 (정렬됨)
   */
  getAllMergeNodeNames(): string[] {
    return [...this.state.mergeNodes].sort();
  }

  /**
   * 차량이 해당 merge node lock의 holder인지 확인
   */
  isLockHolder(nodeName: string, vehId: number): boolean {
    return this.state.locks.get(nodeName) === vehId;
  }

  /**
   * Deadlock zone merge node 여부 확인
   */
  isDeadlockZoneMerge(nodeName: string): boolean {
    return this.state.deadlockZoneMerges?.has(nodeName) ?? false;
  }

  /**
   * Step 4.5: 경로 변경된 차량의 lock 정합성 일괄 처리
   * (1) orphaned lock 정리 (신 경로에 없는 merge release/cancel)
   * (2) ★ priority-aware 강제 REQ (본인이 LOCK_REQ 범위 안쪽인 새 merge에 대해)
   * (3) missed checkpoint 즉시 처리 (rebuild된 checkpoint 중 이미 지나친 것)
   */
  processPathChange(vehicleId: number, info: PathChangeInfo): void {
    releaseOrphanedLocks(vehicleId, info.newPathMergeNodes, info.newPathEdges, this.state, this.eName);
    requestLockWithPriority(vehicleId, info.newPathMergeNodes, info.newPathEdges, this.state, this.eName);
    processCheckpoint(vehicleId, this.state, this.eName);
  }

  /**
   * 리셋
   */
  reset(): void {
    this.state.locks.clear();
    this.state.queues.clear();
    this.state.pendingReleases.clear();
    this.state.waitingVehicles.clear();
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

  /**
   * 초기 배치 시 거리 기반 Lock 선점
   * merge node로 향하는 edge의 차량들을 ratio 내림차순(merge node에 가까운 순)으로 lock 등록
   */
  preLockMergeNodes(
    _numVehicles: number,
    edgeVehicleQueue: IEdgeVehicleQueue
  ): void {
    if (!this.state.vehicleDataArray) return;

    const data = this.state.vehicleDataArray;
    const mergeNodeEdges = this.buildMergeNodeEdges();

    for (const [nodeName, edgeIndices] of mergeNodeEdges) {
      const vehicles = this.collectVehiclesOnEdges(edgeIndices, data, edgeVehicleQueue);
      if (vehicles.length === 0) continue;

      vehicles.sort((a, b) => b.ratio - a.ratio);

      for (const { vehId } of vehicles) {
        requestLockInternal(nodeName, vehId, this.state);

        // pendingReleases에 등록 — 경로 변경 시 releaseOrphanedLocks()가 정리 가능
        // releaseEdgeIdx = -1 (sentinel): checkAutoRelease가 preLock 항목을 건드리지 않음
        // → 차량이 path를 받으면 checkpoint handler가 올바른 releaseEdgeIdx로 갱신하거나,
        //   releaseOrphanedLocks가 경로에 없는 merge lock을 정리함
        if (!this.state.pendingReleases.has(vehId)) {
          this.state.pendingReleases.set(vehId, []);
        }
        const releases = this.state.pendingReleases.get(vehId)!;
        if (!releases.find(r => r.nodeName === nodeName)) {
          releases.push({ nodeName, releaseEdgeIdx: -1 });
        }
      }

      const holder = this.state.locks.get(nodeName);
      this.stopNonHolderVehiclesNearMerge(vehicles, holder, data);
    }
  }

  /** mergeNode별 해당 node로 향하는 edge index 그룹핑 */
  private buildMergeNodeEdges(): Map<string, number[]> {
    const { edges, mergeNodes } = this.state;
    const mergeNodeEdges = new Map<string, number[]>();
    for (let i = 0; i < edges.length; i++) {
      const edge = edges[i];
      if (mergeNodes.has(edge.to_node)) {
        let arr = mergeNodeEdges.get(edge.to_node);
        if (!arr) {
          arr = [];
          mergeNodeEdges.set(edge.to_node, arr);
        }
        arr.push(i + 1); // 1-based
      }
    }
    return mergeNodeEdges;
  }

  /** edgeIndices에 있는 모든 차량을 수집 */
  private collectVehiclesOnEdges(
    edgeIndices: number[],
    data: Float32Array,
    edgeVehicleQueue: IEdgeVehicleQueue
  ): { vehId: number; ratio: number; edgeIdx: number }[] {
    const vehicles: { vehId: number; ratio: number; edgeIdx: number }[] = [];
    for (const edgeIdx of edgeIndices) {
      const vehIds = edgeVehicleQueue.getVehicles(edgeIdx);
      for (const vehId of vehIds) {
        const ptr = vehId * VEHICLE_DATA_SIZE;
        vehicles.push({ vehId, ratio: data[ptr + MovementData.EDGE_RATIO], edgeIdx });
      }
    }
    return vehicles;
  }

  /** 비holder 차량 중 merge 가까운(≤5.1m) 차량 강제 정지 */
  private stopNonHolderVehiclesNearMerge(
    vehicles: { vehId: number; ratio: number; edgeIdx: number }[],
    holder: number | undefined,
    data: Float32Array
  ): void {
    const { edges } = this.state;
    for (const { vehId, ratio, edgeIdx } of vehicles) {
      if (vehId === holder) continue;
      const edge = edges[edgeIdx - 1];
      const distToMerge = (1 - ratio) * edge.distance;
      if (distToMerge <= PRELOCK_STOP_DISTANCE) {
        const ptr = vehId * VEHICLE_DATA_SIZE;
        data[ptr + MovementData.VELOCITY] = 0;
        data[ptr + MovementData.MOVING_STATUS] = MovingStatus.STOPPED;
        data[ptr + LogicData.STOP_REASON] |= StopReason.LOCKED;
      }
    }
  }

  // ============================================================================
  // Legacy 호환용 stub (점진적 제거 예정)
  // ============================================================================

  initFromEdges(edges: Edge[]): void {
    this.state.edges = edges;
    this.buildMergeNodes();
    this.buildDeadlockZoneMerges();
  }

  /**
   * Edge topology에서 deadlock zone merge 노드 감지
   * 조건: 분기점 A, D가 같은 합류점 2개(B, C)로 분기 → B, C가 deadlock zone merge
   */
  private buildDeadlockZoneMerges(): void {
    const dzMerges = new Set<string>();
    const edges = this.state.edges;
    const mergeNodes = this.state.mergeNodes;

    // 분기점 → toNode 집합
    const divergeToNodes = new Map<string, Set<string>>();
    for (const edge of edges) {
      if (!divergeToNodes.has(edge.from_node)) divergeToNodes.set(edge.from_node, new Set());
      divergeToNodes.get(edge.from_node)!.add(edge.to_node);
    }

    // 분기점 (outgoing >= 2)
    const divergeNodes: string[] = [];
    for (const [node, toNodes] of divergeToNodes) {
      if (toNodes.size >= 2) divergeNodes.push(node);
    }

    // 분기점 쌍 중 같은 합류점 2개로 분기하는 경우 감지
    for (let i = 0; i < divergeNodes.length; i++) {
      const toA = divergeToNodes.get(divergeNodes[i])!;
      for (let j = i + 1; j < divergeNodes.length; j++) {
        const toD = divergeToNodes.get(divergeNodes[j])!;
        const common = [...toA].filter(n => toD.has(n));
        if (common.length === 2 && mergeNodes.has(common[0]) && mergeNodes.has(common[1])) {
          dzMerges.add(common[0]);
          dzMerges.add(common[1]);
        }
      }
    }

    this.state.deadlockZoneMerges = dzMerges;
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
