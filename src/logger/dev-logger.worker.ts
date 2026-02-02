// dev-logger.worker.ts
// 개발용 로그를 OPFS에 저장하는 워커
// 모든 로그를 단일 파일에 저장 (파일명: YYYYMMDD_HHmmss.txt)

type LogEntry = {
  vehId: number | null;
  text: string;
};

type DevLoggerWorkerMessage =
  | { type: "INIT"; sessionId: string }
  | { type: "LOG"; entries: LogEntry[] }
  | { type: "FLUSH" }
  | { type: "DOWNLOAD" }
  | { type: "CLEAR" };

type DevLoggerMainMessage =
  | { type: "READY" }
  | { type: "FLUSHED" }
  | { type: "DOWNLOADED"; buffer: ArrayBuffer; fileName: string }
  | { type: "CLEARED" }
  | { type: "ERROR"; error: string };

let logsDir: FileSystemDirectoryHandle | null = null;
let fileHandle: FileSystemSyncAccessHandle | null = null;
let fileOffset = 0;
let fileName = "";
const encoder = new TextEncoder();

async function initOPFS(): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory();
    logsDir = await root.getDirectoryHandle("dev_logs", { create: true });

    // 파일명: YYYYMMDD_HHmmss.txt
    const now = new Date();
    const y = now.getFullYear();
    const mo = (now.getMonth() + 1).toString().padStart(2, "0");
    const d = now.getDate().toString().padStart(2, "0");
    const h = now.getHours().toString().padStart(2, "0");
    const mi = now.getMinutes().toString().padStart(2, "0");
    const s = now.getSeconds().toString().padStart(2, "0");
    fileName = `${y}${mo}${d}_${h}${mi}${s}.txt`;

    const handle = await logsDir.getFileHandle(fileName, { create: true });
    fileHandle = await handle.createSyncAccessHandle();
    fileOffset = fileHandle.getSize();

    // 세션 시작 헤더
    const header = `\n${"=".repeat(60)}\n[SESSION] ${now.toISOString()}\n${"=".repeat(60)}\n`;
    const headerBytes = encoder.encode(header);
    fileHandle.write(headerBytes, { at: fileOffset });
    fileOffset += headerBytes.byteLength;
    fileHandle.flush();

    self.postMessage({ type: "READY" } as DevLoggerMainMessage);
  } catch (err) {
    self.postMessage({
      type: "ERROR",
      error: err instanceof Error ? err.message : String(err),
    } as DevLoggerMainMessage);
  }
}

function writeLog(entries: LogEntry[]): void {
  if (!fileHandle) return;

  try {
    const text = entries.map(e => e.text).join("");
    const bytes = encoder.encode(text);
    fileHandle.write(bytes, { at: fileOffset });
    fileOffset += bytes.byteLength;
  } catch {
    // 쓰기 실패 무시
  }
}

function flush(): void {
  fileHandle?.flush();
  self.postMessage({ type: "FLUSHED" } as DevLoggerMainMessage);
}

function download(): void {
  if (!fileHandle) {
    self.postMessage({ type: "ERROR", error: "File not found" } as DevLoggerMainMessage);
    return;
  }

  fileHandle.flush();
  const size = fileHandle.getSize();
  const buffer = new ArrayBuffer(size);
  const view = new Uint8Array(buffer);
  fileHandle.read(view, { at: 0 });

  self.postMessage(
    { type: "DOWNLOADED", buffer, fileName } as DevLoggerMainMessage,
    [buffer]
  );
}

async function clearLogs(): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle("dev_logs", { create: false });

    // 핸들 닫기
    if (fileHandle) {
      fileHandle.close();
      fileHandle = null;
    }

    // 모든 로그 파일 삭제
    const entries: string[] = [];
    for await (const [name] of dir.entries()) {
      if (name.endsWith(".txt")) {
        entries.push(name);
      }
    }

    for (const name of entries) {
      await dir.removeEntry(name);
    }

    self.postMessage({ type: "CLEARED" } as DevLoggerMainMessage);
  } catch {
    self.postMessage({ type: "CLEARED" } as DevLoggerMainMessage);
  }
}

self.onmessage = async (e: MessageEvent<DevLoggerWorkerMessage>) => {
  const msg = e.data;

  switch (msg.type) {
    case "INIT":
      await initOPFS();
      break;
    case "LOG":
      writeLog(msg.entries);
      break;
    case "FLUSH":
      flush();
      break;
    case "DOWNLOAD":
      download();
      break;
    case "CLEAR":
      await clearLogs();
      break;
  }
};
