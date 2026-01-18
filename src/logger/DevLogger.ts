// DevLogger.ts
// 개발용 텍스트 로그 시스템 - OPFS 저장, 파일:라인 포함
// 메인 스레드: global과 veh별로 파일 분리
// Worker 환경: 단일 파일

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

interface LogEntry {
  time: string;
  level: LogLevel;
  vehId: number | null;
  location: string;
  message: string;
}

interface BufferEntry {
  vehId: number | null;
  text: string;
}

// 호출 위치 (파일명:라인) 추출
// DevLogger.ts 내부가 아닌 실제 호출 위치를 찾음
function getCallSite(): string {
  const err = new Error();
  const stack = err.stack;
  if (!stack) return "unknown";

  const lines = stack.split("\n");

  // DevLogger.ts가 아닌 첫 번째 외부 파일을 찾음
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];

    // DevLogger.ts 관련 라인은 스킵
    if (line.includes("DevLogger.ts") || line.includes("DevLogger.js")) {
      continue;
    }

    // 파일:라인 정보 추출
    const match =
      line.match(/(?:at\s+)?(?:.*?\s+\()?([^()]+):(\d+):\d+\)?/) ||
      line.match(/@(.+):(\d+):\d+/);

    if (match) {
      const filePath = match[1];
      const lineNum = match[2];

      // 파일 경로에서 파일명만 추출
      let fileName = filePath.split("/").pop() || filePath;
      // Vite HMR 타임스탬프 제거 (?t=1234567890)
      fileName = fileName.replace(/\?.*$/, "");
      return `${fileName}:${lineNum}`;
    }
  }

  return "unknown";
}

// 시간 포맷: HH:MM:SS.mmm
function formatTime(date: Date): string {
  const h = date.getHours().toString().padStart(2, "0");
  const m = date.getMinutes().toString().padStart(2, "0");
  const s = date.getSeconds().toString().padStart(2, "0");
  const ms = date.getMilliseconds().toString().padStart(3, "0");
  return `${h}:${m}:${s}.${ms}`;
}

// 로그 엔트리를 문자열로 변환
function formatEntry(entry: LogEntry): string {
  const vehPart = entry.vehId !== null ? `[veh:${entry.vehId}]` : "[global]";
  return `[${entry.time}] [${entry.level.padEnd(5)}] ${vehPart} [${entry.location}] ${entry.message}\n`;
}

type DevLoggerWorkerMessage =
  | { type: "INIT"; sessionId: string }
  | { type: "LOG"; entries: BufferEntry[] }
  | { type: "FLUSH" }
  | { type: "DOWNLOAD"; vehId?: number }
  | { type: "CLEAR" };

type DevLoggerMainMessage =
  | { type: "READY" }
  | { type: "FLUSHED" }
  | { type: "DOWNLOADED"; buffer: ArrayBuffer; fileName: string }
  | { type: "CLEARED" }
  | { type: "ERROR"; error: string };

const encoder = new TextEncoder();

// Worker 환경 감지
function isWorkerEnvironment(): boolean {
  return typeof window === "undefined" && typeof self !== "undefined";
}

class DevLoggerImpl {
  private worker: Worker | null = null;
  private buffer: BufferEntry[] = [];
  private flushInterval: ReturnType<typeof setInterval> | null = null;
  private sessionId: string;
  private initialized = false;
  private enabled = true;

  // Worker 환경용 동기식 OPFS 핸들 (veh별 분리)
  private opfsGlobalHandle: FileSystemSyncAccessHandle | null = null;
  private opfsGlobalOffset = 0;
  private opfsVehHandles = new Map<number, { handle: FileSystemSyncAccessHandle; offset: number }>();
  private opfsLogsDir: FileSystemDirectoryHandle | null = null;
  private isWorker = false;
  private workerId = "";

  constructor() {
    this.sessionId = `dev_${Date.now()}`;
    this.isWorker = isWorkerEnvironment();
  }

  async init(workerId?: string): Promise<void> {
    if (this.initialized) return;

    if (this.isWorker) {
      // Worker 환경 - 직접 OPFS 동기식 접근 (단일 파일)
      await this.initWorkerOPFS(workerId);
    } else {
      // 메인 스레드 - Worker 생성 (veh별 파일 분리)
      await this.initMainThread();
    }
  }

