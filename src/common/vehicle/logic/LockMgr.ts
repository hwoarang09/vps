// common/vehicle/logic/LockMgr.ts
// 새로운 단순한 락 시스템

import type { Edge } from "@/types/edge";
import type { Node } from "@/types/node";
import {
  CheckpointFlags,
  CHECKPOINT_SECTION_SIZE,
  CHECKPOINT_FIELDS,
  MovementData,
  LogicData,
  VEHICLE_DATA_SIZE,
  StopReason,
  MovingStatus,
  NextEdgeState,
  NEXT_EDGE_COUNT,
} from "@/common/vehicle/initialize/constants";
import { MAX_PATH_LENGTH, PATH_LEN, PATH_EDGES_START } from "./TransferMgr";
import { devLog } from "@/logger/DevLogger";

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
 * LockMgr - 단순한 락 시스템
 */
export class LockMgr {
  // 참조 저장
  private vehicleDataArray: Float32Array | null = null;
  private checkpointArray: Float32Array | null = null;
  private pathBuffer: Int32Array | null = null;
  private nodes: Node[] = [];
  private edges: Edge[] = [];

  // merge node 목록 (빠른 조회용)
  private mergeNodes = new Set<string>();
  // merge node -> 이름 매핑 (빠른 조회용)
  private mergeNodeNames = new Map<string, string>();

  // 락 상태
  private locks = new Map<string, number>();        // nodeName -> vehId (현재 잡고 있는 차량)
  private queues = new Map<string, number[]>();     // nodeName -> vehId[] (대기 큐)

  // 자동 해제: 차량이 releaseEdge에 도달하면 lock release
  private pendingReleases = new Map<number, Array<{ nodeName: string; releaseEdgeIdx: number }>>();

  constructor() {}

  /** 1-based edge index → edge name (e.g. "E_29") */
  private eName(idx: number): string {
    if (idx < 1) return '?';
    const edge = this.edges[idx - 1];
    return edge ? edge.edge_name : `?${idx}`;
  }

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
    this.vehicleDataArray = vehicleDataArray;
    this.checkpointArray = checkpointArray;
    this.pathBuffer = pathBuffer;
    this.nodes = nodes;
    this.edges = edges;

