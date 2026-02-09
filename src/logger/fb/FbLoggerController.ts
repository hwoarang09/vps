// FbLoggerController.ts
// FlatBuffers Logger Controller (Main Thread)

type FbWorkerMessage =
  | { type: "INIT"; sessionId: string; workerId: number }
  | { type: "LOG"; buffer: ArrayBuffer }
  | { type: "FLUSH" }
  | { type: "DOWNLOAD" }
  | { type: "CLEAR" };

type FbMainMessage =
  | { type: "READY" }
  | { type: "FLUSHED" }
  | { type: "DOWNLOADED"; buffer: ArrayBuffer; fileName: string }
  | { type: "CLEARED" }
  | { type: "ERROR"; error: string };

export interface FbLoggerControllerConfig {
  sessionId: string;
  workerId: number;
}

/**
 * FlatBuffers Logger Controller
 * - Main Thread에서 fb.worker.ts를 제어
 * - OPFS에 .bin 파일로 저장
 */
export class FbLoggerController {
  private worker: Worker | null = null;
  private sessionId: string;
  private workerId: number;
  private initialized = false;

  constructor(config: FbLoggerControllerConfig) {
    this.sessionId = config.sessionId;
    this.workerId = config.workerId;
  }

  /**
   * Worker 초기화
   */
  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.worker = new Worker(new URL("./fb.worker.ts", import.meta.url), {
        type: "module",
      });

      const timeout = setTimeout(() => {
        reject(new Error("FbLoggerController init timeout"));
      }, 5000);

      this.worker.onmessage = (e: MessageEvent<FbMainMessage>) => {
        const msg = e.data;

        if (msg.type === "READY") {
          clearTimeout(timeout);
          this.initialized = true;
          console.log(`[FbLoggerController] Ready (session: ${this.sessionId}, worker: ${this.workerId})`);
          resolve();
        } else if (msg.type === "ERROR") {
          clearTimeout(timeout);
          reject(new Error(msg.error));
        }
      };

      this.worker.onerror = (err) => {
        clearTimeout(timeout);
        reject(err);
      };

      // INIT 메시지 전송
      this.worker.postMessage({
        type: "INIT",
        sessionId: this.sessionId,
        workerId: this.workerId,
      } as FbWorkerMessage);
    });
  }

  /**
   * 로그 버퍼 전송
   */
  log(buffer: ArrayBuffer): void {
    if (!this.initialized || !this.worker) {
      console.warn("[FbLoggerController] Not initialized, skipping log");
      return;
    }

    // Transfer buffer (zero-copy)
    this.worker.postMessage(
      { type: "LOG", buffer } as FbWorkerMessage,
      [buffer]
    );
  }

  /**
   * Flush
   */
  async flush(): Promise<void> {
    if (!this.initialized || !this.worker) {
      return;
    }

    return new Promise((resolve) => {
      const handler = (e: MessageEvent<FbMainMessage>) => {
        if (e.data.type === "FLUSHED") {
          this.worker?.removeEventListener("message", handler);
          resolve();
        }
      };

      this.worker?.addEventListener("message", handler);
      this.worker?.postMessage({ type: "FLUSH" } as FbWorkerMessage);
    });
  }

  /**
   * 다운로드
   */
  async download(): Promise<{ buffer: ArrayBuffer; fileName: string }> {
    if (!this.initialized || !this.worker) {
      throw new Error("Not initialized");
    }

    return new Promise((resolve, reject) => {
      const handler = (e: MessageEvent<FbMainMessage>) => {
        const msg = e.data;
        if (msg.type === "DOWNLOADED") {
          this.worker?.removeEventListener("message", handler);
          resolve({ buffer: msg.buffer, fileName: msg.fileName });
        } else if (msg.type === "ERROR") {
          this.worker?.removeEventListener("message", handler);
          reject(new Error(msg.error));
        }
      };

      this.worker?.addEventListener("message", handler);
      this.worker?.postMessage({ type: "DOWNLOAD" } as FbWorkerMessage);
    });
  }

  /**
   * 모든 로그 삭제
   */
  async clear(): Promise<void> {
    if (!this.initialized || !this.worker) {
      return;
    }

    return new Promise((resolve) => {
      const handler = (e: MessageEvent<FbMainMessage>) => {
        if (e.data.type === "CLEARED") {
          this.worker?.removeEventListener("message", handler);
          resolve();
        }
      };

      this.worker?.addEventListener("message", handler);
      this.worker?.postMessage({ type: "CLEAR" } as FbWorkerMessage);
    });
  }

  /**
   * Worker 종료
   */
  dispose(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      this.initialized = false;
      console.log("[FbLoggerController] Disposed");
    }
  }
}

