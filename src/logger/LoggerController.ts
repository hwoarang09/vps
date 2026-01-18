// logger/LoggerController.ts
// Main Thread에서 Logger Worker를 관리하는 컨트롤러

import type {
  LoggerMode,
  LoggerWorkerMessage,
  LoggerMainMessage,
} from "./protocol";

export interface LoggerControllerConfig {
  mode: LoggerMode;
  sessionId?: string;
  onReady?: () => void;
  onFlushed?: (recordCount: number) => void;
  onUploaded?: (url: string, recordCount: number) => void;
  onClosed?: (totalRecords: number) => void;
  onError?: (error: string) => void;
}

/**
 * Logger Worker 관리 컨트롤러
 *
 * 사용법:
 * 1. LoggerController 생성 및 init()
 * 2. createPortForWorker()로 SimWorker에게 전달할 MessagePort 생성
 * 3. SimWorker에서 LogBuffer.setLoggerPort(port)로 연결
 * 4. 종료 시 close()
 */
export class LoggerController {
  private worker: Worker | null = null;
  private readonly config: LoggerControllerConfig;
  private isReady: boolean = false;

  constructor(config: LoggerControllerConfig) {
    this.config = config;
  }

  /**
   * Logger Worker 초기화
   */
  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.worker = new Worker(
        new URL("./logger.worker.ts", import.meta.url),
        { type: "module" }
      );

      this.worker.onmessage = (e: MessageEvent<LoggerMainMessage>) => {
        this.handleWorkerMessage(e.data);
        if (e.data.type === "READY") {
          this.isReady = true;
          resolve();
        } else if (e.data.type === "ERROR" && !this.isReady) {
          reject(new Error(e.data.error));
        }
      };

      this.worker.onerror = (error) => {
        const errorMsg = error.message;
        this.config.onError?.(errorMsg);
        if (!this.isReady) {
          reject(new Error(errorMsg));
        }
      };

