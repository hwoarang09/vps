export const jobBatchConfig = {
  maxAssignmentsPerFrame: 5, // from JobBatchMgr MAX_ASSIGNMENTS_PER_FRAME
  defaultLoadDurationSec: 4, // from JobBatchMgr generateRandomOrders
  defaultUnloadDurationSec: 4, // from JobBatchMgr generateRandomOrders
};

export const getJobBatchConfig = () => jobBatchConfig;