  private async initWorkerOPFS(workerId?: string): Promise<void> {
    this.workerId = workerId || `sim_${Date.now()}`;

    try {
      const root = await navigator.storage.getDirectory();
      this.opfsLogsDir = await root.getDirectoryHandle("dev_logs", { create: true });

      // global 파일 생성
      const globalFileName = `${this.workerId}_global.txt`;
      const globalFileHandle = await this.opfsLogsDir.getFileHandle(globalFileName, { create: true });
      this.opfsGlobalHandle = await globalFileHandle.createSyncAccessHandle();
      this.opfsGlobalOffset = this.opfsGlobalHandle.getSize();

      // 세션 시작 헤더
      const header = `\n${"=".repeat(60)}\n[GLOBAL] ${new Date().toISOString()}\n${"=".repeat(60)}\n`;
      const headerBytes = encoder.encode(header);
      this.opfsGlobalHandle.write(headerBytes, { at: this.opfsGlobalOffset });
      this.opfsGlobalOffset += headerBytes.byteLength;
      this.opfsGlobalHandle.flush();

      this.initialized = true;
    } catch {
      // OPFS 실패시 콘솔 폴백
      this.initialized = true;
    }
  }

  private async ensureVehHandle(vehId: number): Promise<{ handle: FileSystemSyncAccessHandle; offset: number } | null> {
    const existing = this.opfsVehHandles.get(vehId);
    if (existing) return existing;

    if (!this.opfsLogsDir) return null;

    try {
      const fileName = `${this.workerId}_veh${vehId}.txt`;
      const fileHandle = await this.opfsLogsDir.getFileHandle(fileName, { create: true });
      const handle = await fileHandle.createSyncAccessHandle();
      let offset = handle.getSize();

      // 세션 시작 헤더
      const header = `\n${"=".repeat(60)}\n[VEH ${vehId}] ${new Date().toISOString()}\n${"=".repeat(60)}\n`;
      const headerBytes = encoder.encode(header);
      handle.write(headerBytes, { at: offset });
      offset += headerBytes.byteLength;
      handle.flush();

      const entry = { handle, offset };
      this.opfsVehHandles.set(vehId, entry);
      return entry;
    } catch {
      return null;
    }
  }