      const initMsg: LoggerWorkerMessage = {
        type: "INIT",
        mode: this.config.mode,
        sessionId: this.config.sessionId,
      };
      this.worker.postMessage(initMsg);
    });
  }

  /**
   * SimWorker에게 전달할 MessagePort 생성
   *
   * @returns MessagePort (SimWorker의 LogBuffer.setLoggerPort()에 전달)
   */
  createPortForWorker(): MessagePort {
    if (!this.worker) {
      throw new Error("Logger worker not initialized");
    }

    const channel = new MessageChannel();

    // port1은 Logger Worker에게 전달
    this.worker.postMessage({ type: "PORT", port: channel.port1 }, [
      channel.port1,
    ]);

    // port2를 반환 (SimWorker에게 전달)
    return channel.port2;
  }

  /**
   * 버퍼 플러시 요청
   */
  flush(): void {
    if (!this.worker) return;
    const msg: LoggerWorkerMessage = { type: "FLUSH" };
    this.worker.postMessage(msg);
  }

  /**
   * Logger Worker 종료
   */
  async close(): Promise<number> {
    return new Promise((resolve) => {
      if (!this.worker) {
        resolve(0);
        return;
      }

      const originalOnClosed = this.config.onClosed;
      this.config.onClosed = (totalRecords) => {
        originalOnClosed?.(totalRecords);
        this.worker?.terminate();
        this.worker = null;
        resolve(totalRecords);
      };

      const msg: LoggerWorkerMessage = { type: "CLOSE" };
      this.worker.postMessage(msg);
    });
  }

  private handleWorkerMessage(msg: LoggerMainMessage): void {
    switch (msg.type) {
      case "READY":
        this.config.onReady?.();
        break;
      case "FLUSHED":
        this.config.onFlushed?.(msg.recordCount);
        break;
      case "UPLOADED":
        this.config.onUploaded?.(msg.url, msg.recordCount);
        break;
      case "CLOSED":
        this.config.onClosed?.(msg.totalRecords);
        break;
      case "ERROR":
        this.config.onError?.(msg.error);
        break;
    }
  }

  /**
   * Logger가 준비되었는지 확인
   */
  getIsReady(): boolean {
    return this.isReady;
  }

  /**
   * 현재 로그 파일 다운로드
   * Logger Worker에서 파일을 읽어서 반환
   */
  async download(): Promise<{ buffer: ArrayBuffer; fileName: string; recordCount: number }> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error("Logger worker not initialized"));
        return;
      }

      const onMessage = (e: MessageEvent<LoggerMainMessage>) => {
        if (e.data.type === "DOWNLOADED") {
          this.worker?.removeEventListener("message", onMessage);
          resolve({
            buffer: e.data.buffer,
            fileName: e.data.fileName,
            recordCount: e.data.recordCount,
          });
        } else if (e.data.type === "ERROR") {
          this.worker?.removeEventListener("message", onMessage);
          reject(new Error(e.data.error));
        }
      };

      this.worker.addEventListener("message", onMessage);
      this.worker.postMessage({ type: "DOWNLOAD" });
    });
  }

  /**
   * OPFS에 저장된 로그 파일 목록 조회
   */
  async listFiles(): Promise<import("./protocol").LogFileInfo[]> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error("Logger worker not initialized"));
        return;
      }

      const onMessage = (e: MessageEvent<LoggerMainMessage>) => {
        if (e.data.type === "FILE_LIST") {
          this.worker?.removeEventListener("message", onMessage);
          resolve(e.data.files);
        } else if (e.data.type === "ERROR") {
          this.worker?.removeEventListener("message", onMessage);
          reject(new Error(e.data.error));
        }
      };

      this.worker.addEventListener("message", onMessage);
      this.worker.postMessage({ type: "LIST_FILES" });
    });
  }

  /**
   * 특정 로그 파일 다운로드
   */
  async downloadFile(fileName: string): Promise<{ buffer: ArrayBuffer; fileName: string; recordCount: number }> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error("Logger worker not initialized"));
        return;
      }

      const onMessage = (e: MessageEvent<LoggerMainMessage>) => {
        if (e.data.type === "DOWNLOADED") {
          this.worker?.removeEventListener("message", onMessage);
          resolve({
            buffer: e.data.buffer,
            fileName: e.data.fileName,
            recordCount: e.data.recordCount,
          });
        } else if (e.data.type === "ERROR") {
          this.worker?.removeEventListener("message", onMessage);
          reject(new Error(e.data.error));
        }
      };

      this.worker.addEventListener("message", onMessage);
      this.worker.postMessage({ type: "DOWNLOAD_FILE", fileName });
    });
  }

  /**
   * 특정 로그 파일 삭제
   */
  async deleteFile(fileName: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error("Logger worker not initialized"));
        return;
      }

      const onMessage = (e: MessageEvent<LoggerMainMessage>) => {
        if (e.data.type === "FILE_DELETED") {
          this.worker?.removeEventListener("message", onMessage);
          resolve();
        } else if (e.data.type === "ERROR") {
          this.worker?.removeEventListener("message", onMessage);
          reject(new Error(e.data.error));
        }
      };

      this.worker.addEventListener("message", onMessage);
      this.worker.postMessage({ type: "DELETE_FILE", fileName });
    });
  }

  /**
   * 모든 로그 파일 삭제
   */
  async deleteAllFiles(): Promise<number> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error("Logger worker not initialized"));
        return;
      }

      const onMessage = (e: MessageEvent<LoggerMainMessage>) => {
        if (e.data.type === "ALL_FILES_DELETED") {
          this.worker?.removeEventListener("message", onMessage);
          resolve(e.data.deletedCount);
        } else if (e.data.type === "ERROR") {
          this.worker?.removeEventListener("message", onMessage);
          reject(new Error(e.data.error));
        }
      };

      this.worker.addEventListener("message", onMessage);
      this.worker.postMessage({ type: "DELETE_ALL_FILES" });
    });
  }
}
