// FbLogger.ts
// FlatBuffers-based logger for performance comparison

import { Builder, ByteBuffer } from "flatbuffers";
import {
  LogBatch,
  LogEntry,
  LogLevel,
  LogContent,
  DebugLog,
  CheckpointLog,
  EdgeTransitionLog,
  LockEventLog,
  ErrorLog,
  PerfLog,
} from "@/generated/vps-dev-log";

// ============================================================================
// Types
// ============================================================================

export interface FbLoggerConfig {
  sessionId?: string;
  workerId?: number;
  bufferSize?: number; // Initial buffer size (bytes)
  flushInterval?: number; // Auto-flush interval (ms)
  loggerPort?: MessagePort; // Port to logger worker (optional)
}

export interface LogOptions {
  vehId?: number;
  tag?: string;
  location?: string;
}

// ============================================================================
// Helper functions
// ============================================================================

function isWorkerEnvironment(): boolean {
  return typeof window === "undefined" && typeof self !== "undefined";
}

// ============================================================================
// FbLogger Implementation
// ============================================================================

/**
 * FlatBuffers-based logger
 * - Detects environment (Main Thread vs Worker Thread)
 * - Worker Thread: Uses OPFS SyncAccessHandle directly
 * - Main Thread: Uses MessagePort to logger worker
 */
export class FbLogger {
  private config: {
    sessionId: string;
    workerId: number;
    bufferSize: number;
    flushInterval: number;
  };
  private builder: Builder;
  private entries: number[] = []; // Offsets of LogEntry
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private enabled = true;
  private loggerPort: MessagePort | null = null;

  // Worker environment OPFS (direct access)
  private isWorker = false;
  private opfsHandle: FileSystemSyncAccessHandle | null = null;
  private opfsOffset = 0;
  private opfsFileName = "";
  private initialized = false;

  constructor(config: FbLoggerConfig = {}) {
    this.config = {
      sessionId: config.sessionId ?? `fb_${Date.now()}`,
      workerId: config.workerId ?? 0,
      bufferSize: config.bufferSize ?? 1024 * 1024, // 1MB default
      flushInterval: config.flushInterval ?? 5000, // 5s default
    };

    this.loggerPort = config.loggerPort ?? null;
    this.isWorker = isWorkerEnvironment();
    this.builder = new Builder(this.config.bufferSize);
  }

  /**
   * Initialize logger (async for Worker environment OPFS)
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    if (this.isWorker) {
      await this.initWorkerOPFS();
    }

    // Auto-flush timer
    if (this.config.flushInterval > 0) {
      this.flushTimer = setInterval(() => {
        this.flush();
      }, this.config.flushInterval);
    }

    this.initialized = true;
  }

  /**
   * Initialize OPFS for Worker environment
   */
  private async initWorkerOPFS(): Promise<void> {
    try {
      const root = await navigator.storage.getDirectory();
      const logsDir = await root.getDirectoryHandle("dev_logs", { create: true });

      // 파일명: fb_YYYYMMDD_HHmmss.bin (DevLogger와 짝 맞춤)
      const now = new Date();
      const y = now.getFullYear();
      const mo = (now.getMonth() + 1).toString().padStart(2, "0");
      const d = now.getDate().toString().padStart(2, "0");
      const h = now.getHours().toString().padStart(2, "0");
      const mi = now.getMinutes().toString().padStart(2, "0");
      const s = now.getSeconds().toString().padStart(2, "0");
      this.opfsFileName = `fb_${y}${mo}${d}_${h}${mi}${s}.bin`;

      const fileHandle = await logsDir.getFileHandle(this.opfsFileName, { create: true });
      this.opfsHandle = await fileHandle.createSyncAccessHandle();
      this.opfsOffset = this.opfsHandle.getSize();

      console.log(`[FbLogger] Worker OPFS initialized: ${this.opfsFileName}`);
    } catch (err) {
      console.error("[FbLogger] OPFS init failed:", err);
    }
  }

  /**
   * Set logger port (for Main Thread)
   */
  setLoggerPort(port: MessagePort): void {
    this.loggerPort = port;
  }

  // ==========================================================================
  // Public API - High-level logging methods
  // ==========================================================================

  debug(message: string, opts: LogOptions = {}): void {
    this.log("DEBUG", message, opts);
  }

  info(message: string, opts: LogOptions = {}): void {
    this.log("INFO", message, opts);
  }

  warn(message: string, opts: LogOptions = {}): void {
    this.log("WARN", message, opts);
  }

  error(message: string, opts: LogOptions = {}): void {
    this.log("ERROR", message, opts);
  }

