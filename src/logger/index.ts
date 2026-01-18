// logger/index.ts
// Edge Transit Logger 모듈

export { LogBuffer, type LogBufferConfig } from "./LogBuffer";
export { LoggerController, type LoggerControllerConfig } from "./LoggerController";
export { EdgeTransitTracker } from "./EdgeTransitTracker";
export {
  // Constants
  LOG_RECORD_SIZE,
  LOG_BUFFER_SIZE,
  MAX_RECORDS_PER_BUFFER,
  CLOUD_UPLOAD_THRESHOLD,
  OFFSET,
  EDGE_TYPE_MAP,
  EDGE_TYPE_REVERSE,
  // Types
  type EdgeTransitRecord,
  type LoggerMode,
  type LoggerWorkerMessage,
  type LoggerMainMessage,
  // Utils
  packRecord,
  unpackRecord,
  unpackAllRecords,
} from "./protocol";
export {
  downloadLogFromOPFS,
  listLogFiles,
  deleteLogFile,
  downloadLogFile,
  clearAllLogs,
} from "./downloadLog";
