// logger/index.ts
// SimLogger 기반 단일 로그 시스템

export { SimLogger, type SimLoggerConfig } from './SimLogger';
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
} from './simLogUtils';
