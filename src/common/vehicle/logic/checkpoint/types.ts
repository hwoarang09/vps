// common/vehicle/logic/checkpoint/types.ts
// Checkpoint 생성 관련 타입 정의

import type { Edge } from "@/types/edge";
import type { Checkpoint } from "@/common/vehicle/initialize/constants";

/**
 * Checkpoint 생성 컨텍스트
 */
export interface CheckpointBuildContext {
  /** 경로 edge 인덱스 배열 (1-based) */
  edgeIndices: number[];
  /** 전체 edge 배열 (0-based 접근) */
  edgeArray: Edge[];
  /** Merge node 확인 함수 */
  isMergeNode: (nodeName: string) => boolean;
  /** DeadLock Merge node 확인 함수 */
  isDeadLockMergeNode: (nodeName: string) => boolean;
}

/**
 * Merge checkpoint 생성 옵션
 */
export interface MergeCheckpointOptions {
  /** 직선 target 요청 거리 (meters) - from_node 기준 (기본값: 5.1m) */
  straightRequestDistance: number;
  /** 곡선 target 요청 거리 (meters) - from_node 기준 (기본값: 1.0m) */
  curveRequestDistance: number;
  /** Lock 해제 ratio - 다음 edge 진입 후 (기본값: 0.01) */
  releaseRatio: number;
  // 주의: Lock 대기 거리는 edge.map의 waiting_offset 사용
}

/**
 * On-Curve checkpoint 생성 옵션
 * (곡선 edge 위에 있을 때의 checkpoint)
 */
export interface OnCurveCheckpointOptions {
  /** 다음 edge 준비 시작 ratio (config에서 가져옴) */
  prepareRatio: number;
}

/**
 * Checkpoint 생성 결과
 * (배열 맨 앞에 길이가 저장되므로 checkpoints만 반환)
 */
export interface CheckpointBuildResult {
  /** 생성된 checkpoint 리스트 */
  checkpoints: Checkpoint[];
}

/**
 * LOCK_WAIT checkpoint 생성 파라미터
 */
export interface LockWaitCheckpointParams {
  /** checkpoint 배열 (mutable) */
  checkpoints: Checkpoint[];
  /** 목표 edge ID (1-based) */
  targetEdgeId: number;
  /** 진입 edge ID (1-based) */
  incomingEdgeId: number;
  /** 진입 edge 객체 */
  incomingEdge: Edge;
  /** 진입 edge가 곡선인지 여부 */
  isCurveIncoming: boolean;
  /** path 배열에서 target의 인덱스 (1-based) */
  targetIdx: number;
  /** path 배열 (1-based, path[0]=length) */
  path: number[];
  /** edge 배열 (1-based, edges[0]=dummy) */
  edges: Edge[];
}
