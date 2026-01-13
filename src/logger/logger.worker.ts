// logger/logger.worker.ts
// 로그 수집 전용 워커 (OPFS / CLOUD 모드 지원)

/// <reference lib="webworker" />

import {
  LOG_RECORD_SIZE,
  CLOUD_UPLOAD_THRESHOLD,
  type LoggerWorkerMessage,
  type LoggerMainMessage,
  type LoggerMode,
  type LogFileInfo,
} from "./protocol";

// OPFS Sync Access Handle 타입 (Worker 환경에서만 사용 가능)
interface FileSystemSyncAccessHandle {
  read(buffer: ArrayBuffer | ArrayBufferView, options?: { at?: number }): number;
  write(buffer: ArrayBuffer | ArrayBufferView, options?: { at?: number }): number;
  truncate(size: number): void;
  getSize(): number;
  flush(): void;
  close(): void;
}

interface FileSystemFileHandleWithSync extends FileSystemFileHandle {
  createSyncAccessHandle(): Promise<FileSystemSyncAccessHandle>;
}

// ============================================================================
// State
// ============================================================================

let mode: LoggerMode = "OPFS";
let sessionId: string = "";
let totalRecords: number = 0;

// OPFS 모드
let opfsHandle: FileSystemSyncAccessHandle | null = null;
let opfsWriteOffset: number = 0;

// CLOUD 모드
let chunkList: ArrayBuffer[] = [];
let chunkTotalBytes: number = 0;

// ============================================================================
// Initialization
// ============================================================================

async function initOPFS(): Promise<void> {
  const root = await navigator.storage.getDirectory();
  const fileName = `edge_transit_${sessionId}.bin`;
  const fileHandle = await root.getFileHandle(fileName, { create: true }) as FileSystemFileHandleWithSync;
  opfsHandle = await fileHandle.createSyncAccessHandle();
  opfsWriteOffset = 0;
}

function initCloud(): void {
  chunkList = [];
  chunkTotalBytes = 0;
}

// ============================================================================
// Log Processing
// ============================================================================

function processLogOPFS(buffer: ArrayBuffer): void {
  if (!opfsHandle) return;

  const recordCount = buffer.byteLength / LOG_RECORD_SIZE;
  opfsHandle.write(new Uint8Array(buffer), { at: opfsWriteOffset });
  opfsWriteOffset += buffer.byteLength;
  totalRecords += recordCount;
}

function processLogCloud(buffer: ArrayBuffer): void {
  const recordCount = buffer.byteLength / LOG_RECORD_SIZE;
  chunkList.push(buffer);
  chunkTotalBytes += buffer.byteLength;
  totalRecords += recordCount;

  if (chunkTotalBytes >= CLOUD_UPLOAD_THRESHOLD) {
    uploadToCloud();
  }
}

