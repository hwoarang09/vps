export const orderConfig = {
  maxPathFindsPerFrame: 10, // from OrderMgr MAX_PATH_FINDS_PER_FRAME
  maxStationAttempts: 5, // from OrderMgr MAX_ATTEMPTS
  pathEndTargetRatio: 0.5, // from OrderMgr constructPathCommand targetRatio
};

export const getOrderConfig = () => orderConfig;
