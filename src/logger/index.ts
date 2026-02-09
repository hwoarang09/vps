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
export { DevLogger, devLog, type LogLevel } from "./DevLogger";
export {
  listDevLogFiles,
  downloadDevLogFile,
  downloadMergedDevLogs,
  downloadAllDevLogs,
  deleteDevLogFile,
  deleteDevLogFiles,
  clearAllDevLogs,
  type DevLogFileInfo,
  type DeleteResult,
} from "./devLogUtils";

// FlatBuffers Logger
export { FbLogger, readLogBatch, type FbLoggerConfig } from "./fb/FbLogger";
export {
  FbLoggerController,
  listFbLogFiles,
  downloadFbLogFile,
  deleteFbLogFile,
  deleteFbLogFiles,
  clearAllFbLogs,
  type FbLoggerControllerConfig,
  type FbLogFileInfo,
  type FbDeleteResult,
} from "./fb/FbLoggerController";

// Global FbLogger instance (for Worker Thread)
import { FbLogger } from "./fb/FbLogger";

let globalFbLogger: FbLogger | null = null;

/**
 * Initialize global FbLogger (for Worker Thread)
 */
export function initFbLog(config: { sessionId: string; workerId: number; loggerPort?: MessagePort }): FbLogger {
  globalFbLogger = new FbLogger(config);
  if (config.loggerPort) {
    globalFbLogger.setLoggerPort(config.loggerPort);
  }
  return globalFbLogger;
}

/**
 * Get global FbLogger instance
 */
export function getFbLog(): FbLogger | null {
  return globalFbLogger;
}
