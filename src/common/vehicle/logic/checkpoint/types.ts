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
  /** Lock 요청 거리 (m) - 파라미터로 설정 (예: 5100 or 1000) */
  requestDistance: number;
  /** Lock 해제 ratio - 다음 edge (기본값: 0.2) */
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
