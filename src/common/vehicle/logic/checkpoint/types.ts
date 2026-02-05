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
}

/**
 * Merge checkpoint 생성 옵션
 */
export interface MergeCheckpointOptions {
  /** Lock 요청 거리 (m) - 직선 */
  requestDistanceLinear: number;
  /** Lock 대기 거리 (m) - 직선 */
  waitDistanceLinear: number;
  /** Lock 요청 거리 (m) - 곡선 */
  requestDistanceCurve: number;
  /** Lock 대기 거리 (m) - 곡선 */
  waitDistanceCurve: number;
  /** Lock 해제 ratio - 다음 edge */
  releaseRatio: number;
}

/**
 * Curve checkpoint 생성 옵션
 */
export interface CurveCheckpointOptions {
  /** 감속 시작 ratio */
  slowRatio: number;
  /** 준비 시작 ratio */
  prepareRatio: number;
}

/**
 * Checkpoint 생성 결과
 */
export interface CheckpointBuildResult {
  /** 생성된 checkpoint 리스트 */
  checkpoints: Checkpoint[];
  /** 총 개수 */
  count: number;
  /** 경고 메시지 (최대 개수 초과 등) */
  warnings?: string[];
}