  /**
   * Log checkpoint processing
   */
  checkpoint(params: {
    vehId: number;
    cpIndex: number;
    edgeId: number;
    ratio: number;
    flags: number;
    action: string;
    details?: string;
    location?: string;
  }): void {
    if (!this.enabled) return;

    const { vehId, cpIndex, edgeId, ratio, flags, action, details, location } = params;

    // Build CheckpointLog
    const actionOffset = this.builder.createString(action);
    const detailsOffset = details ? this.builder.createString(details) : 0;

    CheckpointLog.startCheckpointLog(this.builder);
    CheckpointLog.addVehId(this.builder, vehId);
    CheckpointLog.addCpIndex(this.builder, cpIndex);
    CheckpointLog.addEdgeId(this.builder, edgeId);
    CheckpointLog.addRatio(this.builder, ratio);
    CheckpointLog.addFlags(this.builder, flags);
    CheckpointLog.addAction(this.builder, actionOffset);
    if (detailsOffset) {
      CheckpointLog.addDetails(this.builder, detailsOffset);
    }
    const contentOffset = CheckpointLog.endCheckpointLog(this.builder);

    this.addLogEntry(LogLevel.DEBUG, location ?? "unknown", LogContent.CheckpointLog, contentOffset);
  }

  /**
   * Log edge transition
   */
  edgeTransition(params: {
    vehId: number;
    fromEdge: number;
    toEdge: number;
    nextEdges: number[];
    pathBufLen: number;
    location?: string;
  }): void {
    if (!this.enabled) return;

    const { vehId, fromEdge, toEdge, nextEdges, pathBufLen, location } = params;

    // Build next_edges vector
    const nextEdgesVector = EdgeTransitionLog.createNextEdgesVector(this.builder, nextEdges);

    EdgeTransitionLog.startEdgeTransitionLog(this.builder);
    EdgeTransitionLog.addVehId(this.builder, vehId);
    EdgeTransitionLog.addFromEdge(this.builder, fromEdge);
    EdgeTransitionLog.addToEdge(this.builder, toEdge);
    EdgeTransitionLog.addNextEdges(this.builder, nextEdgesVector);
    EdgeTransitionLog.addPathBufLen(this.builder, pathBufLen);
    const contentOffset = EdgeTransitionLog.endEdgeTransitionLog(this.builder);

    this.addLogEntry(LogLevel.DEBUG, location ?? "unknown", LogContent.EdgeTransitionLog, contentOffset);
  }

  /**
   * Log lock event
   */
  lockEvent(params: {
    vehId: number;
    lockId: number;
    eventType: string;
    edgeId: number;
    waitTimeMs: number;
    location?: string;
  }): void {
    if (!this.enabled) return;

    const { vehId, lockId, eventType, edgeId, waitTimeMs, location } = params;

    const eventTypeOffset = this.builder.createString(eventType);

    LockEventLog.startLockEventLog(this.builder);
    LockEventLog.addVehId(this.builder, vehId);
    LockEventLog.addLockId(this.builder, lockId);
    LockEventLog.addEventType(this.builder, eventTypeOffset);
    LockEventLog.addEdgeId(this.builder, edgeId);
    LockEventLog.addWaitTimeMs(this.builder, waitTimeMs);
    const contentOffset = LockEventLog.endLockEventLog(this.builder);

    this.addLogEntry(LogLevel.INFO, location ?? "unknown", LogContent.LockEventLog, contentOffset);
  }

  /**
   * Log performance metrics
   */
  perf(params: { fps: number; memoryMb: number; activeVehicles: number; lockQueueSize: number }): void {
    if (!this.enabled) return;

    const { fps, memoryMb, activeVehicles, lockQueueSize } = params;

    PerfLog.startPerfLog(this.builder);
    PerfLog.addFps(this.builder, fps);
    PerfLog.addMemoryMb(this.builder, memoryMb);
    PerfLog.addActiveVehicles(this.builder, activeVehicles);
    PerfLog.addLockQueueSize(this.builder, lockQueueSize);
    const contentOffset = PerfLog.endPerfLog(this.builder);

    this.addLogEntry(LogLevel.INFO, "perf", LogContent.PerfLog, contentOffset);
  }

  // ==========================================================================
  // Private helpers
  // ==========================================================================

  private log(level: "DEBUG" | "INFO" | "WARN" | "ERROR", message: string, opts: LogOptions): void {
    if (!this.enabled) return;

    const vehId = opts.vehId ?? 0;
    const tag = opts.tag ?? "general";
    const location = opts.location ?? this.getCallSite();

    // Build DebugLog
    const tagOffset = this.builder.createString(tag);
    const messageOffset = this.builder.createString(message);

    DebugLog.startDebugLog(this.builder);
    DebugLog.addVehId(this.builder, vehId);
    DebugLog.addTag(this.builder, tagOffset);
    DebugLog.addMessage(this.builder, messageOffset);
    const contentOffset = DebugLog.endDebugLog(this.builder);

    const logLevel = LogLevel[level] as unknown as LogLevel;
    this.addLogEntry(logLevel, location, LogContent.DebugLog, contentOffset);
  }