    // merge node 목록 구축
    this.buildMergeNodes();
  }

  /**
   * Edge 정보에서 merge node 찾기
   */
  private buildMergeNodes(): void {
    this.mergeNodes.clear();
    this.mergeNodeNames.clear();
    const incomingCount = new Map<string, number>();

    for (const edge of this.edges) {
      const count = incomingCount.get(edge.to_node) ?? 0;
      incomingCount.set(edge.to_node, count + 1);
    }

    for (const [nodeName, count] of incomingCount) {
      if (count >= 2) {
        this.mergeNodes.add(nodeName);
        this.mergeNodeNames.set(nodeName, nodeName);
      }
    }
  }

  /**
   * 매 프레임 호출 - 전체 차량 순회
   */
  updateAll(numVehicles: number, policy: LockPolicy = { default: 'FIFO' }): void {
    // 자동 해제 체크 (checkpoint 처리 전에)
    this.checkAutoRelease();

    for (let i = 0; i < numVehicles; i++) {
      this.processLock(i, policy);
    }
  }

  /**
   * 개별 차량 락 처리 (Checkpoint 시스템)
   */
  processLock(vehicleId: number, _policy: LockPolicy): void {
    if (!this.vehicleDataArray || !this.checkpointArray) {
      devLog.veh(vehicleId).debug(
        `[processLock] SKIP: dataArray=${!!this.vehicleDataArray} cpArray=${!!this.checkpointArray}`
      );
      return;
    }
    if (!this.nodes.length || !this.edges.length) {
      devLog.veh(vehicleId).debug(
        `[processLock] SKIP: nodes=${this.nodes.length} edges=${this.edges.length}`
      );
      return;
    }

    this.processCheckpoint(vehicleId);
  }

  /**
   * Checkpoint 기반 락 처리
   *
   * 설계:
   * 1. VehicleDataArray의 CURRENT_CP_* 필드 사용
   * 2. 각 flag 개별 처리 후 해당 flag 제거
   * 3. flags == 0이면 다음 checkpoint 로드
   * 4. edge mismatch 시 놓친 CP 감지 → catch-up 처리
   */
  private processCheckpoint(vehicleId: number): void {
    if (!this.vehicleDataArray || !this.checkpointArray) return;

    const data = this.vehicleDataArray;
    const ptr = vehicleId * VEHICLE_DATA_SIZE;

    // Catch-up loop: 놓친 CP를 연속 처리 (최대 10개)
    const MAX_CATCHUP = 10;
    for (let attempt = 0; attempt < MAX_CATCHUP; attempt++) {
      // 현재 checkpoint 읽기 (VehicleDataArray에서)
      let cpEdge = data[ptr + LogicData.CURRENT_CP_EDGE];
      let cpRatio = data[ptr + LogicData.CURRENT_CP_RATIO];
      let cpFlags = data[ptr + LogicData.CURRENT_CP_FLAGS];

      const currentEdge = data[ptr + MovementData.CURRENT_EDGE];
      const currentRatio = data[ptr + MovementData.EDGE_RATIO];
      const head = data[ptr + LogicData.CHECKPOINT_HEAD];

      // checkpoint가 없으면 로드 시도
      if (cpEdge === 0) {
        devLog.veh(vehicleId).debug(
          `[processCP] cpEdge=0, trying load. curE=${this.eName(currentEdge)} curR=${currentRatio.toFixed(3)} head=${head}`
        );
        if (!this.loadNextCheckpoint(vehicleId, data, ptr)) {
          return; // 더 이상 checkpoint 없음
        }
        cpEdge = data[ptr + LogicData.CURRENT_CP_EDGE];
        cpRatio = data[ptr + LogicData.CURRENT_CP_RATIO];
        cpFlags = data[ptr + LogicData.CURRENT_CP_FLAGS];
      }

      // 🚀 초고속 체크: 현재 위치가 checkpoint에 도달했는지
      if (currentEdge !== cpEdge) {
        // 놓친 CP 감지: cpEdge가 pathBuffer에 없으면 이미 지나간 것
        if (this.isCpEdgeBehind(vehicleId, cpEdge)) {
          devLog.veh(vehicleId).debug(
            `[processCP] MISSED! cur=${this.eName(currentEdge)}@${currentRatio.toFixed(3)} passed cp=${this.eName(cpEdge)}@${cpRatio.toFixed(3)} flags=${cpFlags} head=${head}`
          );
          this.handleMissedCheckpoint(vehicleId, data, ptr, cpFlags);
          data[ptr + LogicData.CURRENT_CP_FLAGS] = 0;
          this.loadNextCheckpoint(vehicleId, data, ptr);
          continue; // 다음 CP도 놓쳤을 수 있음
        }
        devLog.veh(vehicleId).debug(
          `[processCP] SKIP edge mismatch: cur=${this.eName(currentEdge)} !== cp=${this.eName(cpEdge)} curR=${currentRatio.toFixed(3)} cpR=${cpRatio.toFixed(3)} flags=${cpFlags} head=${head}`
        );
        return;
      }
      if (currentRatio < cpRatio) {
        devLog.veh(vehicleId).debug(
          `[processCP] SKIP ratio: cur=${this.eName(currentEdge)} curR=${currentRatio.toFixed(3)} < cpR=${cpRatio.toFixed(3)} flags=${cpFlags} head=${head}`
        );
        return;
      }

      // ✅ Checkpoint 도달!
      devLog.veh(vehicleId).debug(
        `[processCP] HIT! cur=${this.eName(currentEdge)}@${currentRatio.toFixed(3)} cp=${this.eName(cpEdge)}@${cpRatio.toFixed(3)} flags=${cpFlags} head=${head}`
      );

      // MOVE_PREPARE 처리 (가장 먼저 - edge 요청)
      if (cpFlags & CheckpointFlags.MOVE_PREPARE) {
        this.handleMovePrepare(vehicleId, data, ptr);
        cpFlags &= ~CheckpointFlags.MOVE_PREPARE;
        data[ptr + LogicData.CURRENT_CP_FLAGS] = cpFlags;
      }

      // LOCK_RELEASE 처리 (lock 해제)
      if (cpFlags & CheckpointFlags.LOCK_RELEASE) {
        this.handleLockRelease(vehicleId, data, ptr);
        cpFlags &= ~CheckpointFlags.LOCK_RELEASE;
        data[ptr + LogicData.CURRENT_CP_FLAGS] = cpFlags;
      }

      // LOCK_REQUEST 처리 (lock 요청 - 요청 후 무조건 flag 해제)
      if (cpFlags & CheckpointFlags.LOCK_REQUEST) {
        this.handleLockRequest(vehicleId, data, ptr);
        cpFlags &= ~CheckpointFlags.LOCK_REQUEST;
        data[ptr + LogicData.CURRENT_CP_FLAGS] = cpFlags;
      }

      // LOCK_WAIT 처리 (lock 대기)
      if (cpFlags & CheckpointFlags.LOCK_WAIT) {
        const granted = this.handleLockWait(vehicleId, data, ptr);
        if (granted) {
          cpFlags &= ~CheckpointFlags.LOCK_WAIT;
          data[ptr + LogicData.CURRENT_CP_FLAGS] = cpFlags;
        }
      }

      // flags가 0이면 → 다음 checkpoint 로드
      if (cpFlags === 0) {
        devLog.veh(vehicleId).debug(
          `[processCP] flags=0, loading next. cur=${this.eName(currentEdge)} head=${data[ptr + LogicData.CHECKPOINT_HEAD]}`
        );
        this.loadNextCheckpoint(vehicleId, data, ptr);
      }
      return; // 정상 HIT 처리 완료
    }
  }

  /**
   * CP의 edge가 이미 지나간 edge인지 확인
   * - cpEdge가 currentEdge도 아니고 pathBuffer에도 없으면 → 이미 지나감
   */
  private isCpEdgeBehind(vehicleId: number, cpEdge: number): boolean {
    if (!this.pathBuffer) return false;
    const pathPtr = vehicleId * MAX_PATH_LENGTH;
    const pathLen = this.pathBuffer[pathPtr + PATH_LEN];

    for (let i = 0; i < pathLen; i++) {
      if (this.pathBuffer[pathPtr + PATH_EDGES_START + i] === cpEdge) {
        return false; // cpEdge가 아직 경로에 있음 → 지나가지 않음
      }
    }
    return true; // pathBuffer에 없음 → 이미 지나감
  }

  /**
   * 놓친 CP 처리 (짧은 edge를 한 프레임에 통과하여 CP를 놓친 경우)
   * - PREP: 실행 (nextEdges 채우기 - 필수!)
   * - REQ: 실행 (lock 요청)
   * - RELEASE: 실행 (lock 해제)
   * - WAIT: 스킵 (이미 지나간 지점, 대기 불가)
   */
  private handleMissedCheckpoint(vehicleId: number, data: Float32Array, ptr: number, cpFlags: number): void {
    if (cpFlags & CheckpointFlags.MOVE_PREPARE) {
      this.handleMovePrepare(vehicleId, data, ptr);
    }
    if (cpFlags & CheckpointFlags.LOCK_RELEASE) {
      this.handleLockRelease(vehicleId, data, ptr);
    }
    if (cpFlags & CheckpointFlags.LOCK_REQUEST) {
      this.handleLockRequest(vehicleId, data, ptr);
    }
    if (cpFlags & CheckpointFlags.LOCK_WAIT) {
      devLog.veh(vehicleId).debug(
        `[processCP] MISSED WAIT - skipped (already passed wait point)`
      );
    }
  }

  /**
   * 다음 checkpoint를 배열에서 가져와서 VehicleDataArray에 저장
   * @returns 로드 성공 여부
   */
  private loadNextCheckpoint(vehicleId: number, data: Float32Array, ptr: number): boolean {
    if (!this.checkpointArray) return false;

    const vehicleOffset = 1 + vehicleId * CHECKPOINT_SECTION_SIZE;
    const count = this.checkpointArray[vehicleOffset];
    const head = data[ptr + LogicData.CHECKPOINT_HEAD];

    // 더 이상 checkpoint 없음
    if (head >= count) {
      devLog.veh(vehicleId).debug(
        `[loadNextCP] END: head=${head} >= count=${count}`
      );
      data[ptr + LogicData.CURRENT_CP_EDGE] = 0;
      data[ptr + LogicData.CURRENT_CP_RATIO] = 0;
      data[ptr + LogicData.CURRENT_CP_FLAGS] = 0;
      data[ptr + LogicData.CURRENT_CP_TARGET] = 0;
      return false;
    }

    // checkpoint 배열에서 읽기
    const cpOffset = vehicleOffset + 1 + head * CHECKPOINT_FIELDS;
    const cpEdge = this.checkpointArray[cpOffset + 0];
    const cpRatio = this.checkpointArray[cpOffset + 1];
    const cpFlags = this.checkpointArray[cpOffset + 2];
    const cpTargetEdge = this.checkpointArray[cpOffset + 3];

    // VehicleDataArray에 저장
    data[ptr + LogicData.CURRENT_CP_EDGE] = cpEdge;
    data[ptr + LogicData.CURRENT_CP_RATIO] = cpRatio;
    data[ptr + LogicData.CURRENT_CP_FLAGS] = cpFlags;
    data[ptr + LogicData.CURRENT_CP_TARGET] = cpTargetEdge;

    // head 증가
    data[ptr + LogicData.CHECKPOINT_HEAD] = head + 1;

    const currentEdge = data[ptr + MovementData.CURRENT_EDGE];
    const currentRatio = data[ptr + MovementData.EDGE_RATIO];
    devLog.veh(vehicleId).debug(
      `[loadNextCP] head=${head}→${head + 1}/${count} loaded: cp=${this.eName(cpEdge)}@${cpRatio.toFixed(3)} flags=${cpFlags} tgt=${this.eName(cpTargetEdge)} | cur=${this.eName(currentEdge)}@${currentRatio.toFixed(3)}`
    );

    return true;
  }

  /**
   * Lock 해제 처리
   */
  private handleLockRelease(vehicleId: number, data: Float32Array, ptr: number): void {
    // 현재 edge의 to_node가 merge node일 것
    const currentEdgeIdx = Math.trunc(data[ptr + MovementData.CURRENT_EDGE]);
    if (currentEdgeIdx < 1) return;

    const edge = this.edges[currentEdgeIdx - 1];
    if (!edge) return;

    const nodeName = edge.to_node;
    if (!this.isMergeNode(nodeName)) return;

    // Lock 해제
    this.releaseLockInternal(nodeName, vehicleId);
    this.grantNextInQueue(nodeName);
  }

  /**
   * Lock 요청 처리
   * @returns granted 여부
   */
  private handleLockRequest(vehicleId: number, data: Float32Array, ptr: number): boolean {
    // checkpoint의 targetEdge = merge node에서 나가는 edge
    const targetEdgeIdx = Math.trunc(data[ptr + LogicData.CURRENT_CP_TARGET]);
    if (targetEdgeIdx < 1) return true;

    const targetEdge = this.edges[targetEdgeIdx - 1];
    if (!targetEdge) return true;

    // merge node = targetEdge의 from_node
    const nodeName = targetEdge.from_node;
    if (!this.isMergeNode(nodeName)) return true;

    // Lock 요청
    this.requestLockInternal(nodeName, vehicleId);

    // 자동 해제 등록: targetEdge 도달 시 release
    if (!this.pendingReleases.has(vehicleId)) {
      this.pendingReleases.set(vehicleId, []);
    }
    const releases = this.pendingReleases.get(vehicleId)!;
    // 중복 등록 방지
    if (!releases.some(r => r.nodeName === nodeName)) {
      releases.push({ nodeName, releaseEdgeIdx: targetEdgeIdx });
      devLog.veh(vehicleId).debug(
        `[LOCK_REQ] node=${nodeName} target=${this.eName(targetEdgeIdx)} → auto-release registered`
      );
    }

    // Grant 확인
    return this.checkGrantInternal(nodeName, vehicleId);
  }

  /**
   * Lock 대기 지점 처리
   * @returns granted 여부
   */
  private handleLockWait(vehicleId: number, data: Float32Array, ptr: number): boolean {
    // CURRENT_CP_TARGET = merge node에서 나가는 edge (builder가 세팅)
    const targetEdgeIdx = Math.trunc(data[ptr + LogicData.CURRENT_CP_TARGET]);
    if (targetEdgeIdx < 1) return true; // target 없으면 그냥 통과

    const targetEdge = this.edges[targetEdgeIdx - 1];
    if (!targetEdge) return true;

    const nodeName = targetEdge.from_node;
    if (!this.isMergeNode(nodeName)) return true; // merge가 아니면 통과

    const velocity = data[ptr + MovementData.VELOCITY];

    // lock holder 확인: 다른 차량이 잡고 있으면 대기, 비어있거나 내가 잡고 있으면 통과
    const holder = this.locks.get(nodeName);
    const blocked = holder !== undefined && holder !== vehicleId;

    if (blocked) {
      // 다른 차량이 lock 보유 → 강제 정지
      const curEdge = data[ptr + MovementData.CURRENT_EDGE];
      const curRatio = data[ptr + MovementData.EDGE_RATIO];
      devLog.veh(vehicleId).debug(
        `[LOCK_WAIT] BLOCKED node=${nodeName} holder=veh:${holder} next=${this.eName(targetEdgeIdx)} vel=${velocity.toFixed(1)} → FORCE STOP at ${this.eName(curEdge)}@${curRatio.toFixed(3)}`
      );
      data[ptr + MovementData.VELOCITY] = 0;
      data[ptr + MovementData.MOVING_STATUS] = MovingStatus.STOPPED;
      data[ptr + LogicData.STOP_REASON] |= StopReason.LOCKED;
      return false;
    } else {
      // lock 비어있거나 내가 보유 → 통과
      const curEdge = data[ptr + MovementData.CURRENT_EDGE];
      const curRatio = data[ptr + MovementData.EDGE_RATIO];
      devLog.veh(vehicleId).debug(
        `[LOCK_WAIT] PASS node=${nodeName} next=${this.eName(targetEdgeIdx)} → MOVING at ${this.eName(curEdge)}@${curRatio.toFixed(3)}`
      );
      data[ptr + LogicData.STOP_REASON] &= ~StopReason.LOCKED;
      data[ptr + MovementData.MOVING_STATUS] = MovingStatus.MOVING;
      return true;
    }
  }

  /**
   * 이동 준비 처리 - 다음 checkpoint까지 NEXT_EDGE 채우기
   */
  private handleMovePrepare(vehicleId: number, data: Float32Array, ptr: number): void {
    if (!this.pathBuffer || !this.checkpointArray) {
      devLog.veh(vehicleId).warn(`[MOVE_PREP] no pathBuffer or checkpointArray`);
      return;
    }

    // CURRENT_CP_TARGET에서 targetEdge 직접 읽기 (builder가 저장한 값)
    const targetEdge = data[ptr + LogicData.CURRENT_CP_TARGET];

    // pathBuffer에서 targetEdge까지 NEXT_EDGE 채우기
    const pathPtr = vehicleId * MAX_PATH_LENGTH;
    const pathLen = this.pathBuffer[pathPtr + PATH_LEN];

    // pathBuffer 현재 상태 로그
    const pathEdges: number[] = [];
    for (let i = 0; i < Math.min(pathLen, 10); i++) {
      pathEdges.push(this.pathBuffer[pathPtr + PATH_EDGES_START + i]);
    }
    devLog.veh(vehicleId).debug(
      `[MOVE_PREP] target=${this.eName(targetEdge)} pathLen=${pathLen} pathBuf=[${pathEdges.map(e => this.eName(e)).join(',')}]`
    );

    const nextEdgeOffsets = [
      MovementData.NEXT_EDGE_0,
      MovementData.NEXT_EDGE_1,
      MovementData.NEXT_EDGE_2,
      MovementData.NEXT_EDGE_3,
      MovementData.NEXT_EDGE_4,
    ];

    const filledEdges: number[] = [];

    for (let i = 0; i < NEXT_EDGE_COUNT; i++) {
      if (i >= pathLen) {
        data[ptr + nextEdgeOffsets[i]] = 0;
        filledEdges.push(0);
        continue;
      }

      const edgeIdx = this.pathBuffer[pathPtr + PATH_EDGES_START + i];
      if (edgeIdx < 1) {
        data[ptr + nextEdgeOffsets[i]] = 0;
        filledEdges.push(0);
        continue;
      }

      data[ptr + nextEdgeOffsets[i]] = edgeIdx;
      filledEdges.push(edgeIdx);

      // targetEdge까지만 채움
      if (targetEdge > 0 && edgeIdx === targetEdge) {
        for (let j = i + 1; j < NEXT_EDGE_COUNT; j++) {
          data[ptr + nextEdgeOffsets[j]] = 0;
        }
        break;
      }
    }

    // NEXT_EDGE_STATE 설정
    const firstNext = data[ptr + MovementData.NEXT_EDGE_0];
    data[ptr + MovementData.NEXT_EDGE_STATE] = firstNext > 0 ? NextEdgeState.READY : NextEdgeState.EMPTY;

    devLog.veh(vehicleId).debug(
      `[MOVE_PREP] filled=[${filledEdges.map(e => this.eName(e)).join(',')}] state=${firstNext > 0 ? 'READY' : 'EMPTY'}`
    );
  }

  /**
   * Lock 요청 (내부 구현)
   */
  private requestLockInternal(nodeName: string, vehId: number): void {
    if (!this.queues.has(nodeName)) {
      this.queues.set(nodeName, []);
    }

    const queue = this.queues.get(nodeName)!;
    if (!queue.includes(vehId)) {
      queue.push(vehId);

      // 큐가 비어있으면 즉시 grant
      if (queue.length === 1 && !this.locks.has(nodeName)) {
        this.locks.set(nodeName, vehId);
      }
    }
  }

  /**
   * Grant 확인 (내부 구현)
   */
  private checkGrantInternal(nodeName: string, vehId: number): boolean {
    return this.locks.get(nodeName) === vehId;
  }

  /**
   * Lock 해제 (내부 구현)
   */
  private releaseLockInternal(nodeName: string, vehId: number): void {
    if (this.locks.get(nodeName) === vehId) {
      this.locks.delete(nodeName);

      // 큐에서도 제거
      const queue = this.queues.get(nodeName);
      if (queue) {
        const idx = queue.indexOf(vehId);
        if (idx !== -1) {
          queue.splice(idx, 1);
        }
      }
    }
  }

  /**
   * 큐에서만 제거 (lock 미보유 상태에서 auto-release 도달 시)
   */
  private cancelFromQueue(nodeName: string, vehId: number): void {
    const queue = this.queues.get(nodeName);
    if (queue) {
      const idx = queue.indexOf(vehId);
      if (idx !== -1) {
        queue.splice(idx, 1);
      }
    }
  }

  /**
   * 큐 다음 차량에 grant
   */
  private grantNextInQueue(nodeName: string): void {
    const queue = this.queues.get(nodeName);
    if (!queue || queue.length === 0) return;

    // 큐의 첫 번째 차량에 grant
    const nextVeh = queue[0];
    this.locks.set(nodeName, nextVeh);
    devLog.veh(nextVeh).debug(
      `[LOCK_GRANT] node=${nodeName} granted from queue`
    );
  }

  /**
   * 자동 해제 체크
   * - 차량이 releaseEdge에 도달하면 lock 해제
   */
  private checkAutoRelease(): void {
    if (!this.vehicleDataArray) return;
    const data = this.vehicleDataArray;

    for (const [vehId, releases] of this.pendingReleases) {
      const ptr = vehId * VEHICLE_DATA_SIZE;
      const currentEdge = data[ptr + MovementData.CURRENT_EDGE];

      for (let i = releases.length - 1; i >= 0; i--) {
        const info = releases[i];
        if (currentEdge === info.releaseEdgeIdx) {
          const holder = this.locks.get(info.nodeName);
          if (holder === vehId) {
            // 정상 release: lock 보유 중 → 해제 + 다음 차량에 grant
            this.releaseLockInternal(info.nodeName, vehId);
            this.grantNextInQueue(info.nodeName);
            devLog.veh(vehId).debug(
              `[AUTO_RELEASE] node=${info.nodeName} at ${this.eName(currentEdge)}`
            );
          } else {
            // lock 안 잡고 있음 → 큐에서만 제거 (cancel)
            this.cancelFromQueue(info.nodeName, vehId);
            devLog.veh(vehId).debug(
              `[AUTO_RELEASE] CANCEL node=${info.nodeName} at ${this.eName(currentEdge)} (not holder, holder=${holder})`
            );
          }
          releases.splice(i, 1);
        }
      }

      if (releases.length === 0) {
        this.pendingReleases.delete(vehId);
      }
    }
  }

  /**
   * merge node 여부 확인
   */
  isMergeNode(nodeName: string): boolean {
    return this.mergeNodes.has(nodeName);
  }

  /**
   * 리셋
   */
  reset(): void {
    this.locks.clear();
    this.queues.clear();
    this.pendingReleases.clear();
  }

  /**
   * Lock 상태 스냅샷 반환 (Lock Info Panel용)
   * - 현재 활성 lock/queue가 있는 노드만 반환
   */
  getLockSnapshot(): Array<{
    nodeName: string;
    holderVehId: number | undefined;
    holderEdge: string;
    waiters: Array<{ vehId: number; edgeName: string }>;
  }> {
    const result: Array<{
      nodeName: string;
      holderVehId: number | undefined;
      holderEdge: string;
      waiters: Array<{ vehId: number; edgeName: string }>;
    }> = [];

    // 활성 노드 수집 (lock 또는 queue가 있는 노드)
    const activeNodes = new Set<string>();
    for (const nodeName of this.locks.keys()) activeNodes.add(nodeName);
    for (const [nodeName, queue] of this.queues) {
      if (queue.length > 0) activeNodes.add(nodeName);
    }

    for (const nodeName of activeNodes) {
      const holder = this.locks.get(nodeName);
      const queue = this.queues.get(nodeName) ?? [];

      const waiters: Array<{ vehId: number; edgeName: string }> = [];
      for (const vehId of queue) {
        if (vehId === holder) continue; // holder는 granted에 표시
        waiters.push({ vehId, edgeName: this.getVehicleEdgeName(vehId) });
      }

      result.push({
        nodeName,
        holderVehId: holder,
        holderEdge: holder !== undefined ? this.getVehicleEdgeName(holder) : '',
        waiters,
      });
    }

    return result;
  }

  /** Vehicle의 현재 edge name 조회 */
  private getVehicleEdgeName(vehId: number): string {
    if (!this.vehicleDataArray) return '?';
    const ptr = vehId * VEHICLE_DATA_SIZE;
    const edgeIdx = Math.trunc(this.vehicleDataArray[ptr + MovementData.CURRENT_EDGE]);
    return this.eName(edgeIdx);
  }

  // ============================================================================
  // Legacy 호환용 stub (점진적 제거 예정)
  // ============================================================================

  initFromEdges(edges: Edge[]): void {
    this.edges = edges;
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

  setLockConfig(_config: unknown): void {}
  setLockPolicy(_policy: unknown): void {}

  getWaitDistanceFromMergingStr(): number { return 5; }
  getRequestDistanceFromMergingStr(): number { return 20; }
  getWaitDistanceFromMergingCurve(): number { return 5; }
  getRequestDistanceFromMergingCurve(): number { return 30; }

  isDeadlockZoneNode(_nodeName: string): boolean { return false; }
  isDeadlockBranchNode(_nodeName: string): boolean { return false; }
  getDeadlockZoneStrategy(): string { return 'NONE'; }
  notifyArrival(_nodeName: string, _vehId: number): void {}

  getTable(): Map<string, MergeLockNode> {
    return new Map();
  }

  getGrantStrategy(): GrantStrategy {
    return 'FIFO';
  }
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

// Singleton
let lockMgrInstance: LockMgr | null = null;

export function getLockMgr(): LockMgr {
  if (!lockMgrInstance) {
    lockMgrInstance = new LockMgr();
  }
  return lockMgrInstance;
}

export function resetLockMgr(): void {
  lockMgrInstance = null;
}
