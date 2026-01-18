// dev-logger.worker.ts
// 개발용 로그를 OPFS에 저장하는 워커
// global과 veh별로 파일 분리

type LogEntry = {
  vehId: number | null;
  text: string;
};

type DevLoggerWorkerMessage =
  | { type: "INIT"; sessionId: string }
  | { type: "LOG"; entries: LogEntry[] }
  | { type: "FLUSH" }
  | { type: "DOWNLOAD"; vehId?: number }
  | { type: "CLEAR" };

type DevLoggerMainMessage =
  | { type: "READY" }
  | { type: "FLUSHED" }
  | { type: "DOWNLOADED"; buffer: ArrayBuffer; fileName: string }
  | { type: "CLEARED" }
  | { type: "ERROR"; error: string };

interface FileHandle {
  handle: FileSystemSyncAccessHandle;
  offset: number;
  fileName: string;
}

let sessionId = "";
let logsDir: FileSystemDirectoryHandle | null = null;
const encoder = new TextEncoder();

// global 파일과 veh별 파일 핸들
let globalHandle: FileHandle | null = null;
const vehHandles = new Map<number, FileHandle>();

async function getOrCreateHandle(vehId: number | null): Promise<FileHandle> {
  if (vehId === null) {
    // global 핸들
    if (!globalHandle) {
      globalHandle = await createHandle("global");
    }
    return globalHandle;
  }

  // veh별 핸들
  let handle = vehHandles.get(vehId);
  if (!handle) {
    handle = await createHandle(`veh_${vehId}`);
    vehHandles.set(vehId, handle);
  }
  return handle;
}

async function createHandle(name: string): Promise<FileHandle> {
  if (!logsDir) throw new Error("logsDir not initialized");

  const fileName = `${sessionId}_${name}.txt`;
  const fileHandle = await logsDir.getFileHandle(fileName, { create: true });
  const handle = await fileHandle.createSyncAccessHandle();
  const offset = handle.getSize();

  // 세션 시작 헤더
  const header = `\n${"=".repeat(50)}\n[${name.toUpperCase()}] ${new Date().toISOString()}\n${"=".repeat(50)}\n`;
  const headerBytes = encoder.encode(header);
  handle.write(headerBytes, { at: offset });

  return {
    handle,
    offset: offset + headerBytes.byteLength,
    fileName,
  };
}

async function initOPFS(sid: string): Promise<void> {
  sessionId = sid;

  try {
    const root = await navigator.storage.getDirectory();
    logsDir = await root.getDirectoryHandle("dev_logs", { create: true });

    // global 핸들 미리 생성
    globalHandle = await createHandle("global");
    globalHandle.handle.flush();

    self.postMessage({ type: "READY" } as DevLoggerMainMessage);
  } catch (err) {
    self.postMessage({
      type: "ERROR",
      error: err instanceof Error ? err.message : String(err),
    } as DevLoggerMainMessage);
  }
}

function writeLog(entries: LogEntry[]): void {
  // vehId별로 그룹핑
  const grouped = new Map<number | null, string[]>();

  for (const entry of entries) {
    const key = entry.vehId;
    let arr = grouped.get(key);
    if (!arr) {
      arr = [];
      grouped.set(key, arr);
    }
    arr.push(entry.text);
  }

  // 각 그룹을 해당 파일에 쓰기
  for (const [vehId, texts] of grouped) {
    try {
      // 동기적으로 핸들 가져오기 (이미 생성된 경우)
      let fh: FileHandle | undefined;

      if (vehId === null) {
        fh = globalHandle ?? undefined;
      } else {
        fh = vehHandles.get(vehId);
      }

      if (!fh) {
        // 핸들이 없으면 비동기로 생성해야 함 - 버퍼에 쌓아두기
        // 여기서는 일단 skip하고 다음 flush에서 처리
        continue;
      }

      const text = texts.join("");
      const bytes = encoder.encode(text);
      fh.handle.write(bytes, { at: fh.offset });
      fh.offset += bytes.byteLength;
    } catch {
      // 쓰기 실패 무시
    }
  }
}

async function ensureHandles(entries: LogEntry[]): Promise<void> {
  // 필요한 핸들들 미리 생성
  const neededVehIds = new Set<number>();

  for (const entry of entries) {
    if (entry.vehId !== null && !vehHandles.has(entry.vehId)) {
      neededVehIds.add(entry.vehId);
    }
  }

  for (const vehId of neededVehIds) {
    await getOrCreateHandle(vehId);
  }
}

function flush(): void {
  // 모든 핸들 flush
  globalHandle?.handle.flush();
  for (const fh of vehHandles.values()) {
    fh.handle.flush();
  }
  self.postMessage({ type: "FLUSHED" } as DevLoggerMainMessage);
}

function download(vehId?: number): void {
  let fh: FileHandle | undefined;

  if (vehId === undefined) {
    fh = globalHandle ?? undefined;
  } else {
    fh = vehHandles.get(vehId);
  }

  if (!fh) {
    self.postMessage({ type: "ERROR", error: "File not found" } as DevLoggerMainMessage);
    return;
  }

  fh.handle.flush();
  const size = fh.handle.getSize();
  const buffer = new ArrayBuffer(size);
  const view = new Uint8Array(buffer);
  fh.handle.read(view, { at: 0 });

  self.postMessage(
    { type: "DOWNLOADED", buffer, fileName: fh.fileName } as DevLoggerMainMessage,
    [buffer]
  );
}

function closeAllHandles(): void {
  if (globalHandle) {
    globalHandle.handle.close();
    globalHandle = null;
  }
  for (const fh of vehHandles.values()) {
    fh.handle.close();
  }
  vehHandles.clear();
}

async function clearLogs(): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle("dev_logs", { create: false });

    // 모든 핸들 닫기
    closeAllHandles();

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
      await initOPFS(msg.sessionId);
      break;
    case "LOG":
      // 먼저 필요한 핸들 생성
      await ensureHandles(msg.entries);
      writeLog(msg.entries);
      break;
    case "FLUSH":
      flush();
      break;
    case "DOWNLOAD":
      download(msg.vehId);
      break;
    case "CLEAR":
      await clearLogs();
      break;
  }
};