  private addLogEntry(level: LogLevel, location: string, contentType: LogContent, contentOffset: number): void {
    const locationOffset = this.builder.createString(location);

    LogEntry.startLogEntry(this.builder);
    LogEntry.addTimestamp(this.builder, Date.now());
    LogEntry.addLevel(this.builder, level);
    LogEntry.addLocation(this.builder, locationOffset);
    LogEntry.addContentType(this.builder, contentType);
    LogEntry.addContent(this.builder, contentOffset);
    const entryOffset = LogEntry.endLogEntry(this.builder);

    this.entries.push(entryOffset);
  }

  private getCallSite(): string {
    const err = new Error();
    const stack = err.stack;
    if (!stack) return "unknown";

    const lines = stack.split("\n");

    // Skip FbLogger.ts internal lines
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];

      if (line.includes("FbLogger.ts") || line.includes("FbLogger.js")) {
        continue;
      }

      const match =
        line.match(/(?:at\s+)?(?:.*?\s+\()?([^()]+):(\d+):\d+\)?/) || line.match(/@(.+):(\d+):\d+/);

      if (match) {
        const filePath = match[1];
        const lineNum = match[2];

        let fileName = filePath.split("/").pop() || filePath;
        fileName = fileName.replace(/\?.*$/, "");
        return `${fileName}:${lineNum}`;
      }
    }

    return "unknown";
  }

  // ==========================================================================
  // Buffer management
  // ==========================================================================

  /**
   * Flush buffered logs to storage
   * - Worker environment: Write directly to OPFS
   * - Main Thread with port: Send to worker via MessagePort
   * - Otherwise: Return buffer for manual handling
   */
  flush(): ArrayBuffer | null {
    if (this.entries.length === 0) {
      return null;
    }

    // Build LogBatch
    const sessionIdOffset = this.builder.createString(this.config.sessionId);
    const logsVector = LogBatch.createLogsVector(this.builder, this.entries);

    LogBatch.startLogBatch(this.builder);
    LogBatch.addSessionId(this.builder, sessionIdOffset);
    LogBatch.addWorkerId(this.builder, this.config.workerId);
    LogBatch.addLogs(this.builder, logsVector);
    const batchOffset = LogBatch.endLogBatch(this.builder);

    this.builder.finish(batchOffset);

    // Get buffer
    const buffer = this.builder.asUint8Array().slice(); // Copy buffer

    // Worker environment: Write directly to OPFS
    if (this.isWorker && this.opfsHandle) {
      this.writeToOPFS(buffer);
    }
    // Main Thread with port: Send to worker
    else if (this.loggerPort) {
      this.loggerPort.postMessage({ type: "LOG", buffer: buffer.buffer }, [buffer.buffer]);
    }

    // Reset builder and entries
    this.builder.clear();
    this.entries = [];

    return buffer.buffer;
  }

  /**
   * Write buffer to OPFS (Worker environment only)
   */
  private writeToOPFS(buffer: Uint8Array): void {
    if (!this.opfsHandle) return;

    try {
      // Write length first (4 bytes)
      const lengthBuf = new ArrayBuffer(4);
      const lengthView = new DataView(lengthBuf);
      lengthView.setUint32(0, buffer.byteLength, true);

      this.opfsHandle.write(new Uint8Array(lengthBuf), { at: this.opfsOffset });
      this.opfsOffset += 4;

      // Write actual buffer
      this.opfsHandle.write(buffer, { at: this.opfsOffset });
      this.opfsOffset += buffer.byteLength;

      // Flush to disk
      this.opfsHandle.flush();

      console.log(`[FbLogger] Wrote ${buffer.byteLength} bytes to OPFS (total: ${this.opfsOffset})`);
    } catch (err) {
      console.error("[FbLogger] OPFS write error:", err);
    }
  }

  /**
   * Get current buffer size
   */
  getBufferSize(): number {
    return this.entries.length;
  }

  /**
   * Enable/disable logging
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Dispose logger
   */
  dispose(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush();

    // Close OPFS handle in Worker environment
    if (this.opfsHandle) {
      this.opfsHandle.close();
      this.opfsHandle = null;
      console.log(`[FbLogger] Closed OPFS handle: ${this.opfsFileName}`);
    }
  }
}

// ============================================================================
// Utility: Read LogBatch from buffer
// ============================================================================

export function readLogBatch(buffer: ArrayBuffer): LogBatch {
  const buf = new ByteBuffer(new Uint8Array(buffer));
  return LogBatch.getRootAsLogBatch(buf);
}
