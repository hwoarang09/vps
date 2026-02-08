// fb.worker.ts
// FlatBuffers 로그를 OPFS에 저장하는 Worker

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

let logsDir: FileSystemDirectoryHandle | null = null;
let fileHandle: FileSystemSyncAccessHandle | null = null;
let fileOffset = 0;
let fileName = "";
let sessionId = "";
let workerId = 0;

/**
 * OPFS 초기화 및 파일 생성
 */
async function initOPFS(sid: string, wid: number): Promise<void> {
  try {
    sessionId = sid;
    workerId = wid;

    const root = await navigator.storage.getDirectory();
    logsDir = await root.getDirectoryHandle("dev_logs", { create: true }); // dev_logs에 함께 저장

    // 파일명: fb_YYYYMMDD_HHmmss.bin (DevLogger와 같은 폴더)
    const now = new Date();
    const y = now.getFullYear();
    const mo = (now.getMonth() + 1).toString().padStart(2, "0");
    const d = now.getDate().toString().padStart(2, "0");
    const h = now.getHours().toString().padStart(2, "0");
    const mi = now.getMinutes().toString().padStart(2, "0");
    const s = now.getSeconds().toString().padStart(2, "0");
    fileName = `fb_${y}${mo}${d}_${h}${mi}${s}.bin`; // 텍스트 로그와 짝 맞춤

    const handle = await logsDir.getFileHandle(fileName, { create: true });
    fileHandle = await handle.createSyncAccessHandle();
    fileOffset = fileHandle.getSize();

    console.log(`[FbWorker] Initialized: ${fileName} (offset: ${fileOffset})`);

    self.postMessage({ type: "READY" } as FbMainMessage);
  } catch (err) {
    self.postMessage({
      type: "ERROR",
      error: err instanceof Error ? err.message : String(err),
    } as FbMainMessage);
  }
}

/**
 * FlatBuffers 로그 버퍼를 OPFS에 기록
 */
function writeLog(buffer: ArrayBuffer): void {
  if (!fileHandle) {
    console.warn("[FbWorker] No file handle, skipping write");
    return;
  }

  try {
    const bytes = new Uint8Array(buffer);

    // Write buffer length first (4 bytes, little-endian)
    const lengthBuf = new ArrayBuffer(4);
    const lengthView = new DataView(lengthBuf);
    lengthView.setUint32(0, bytes.byteLength, true);

    fileHandle.write(new Uint8Array(lengthBuf), { at: fileOffset });
    fileOffset += 4;

    // Write actual buffer
    fileHandle.write(bytes, { at: fileOffset });
    fileOffset += bytes.byteLength;

    console.log(`[FbWorker] Wrote ${bytes.byteLength} bytes (total: ${fileOffset})`);
  } catch (err) {
    console.error("[FbWorker] Write error:", err);
  }
}

/**
 * 버퍼 flush
 */
function flush(): void {
  if (fileHandle) {
    fileHandle.flush();
    console.log(`[FbWorker] Flushed (size: ${fileOffset} bytes)`);
  }
  self.postMessage({ type: "FLUSHED" } as FbMainMessage);
}

/**
 * 전체 로그 파일 다운로드
 */
function download(): void {
  if (!fileHandle) {
    self.postMessage({ type: "ERROR", error: "File not found" } as FbMainMessage);
    return;
  }

  try {
    fileHandle.flush();
    const size = fileHandle.getSize();
    const buffer = new ArrayBuffer(size);
    const view = new Uint8Array(buffer);
    fileHandle.read(view, { at: 0 });

    console.log(`[FbWorker] Download: ${fileName} (${size} bytes)`);

    self.postMessage(
      { type: "DOWNLOADED", buffer, fileName } as FbMainMessage,
      [buffer]
    );
  } catch (err) {
    self.postMessage({
      type: "ERROR",
      error: err instanceof Error ? err.message : String(err),
    } as FbMainMessage);
  }
}

/**
 * 모든 FlatBuffers 로그 파일 삭제
 */
async function clearLogs(): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle("dev_logs", { create: false });

    // 핸들 닫기
    if (fileHandle) {
      fileHandle.close();
      fileHandle = null;
    }

    // 모든 .bin 파일 삭제
    const entries: string[] = [];
    for await (const [name] of dir.entries()) {
      if (name.startsWith("fb_") && name.endsWith(".bin")) {
        entries.push(name);
      }
    }

    for (const name of entries) {
      await dir.removeEntry(name);
    }

    console.log(`[FbWorker] Cleared ${entries.length} files`);

    self.postMessage({ type: "CLEARED" } as FbMainMessage);
  } catch (err) {
    console.warn("[FbWorker] Clear error:", err);
    self.postMessage({ type: "CLEARED" } as FbMainMessage);
  }
}

/**
 * 메시지 핸들러
 */
self.onmessage = async (e: MessageEvent<FbWorkerMessage>) => {
  const msg = e.data;

  switch (msg.type) {
    case "INIT":
      await initOPFS(msg.sessionId, msg.workerId);
      break;
    case "LOG":
      writeLog(msg.buffer);
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

export {};
