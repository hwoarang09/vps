import { Edge } from "@/types/edge";
import { EdgeType } from "@/types";
const DEBUG = false;
/**
 * 합류 지점 진입 권한(Grant) 정보
 */
export type Grant = {
  /** 진입을 허가받은 Edge의 이름 (예: "E01_02") */
  edge: string;
  /** 진입하는 차량의 Index (Vehicle ID) */
  veh: number;
} | null;

/**
 * 락 요청 정보 (FIFO 구현을 위해 시간/순서 기록)
 */
export type LockRequest = {
  vehId: number;
  edgeName: string; // 진입 엣지
  requestTime: number; // 요청 시간 (Frame Count or Timestamp)
};

/**
 * 합류 지점(Merge Node)의 상태 관리 객체
 */
export type MergeLockNode = {
  /** 합류 노드 이름 (예: "N001") */
  name: string;
  
  /** 
   * 모든 진입 요청 목록 (FIFO 등 전역 순서 관리를 위해 통합)
   * - 전략에 따라 이 리스트를 정렬하거나 필터링해서 사용
   */
  requests: LockRequest[];

  /** * 각 진입 Edge별 대기 차량 큐 (빠른 룩업용, requests와 동기화) */
  edgeQueues: Record<string, number[]>;
  
  /** * 합류 구간을 통과 중인 차량 목록 (Merge Zone 점유 중)
   */
  mergedQueue: number[];
  
  /** * 현재 합류 지점을 점유(Lock)하고 있는 차량 정보
   * - null이면 점유 중인 차량 없음
   */
  granted: Grant;
  
  /** * 병합 전략(Priority, FIFO 등)에 필요한 상태 저장소
   */
  strategyState: Record<string, unknown>;
};

/**
 * 병합 전략 함수 타입
 * - node 상태를 보고 Grant(누가 진입할지)를 결정하여 반환
 * - null 반환 시 "아직 진입 불가" 또는 "대기자 없음"
 */
export type MergeStrategy = (node: MergeLockNode) => Grant | null;

/**
 * [전략 1] FIFO (First-Come-First-Served)
 * - 가장 먼저 요청(requestTime)한 차량에게 우선권 부여
 */
const FIFO_Strategy: MergeStrategy = (node) => {
  if (node.granted) return null; // 이미 점유 중
  if (node.requests.length === 0) return null; // 대기자 없음

  // requestTime 오름차순 정렬 (먼저 온 순서)
  // *최적화: 삽입 시 정렬하거나, Heap 사용 가능하지만, 차량 수가 적으므로 sort도 무방
  node.requests.sort((a, b) => a.requestTime - b.requestTime);

  const target = node.requests[0];
  return { veh: target.vehId, edge: target.edgeName };
};

/**
 * 전체 락 테이블
 * - Key: Merge Node Name (합류 지점 노드명)
 * - Value: 해당 지점의 Lock 상태 객체
 */
export type LockTable = Record<string, MergeLockNode>;

export class LockMgr {
  /** * 모든 합류 지점의 상태를 관리하는 테이블 
   * - Key: Node Name
   */
  private lockTable: LockTable = {};

  /** * 현재 적용된 병합 전략 */
  private currentStrategy: MergeStrategy = FIFO_Strategy;

  /**
   * 전략 변경
   */
  setStrategy(strategy: MergeStrategy) {
    this.currentStrategy = strategy;
  }

  /**
   * 락 테이블 초기화
   */
  reset() {
    this.lockTable = {};
  }

