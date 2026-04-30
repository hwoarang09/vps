// logger/index.ts
// SimLogger 기반 단일 로그 시스템

export {
  SimLogger,
  type SimLoggerConfig,
  type LogTargets,
  type LogEvents,
  type LogOrderCompleteParams,
  type LogVehStateParams,
  type LogReplaySnapshotParams,
  type LogCheckpointParams,
} from './SimLogger';
export { DbShipper } from './DbShipper';
export {
  EventType,
  RECORD_SIZE,
  FLUSH_THRESHOLD,
  ML_EVENT_TYPES,
  ALL_EVENT_TYPES,
  getFileName,
  getFileSuffix,
  type SimLogFileInfo,
} from './protocol';
export {
  listSimLogFiles,
  downloadSimLogFile,
  deleteSimLogFile,
  clearAllSimLogs,
  extractSessionId,
  extractFabId,
} from './simLogUtils';