  private async initMainThread(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.worker = new Worker(
          new URL("./dev-logger.worker.ts", import.meta.url),
          { type: "module" }
        );

        this.worker.onmessage = (e: MessageEvent<DevLoggerMainMessage>) => {
          if (e.data.type === "READY") {
            this.initialized = true;
            // 1초마다 flush
            this.flushInterval = setInterval(() => this.flush(), 1000);
            resolve();
          } else if (e.data.type === "ERROR") {
            reject(new Error(e.data.error));
          }
        };

        this.worker.onerror = (e) => {
          reject(new Error(e.message));
        };

        const msg: DevLoggerWorkerMessage = {
          type: "INIT",
          sessionId: this.sessionId,
        };
        this.worker.postMessage(msg);
      } catch {
        // Worker 생성 실패시 콘솔 폴백
        this.initialized = true;
        resolve();
      }
    });
  }

  private log(level: LogLevel, vehId: number | null, message: string): void {
    if (!this.enabled) return;

    const entry: LogEntry = {
      time: formatTime(new Date()),
      level,
      vehId,
      location: getCallSite(),
      message,
    };

    const text = formatEntry(entry);

    if (this.isWorker) {
      // Worker 환경 - veh별 파일 분리
      const bytes = encoder.encode(text);

      if (vehId === null) {
        // global 로그
        if (this.opfsGlobalHandle) {
          this.opfsGlobalHandle.write(bytes, { at: this.opfsGlobalOffset });
          this.opfsGlobalOffset += bytes.byteLength;
        }
      } else {
        // veh별 로그
        const vehEntry = this.opfsVehHandles.get(vehId);
        if (vehEntry) {
          vehEntry.handle.write(bytes, { at: vehEntry.offset });
          vehEntry.offset += bytes.byteLength;
        } else {
          // 핸들이 없으면 비동기로 생성
          this.ensureVehHandle(vehId).then((entry) => {
            if (entry) {
              entry.handle.write(bytes, { at: entry.offset });
              entry.offset += bytes.byteLength;
            }
          });
        }
      }
    } else if (this.worker && this.initialized) {
      // 메인 스레드 - 버퍼에 쌓고 Worker로 전송
      this.buffer.push({ vehId, text });
      if (this.buffer.length >= 100) {
        this.flush();
      }
    } else {
      // 폴백 - 콘솔 출력
      const consoleMethod = level === "ERROR" ? console.error :
                           level === "WARN" ? console.warn : console.log;
      consoleMethod(text.trim());
    }
  }

  flush(): void {
    if (this.isWorker) {
      // Worker 환경 - 모든 핸들 flush
      this.opfsGlobalHandle?.flush();
      for (const entry of this.opfsVehHandles.values()) {
        entry.handle.flush();
      }
    } else if (this.worker && this.buffer.length > 0) {
      // 메인 스레드 - Worker로 전송
      const entries = this.buffer;
      this.buffer = [];
      const msg: DevLoggerWorkerMessage = { type: "LOG", entries };
      this.worker.postMessage(msg);
    }
  }

  // 전역 로그
  debug(message: string): void {
    this.log("DEBUG", null, message);
  }

  info(message: string): void {
    this.log("INFO", null, message);
  }

  warn(message: string): void {
    this.log("WARN", null, message);
  }

  error(message: string): void {
    this.log("ERROR", null, message);
  }

  // veh별 로그
  vehDebug(vehId: number, message: string): void {
    this.log("DEBUG", vehId, message);
  }

  vehInfo(vehId: number, message: string): void {
    this.log("INFO", vehId, message);
  }

  vehWarn(vehId: number, message: string): void {
    this.log("WARN", vehId, message);
  }

  vehError(vehId: number, message: string): void {
    this.log("ERROR", vehId, message);
  }

  async download(): Promise<void> {
    if (!this.worker) return;

    this.flush();

    return new Promise((resolve) => {
      const handler = (e: MessageEvent<DevLoggerMainMessage>) => {
        if (e.data.type === "DOWNLOADED") {
          const blob = new Blob([e.data.buffer], { type: "text/plain" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = e.data.fileName;
          a.click();
          URL.revokeObjectURL(url);
          this.worker!.removeEventListener("message", handler);
          resolve();
        }
      };
      this.worker!.addEventListener("message", handler);

      const msg: DevLoggerWorkerMessage = { type: "DOWNLOAD" };
      this.worker!.postMessage(msg);
    });
  }

  async clear(): Promise<void> {
    if (!this.worker) return;

    return new Promise((resolve) => {
      const handler = (e: MessageEvent<DevLoggerMainMessage>) => {
        if (e.data.type === "CLEARED") {
          this.worker!.removeEventListener("message", handler);
          resolve();
        }
      };
      this.worker!.addEventListener("message", handler);

      const msg: DevLoggerWorkerMessage = { type: "CLEAR" };
      this.worker!.postMessage(msg);
    });
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  dispose(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
    this.flush();

    if (this.isWorker) {
      // 모든 핸들 닫기
      if (this.opfsGlobalHandle) {
        this.opfsGlobalHandle.close();
        this.opfsGlobalHandle = null;
      }
      for (const entry of this.opfsVehHandles.values()) {
        entry.handle.close();
      }
      this.opfsVehHandles.clear();
    }

    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }

    this.initialized = false;
  }
}

// 싱글톤 인스턴스
export const DevLogger = new DevLoggerImpl();

// 편의 함수들 (import 후 바로 사용)
export const devLog = {
  debug: (msg: string) => DevLogger.debug(msg),
  info: (msg: string) => DevLogger.info(msg),
  warn: (msg: string) => DevLogger.warn(msg),
  error: (msg: string) => DevLogger.error(msg),
  veh: (vehId: number) => ({
    debug: (msg: string) => DevLogger.vehDebug(vehId, msg),
    info: (msg: string) => DevLogger.vehInfo(vehId, msg),
    warn: (msg: string) => DevLogger.vehWarn(vehId, msg),
    error: (msg: string) => DevLogger.vehError(vehId, msg),
  }),
};
