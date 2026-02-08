// TransferMgr/types.ts
// 타입, 인터페이스, 상수 정의

import type { Edge } from "@/types/edge";
import type { TransferMode } from "@/common/vehicle/initialize/constants";

/**
 * Path buffer layout constants
 * Layout: [len, edge0, edge1, ..., edge98]
 * - len: 남은 경로 길이 (0 = no path)
 * - edge0~: edge indices (앞에서부터 순서대로)
 *
 * Edge 통과 시 pathBuffer를 실제로 shift (맨 앞 제거)
 */
export const MAX_PATH_LENGTH = 100;
export const PATH_LEN = 0;              // len 위치
export const PATH_EDGES_START = 1;      // edge indices 시작 위치

export type VehicleLoop = {
  edgeSequence: string[];
};

/**
 * processPathCommand 컨텍스트
 */
export interface ProcessPathCommandContext {
  vehId: number;
  path: Array<{ edgeId: string; targetRatio?: number }>;
  currentEdge: Edge;
  edgeArray: Edge[];
  edgeNameToIndex: Map<string, number>;
  data: Float32Array;
  ptr: number;
  lockMgr?: ILockMgrForNextEdge;
}

/** LockMgr interface for merge check */
export interface ILockMgrForNextEdge {
  isMergeNode(nodeName: string): boolean;
  checkGrant(nodeName: string, vehId: number): boolean;
}

/** fillNextEdges Context */
export interface FillNextEdgesContext {
  data: Float32Array;
  ptr: number;
  firstNextEdgeIndex: number;
  edgeArray: Edge[];
  vehicleLoopMap: Map<number, VehicleLoop>;
  edgeNameToIndex: Map<string, number>;
  mode: TransferMode;
  vehicleIndex: number;
  lockMgr?: ILockMgrForNextEdge;
}

export interface IVehicleDataArray {
  getData(): Float32Array;
}

/**
 * Vehicle command structure for MQTT control
 */
export interface VehicleCommand {
  /** Target position on current edge (0~1) */
  targetRatio?: number;
  /** Next edge ID to transition to */
  nextEdgeId?: string;
  /** Path array for multi-edge reservation (for speed control optimization) */
  path?: Array<{edgeId: string; targetRatio?: number}>;
}

export interface ReservedEdge {
  edgeId: string;
  targetRatio?: number;
}

/**
 * 곡선 사전 감속 상태
 */
export interface CurveBrakeState {
  /** 감속 시작했는지 */
  isBraking: boolean;
  /** 목표 곡선 Edge 이름 */
  targetCurveEdge: string | null;
}

/**
 * Loop에서 다음 edge 찾기
 */
export function getNextEdgeInLoop(
  currentEdgeName: string,
  sequence: string[]
): string {
  const idx = sequence.indexOf(currentEdgeName);
  if (idx === -1) return sequence[0];
  return sequence[(idx + 1) % sequence.length];
}