  /**
   * 맵 데이터(Edges)를 기반으로 초기 Lock Table을 생성합니다.
   * - 로직: 하나의 Node로 들어오는(Incoming) Edge가 2개 이상이면 '합류 지점'으로 간주합니다.
   * - Key는 Node Name(edge.to_node)을 사용합니다.
   */
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
        requests: [], // 초기화
        edgeQueues,
        mergedQueue: [],
        granted: null,
        strategyState: {},
      };
    }
    console.log(`[LockMgr] ✅ Total Merge Nodes: ${Object.keys(this.lockTable).length}`);
    console.log(`===============================================\n`);
  }

  /**
   * 현재 구성된 Lock Table 전체를 반환합니다.
   */
  getTable() {
    return this.lockTable;
  }

  /**
   * 해당 노드가 합류 지점(Merge Node)인지 확인합니다.
   */
  isMergeNode(nodeName: string): boolean {
    return !!this.lockTable[nodeName];
  }

  /**
   * 특정 차량이 해당 합류 지점의 권한(Grant)을 가지고 있는지 확인합니다.
   */
  checkGrant(nodeName: string, vehId: number): boolean {
    const node = this.lockTable[nodeName];
    if (!node) return true; // 합류지점이 아니면 항상 통과 가능(논리적으로)
    
    // Grant가 있고, 그 vehicle이 나 자신이면 true
    return node.granted?.veh === vehId;
  }

  /**
   * 합류 지점 진입 전 대기해야 할 거리(Edge Start로부터의 거리)를 반환합니다.
   * - Curve: 0 (Node 진입 즉시 대기, 실제로는 fromNode)
   * - Linear >= 2m: toNode - 1m
   * - Linear < 2m: 0 (fromNode)
   */
  getWaitDistance(edge: Edge): number {
    // 1. 곡선 Edge
    if (edge.vos_rail_type !== EdgeType.LINEAR) {
      return 0;
    }

    // 2. 직선 Edge (m 단위)
    if (edge.distance >= 3) {
      return edge.distance - 3;
    } else {
      return 0;
    }
  }

  /**
   * 차량이 합류 지점 통과를 요청합니다 (Queue 등록).
   */
  requestLock(nodeName: string, edgeName: string, vehId: number) {
    const node = this.lockTable[nodeName];
    if (!node) return;

    // 이미 요청 목록에 있는지 확인 (requests에서 검색)
    const existing = node.requests.find(r => r.vehId === vehId);
    if (!existing && node.granted?.veh !== vehId) {
      if (DEBUG) console.log(`[LockMgr ${nodeName} VEH${vehId}] REQUEST (Edge: ${edgeName})`);
      // 신규 요청
      node.requests.push({
        vehId,
        edgeName,
        requestTime: Date.now() // 현재 시간 (혹은 프레임 카운트)
      });
      // Edge Queue (Lookup용)
      node.edgeQueues[edgeName]?.push(vehId);
      this.logNodeState(nodeName);
    }

    // 진입 시도
    this.tryGrant(nodeName);
  }

  /**
   * 합류 지점을 빠져나간 차량이 락을 해제합니다.
   */
  releaseLock(nodeName: string, vehId: number) {
    const node = this.lockTable[nodeName];
    if (!node) return;

    // 락 해제
    if (node.granted?.veh === vehId) {
      if (DEBUG) console.log(`[LockMgr ${nodeName} VEH${vehId}] RELEASE`);
      node.granted = null;

      // 요청 목록에서도 제거 (이미 제거되었어야 하지만 안전장치)
      node.requests = node.requests.filter(r => r.vehId !== vehId);
      
      // Edge Queue에서도 제거
      for (const key in node.edgeQueues) {
        node.edgeQueues[key] = node.edgeQueues[key].filter(id => id !== vehId);
      }
      
      this.logNodeState(nodeName);

      // 다음 차량에게 기회
      this.tryGrant(nodeName);
    } else if (DEBUG) console.warn(`[LockMgr ${nodeName} VEH${vehId}] RELEASE IGNORED (Holder: ${node.granted?.veh})`);         
  }

  /**
   * 대기 중인 차량 중 하나에게 락을 부여합니다.
   * 전략: 현재 설정된 Strategy 사용
   */
  tryGrant(nodeName: string) {
    const node = this.lockTable[nodeName];
    if (!node) return;
    if (node.granted && DEBUG) {
      console.log(`[LockMgr ${nodeName}] TryGrant: Blocked by ${node.granted.veh}`);
      return; // 이미 점유 중
    }

    // 전략 실행
    const decision = this.currentStrategy(node);
    
    if (decision) {
      if (DEBUG) console.log(`[LockMgr ${nodeName} VEH${decision.veh}] GRANT`);
      // 결정된 차량에게 락 부여
      node.granted = decision;
      
      // 주의: 여기서 requests에서 제거하면 안됨. FIFO 정렬 시 requestTime이 필요할 수 있음?
      // 아니, Grant가 되었으면 'Wait Queue'에서는 빠져야 함.
      // 하지만 FIFO 전략에서는 requests[0]을 보고 판단함.
      // 일단 Grant 상태로 두고, releaseLock에서 requests를 비우는 것이 맞을수도,
      // 혹은 여기서 비우고 granted에만 남겨둬도 됨.
      // FIFO 로직상: requests에 남아있으면 계속 1순위로 나옴.
      // 그러니 여기서 빼는게 맞음.
      node.requests = node.requests.filter(r => r.vehId !== decision.veh);
      this.logNodeState(nodeName);
    } else {
       console.log(`[LockMgr ${nodeName}] TryGrant: No one selected (Queue len: ${node.requests.length})`);
    }
  }

  logNodeState(nodeName: string) {
      const node = this.lockTable[nodeName];
      if(!node) return;
      const queue = node.requests.map(r => r.vehId).join(", ");
      const cur = node.granted ? `[${node.granted.veh}]` : "[FREE]";
      console.log(`[LockMgr ${nodeName}] STATE: Holder=${cur}, Queue={${queue}}`);
  }
}

// 싱글톤 인스턴스
let _lockMgr: LockMgr | null = null;

/**
 * LockMgr 싱글톤 인스턴스를 반환합니다.
 * 없으면 생성합니다.
 */
export function getLockMgr() {
  _lockMgr ??= new LockMgr();
  return _lockMgr;
}

/**
 * LockMgr를 강제로 재생성(리셋)하고 반환합니다.
 */
export function resetLockMgr() {
  _lockMgr = new LockMgr();
  return _lockMgr;
}