async function uploadToCloud(): Promise<void> {
  if (chunkList.length === 0) return;

  const recordCount = chunkTotalBytes / LOG_RECORD_SIZE;

  // TODO: 실제 S3/R2 presigned URL로 업로드
  // 현재는 placeholder
  const url = `cloud://logs/${sessionId}/${Date.now()}.bin`;

  try {
    // const blob = new Blob(chunkList, { type: "application/octet-stream" });
    // const presignedUrl = await getPresignedUrl();
    // await fetch(presignedUrl, { method: "PUT", body: blob });

    postMainMessage({
      type: "UPLOADED",
      url,
      recordCount,
    });
  } catch (error) {
    postMainMessage({
      type: "ERROR",
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // 초기화
  chunkList = [];
  chunkTotalBytes = 0;
}

// ============================================================================
// Flush & Close
// ============================================================================

function flushOPFS(): void {
  if (!opfsHandle) return;
  opfsHandle.flush();
  postMainMessage({ type: "FLUSHED", recordCount: totalRecords });
}

function flushCloud(): void {
  if (chunkList.length > 0) {
    uploadToCloud();
  }
  postMainMessage({ type: "FLUSHED", recordCount: totalRecords });
}

function closeOPFS(): void {
  if (opfsHandle) {
    opfsHandle.flush();
    opfsHandle.close();
    opfsHandle = null;
  }
  postMainMessage({ type: "CLOSED", totalRecords });
}

function downloadOPFS(): void {
  if (!opfsHandle) {
    postMainMessage({ type: "ERROR", error: "OPFS handle not ready" });
    return;
  }

  // Flush first
  opfsHandle.flush();

  // Read entire file
  const fileSize = opfsHandle.getSize();
  const buffer = new ArrayBuffer(fileSize);
  const bytesRead = opfsHandle.read(new Uint8Array(buffer), { at: 0 });

  const fileName = `edge_transit_${sessionId}.bin`;
  const recordCount = bytesRead / LOG_RECORD_SIZE;

  postMainMessage({
    type: "DOWNLOADED",
    buffer,
    fileName,
    recordCount,
  });
}

function closeCloud(): void {
  if (chunkList.length > 0) {
    uploadToCloud();
  }
  postMainMessage({ type: "CLOSED", totalRecords });
}

// ============================================================================
// File Management (OPFS only)
// ============================================================================

async function listOPFSFiles(): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory();
    const files: LogFileInfo[] = [];

    // @ts-expect-error - entries() is available in OPFS
    for await (const [name, handle] of root.entries()) {
      if (name.startsWith("edge_transit_") && name.endsWith(".bin")) {
        if (handle.kind === "file") {
          const file = await (handle as FileSystemFileHandle).getFile();
          const size = file.size;
          const recordCount = Math.floor(size / LOG_RECORD_SIZE);
          
          // Extract timestamp from filename
          const match = /edge_transit_(\d+)/.exec(name);
          const createdAt = match ? Number.parseInt(match[1], 10) : file.lastModified;

          files.push({
            fileName: name,
            size,
            recordCount,
            createdAt,
          });
        }
      }
    }

    // Sort by creation time (newest first)
    files.sort((a, b) => b.createdAt - a.createdAt);

    postMainMessage({ type: "FILE_LIST", files });
  } catch (error) {
    postMainMessage({
      type: "ERROR",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function downloadOPFSFile(fileName: string): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory();
    const fileHandle = await root.getFileHandle(fileName, { create: false }) as FileSystemFileHandleWithSync;
    const accessHandle = await fileHandle.createSyncAccessHandle();

    const fileSize = accessHandle.getSize();
    const buffer = new ArrayBuffer(fileSize);
    const bytesRead = accessHandle.read(new Uint8Array(buffer), { at: 0 });
    const recordCount = bytesRead / LOG_RECORD_SIZE;

    accessHandle.close();

    postMainMessage({
      type: "DOWNLOADED",
      buffer,
      fileName,
      recordCount,
    });
  } catch (error) {
    postMainMessage({
      type: "ERROR",
      error: `Failed to download file: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

async function deleteOPFSFile(fileName: string): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(fileName);
    postMainMessage({ type: "FILE_DELETED", fileName });
  } catch (error) {
    postMainMessage({
      type: "ERROR",
      error: `Failed to delete file: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

// ============================================================================
// Message Handlers
// ============================================================================

function handleMessage(msg: LoggerWorkerMessage): void {
  switch (msg.type) {
    case "INIT":
      mode = msg.mode;
      sessionId = msg.sessionId ?? `session_${Date.now()}`;
      totalRecords = 0;

      if (mode === "OPFS") {
        initOPFS()
          .then(() => postMainMessage({ type: "READY" }))
          .catch((err) =>
            postMainMessage({
              type: "ERROR",
              error: err instanceof Error ? err.message : String(err),
            })
          );
      } else {
        initCloud();
        postMainMessage({ type: "READY" });
      }
      break;

    case "LOG":
      if (mode === "OPFS") {
        processLogOPFS(msg.buffer);
      } else {
        processLogCloud(msg.buffer);
      }
      break;

    case "FLUSH":
      if (mode === "OPFS") {
        flushOPFS();
      } else {
        flushCloud();
      }
      break;

    case "CLOSE":
      if (mode === "OPFS") {
        closeOPFS();
      } else {
        closeCloud();
      }
      break;

    case "DOWNLOAD":
      if (mode === "OPFS") {
        downloadOPFS();
      } else {
        postMainMessage({ type: "ERROR", error: "Download not supported in CLOUD mode" });
      }
      break;

    case "LIST_FILES":
      if (mode === "OPFS") {
        listOPFSFiles();
      } else {
        postMainMessage({ type: "ERROR", error: "File listing not supported in CLOUD mode" });
      }
      break;

    case "DOWNLOAD_FILE":
      if (mode === "OPFS") {
        downloadOPFSFile(msg.fileName);
      } else {
        postMainMessage({ type: "ERROR", error: "File download not supported in CLOUD mode" });
      }
      break;

    case "DELETE_FILE":
      if (mode === "OPFS") {
        deleteOPFSFile(msg.fileName);
      } else {
        postMainMessage({ type: "ERROR", error: "File deletion not supported in CLOUD mode" });
      }
      break;
  }
}

function postMainMessage(msg: LoggerMainMessage): void {
  globalThis.postMessage(msg);
}

// ============================================================================
// Entry Point
// ============================================================================

// 연결된 MessagePort들 (SimWorker에서 LOG 메시지를 받음)
const connectedPorts: MessagePort[] = [];

function handlePortMessage(e: MessageEvent): void {
  if (e.data.type === "LOG") {
    if (mode === "OPFS") {
      processLogOPFS(e.data.buffer);
    } else {
      processLogCloud(e.data.buffer);
    }
  }
}

globalThis.onmessage = (e: MessageEvent) => {
  // PORT 메시지: SimWorker와 연결할 MessagePort 수신
  if (e.data.type === "PORT" && e.data.port) {
    const port = e.data.port as MessagePort;
    port.onmessage = handlePortMessage;
    connectedPorts.push(port);
    return;
  }

  // 직접 LOG 메시지 (fallback)
  if (e.data.type === "LOG") {
    if (mode === "OPFS") {
      processLogOPFS(e.data.buffer);
    } else {
      processLogCloud(e.data.buffer);
    }
    return;
  }

  // 일반 메시지 (Main Thread에서)
  handleMessage(e.data as LoggerWorkerMessage);
};

// MessagePort 연결 처리
globalThis.onmessageerror = (e: MessageEvent) => {
  postMainMessage({
    type: "ERROR",
    error: `Message error: ${e.data}`,
  });
};
