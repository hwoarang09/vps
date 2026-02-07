// common/vehicle/logic/checkpoint/index.ts
// Checkpoint 모듈 메인 export

export * from "./types";
export * from "./utils";
export * from "./builder";

import type { Edge } from "@/types/edge";
import type { Checkpoint } from "@/common/vehicle/initialize/constants";
import { buildCheckpoints } from "./builder";

/**
 * TransferMgr에서 사용하는 간소화된 wrapper 함수
 */
export function buildCheckpointsFromPath(params: {
  edgeIndices: number[];
  edgeArray: Edge[];
  isMergeNode: (nodeName: string) => boolean;
  isDeadLockMergeNode?: (nodeName: string) => boolean;
}): {
  checkpoints: Checkpoint[];
  warnings?: string[];
} {
  const { edgeIndices, edgeArray, isMergeNode, isDeadLockMergeNode } = params;

  const result = buildCheckpoints(
    {
      edgeIndices,
      edgeArray,
      isMergeNode,
      isDeadLockMergeNode: isDeadLockMergeNode || (() => false),
    },
    {}  // default lock options
  );

  return {
    checkpoints: result.checkpoints,
  };
}