export interface FbLogFileInfo {
  fileName: string;
  size: number;
  createdAt: number;
}

/**
 * OPFS에서 FbLog 파일 목록 조회 (파일 크기, 생성 시간 포함)
 */
export async function listFbLogFiles(): Promise<FbLogFileInfo[]> {
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle("dev_logs", { create: false });

    const files: FbLogFileInfo[] = [];
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind === "file" && name.startsWith("fb_") && name.endsWith(".bin")) {
        const file = await (handle as FileSystemFileHandle).getFile();
        // 파일명에서 타임스탬프 추출 (fb_YYYYMMDD_HHmmss.bin)
        const match = name.match(/fb_(\d{8}_\d{6})/);
        let createdAt = file.lastModified;
        if (match) {
          const dateStr = match[1]; // YYYYMMDD_HHmmss
          const parsed = new Date(
            `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}T${dateStr.slice(9, 11)}:${dateStr.slice(11, 13)}:${dateStr.slice(13, 15)}`
          );
          if (!isNaN(parsed.getTime())) {
            createdAt = parsed.getTime();
          }
        }
        files.push({ fileName: name, size: file.size, createdAt });
      }
    }

    // 최신 파일 먼저
    files.sort((a, b) => b.createdAt - a.createdAt);
    return files;
  } catch {
    return [];
  }
}

/**
 * OPFS 파일 다운로드
 */
export async function downloadFbLogFile(fileName: string): Promise<ArrayBuffer> {
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle("dev_logs", { create: false });
  const fileHandle = await dir.getFileHandle(fileName);
  const file = await fileHandle.getFile();
  return file.arrayBuffer();
}

/**
 * OPFS 파일 삭제
 * @returns true if deleted, false if failed
 */
export async function deleteFbLogFile(fileName: string): Promise<boolean> {
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle("dev_logs", { create: false });
    await dir.removeEntry(fileName);
    return true;
  } catch {
    return false;
  }
}

export interface FbDeleteResult {
  deleted: string[];
  failed: string[];
}

/**
 * 여러 FbLog 파일 삭제
 */
export async function deleteFbLogFiles(fileNames: string[]): Promise<FbDeleteResult> {
  const deleted: string[] = [];
  const failed: string[] = [];

  for (const fileName of fileNames) {
    const success = await deleteFbLogFile(fileName);
    if (success) {
      deleted.push(fileName);
    } else {
      failed.push(fileName);
    }
  }

  return { deleted, failed };
}

/**
 * 모든 FbLog 파일 삭제
 */
export async function clearAllFbLogs(): Promise<FbDeleteResult> {
  const deleted: string[] = [];
  const failed: string[] = [];

  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle("dev_logs", { create: false });

    const files: string[] = [];
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind === "file" && name.startsWith("fb_") && name.endsWith(".bin")) {
        files.push(name);
      }
    }

    for (const name of files) {
      try {
        await dir.removeEntry(name);
        deleted.push(name);
      } catch {
        failed.push(name);
      }
    }
  } catch {
    // 디렉토리가 없음
  }

  return { deleted, failed };
}
