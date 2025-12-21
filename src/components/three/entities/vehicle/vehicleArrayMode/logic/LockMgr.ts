import { Edge } from "@/types/edge";

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
 * 합류 지점(Merge Node)의 상태 관리 객체
 */
export type MergeLockNode = {
  /** 합류 노드 이름 (예: "N001") */
  name: string;
  
  /** * 각 진입 Edge별 대기 차량 큐 
   * - Key: Edge Name (들어오는 방향)
   * - Value: Vehicle Index 배열 (대기 중인 차량들)
   */
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

    /** * 노드별 진입 엣지 목록 임시 저장소
     * - Key: To Node Name (목적지 노드)
     * - Value: List of Incoming Edge Names (들어오는 엣지 이름들)
     */
    const incomingEdgesByNode = new Map<string, string[]>();

    // 1. 노드별로 들어오는 엣지들을 그룹화
    for (const edge of edges) {
      const toNode = edge.to_node;
      
      // 변수명을 구체적으로 변경 (arr -> edgeNames)
      const edgeNames = incomingEdgesByNode.get(toNode);
      
      if (edgeNames) {
        edgeNames.push(edge.edge_name);
      } else {
        incomingEdgesByNode.set(toNode, [edge.edge_name]);
      }
    }

    // 2. 들어오는 엣지가 2개 이상인 노드만 LockTable에 등록
    for (const [mergeName, incomingEdgeNames] of incomingEdgesByNode.entries()) {
      if (incomingEdgeNames.length < 2) continue;

      // 대기 큐 초기화 (모든 진입 엣지에 대해 빈 배열 생성)
      const edgeQueues: Record<string, number[]> = {};
      for (const edgeName of incomingEdgeNames) {
        edgeQueues[edgeName] = [];
      }

      this.lockTable[mergeName] = {
        name: mergeName,
        edgeQueues,
        mergedQueue: [],
        granted: null,
        strategyState: {},
      };
    }

    console.log("[LockMgr] initFromEdges done:", this.lockTable);
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
   * - Linear >= 2000: toNode - 1000
   * - Linear < 2000: 0 (fromNode)
   */
  getWaitDistance(edge: Edge): number {
    // 1. 곡선 Edge
    if (edge.vos_rail_type !== "LINEAR") {
      return 0; 
    }

    // 2. 직선 Edge
    if (edge.distance >= 2000) {
      return edge.distance - 1000;
    } else {
      return 0; 
    }
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