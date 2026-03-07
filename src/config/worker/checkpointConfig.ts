export const checkpointConfig = {
  maxCatchupPerFrame: 10, // from checkpoint-processor MAX_CATCHUP
  straightRequestDistance: 5.1, // from builder DEFAULT_OPTIONS
  curveRequestDistance: 1, // from builder DEFAULT_OPTIONS
  releaseRatio: 0.01, // from builder DEFAULT_OPTIONS
  defaultWaitingOffset: 1.89, // from builder DEFAULT_WAITING_OFFSET
};

export const getCheckpointConfig = () => checkpointConfig;
