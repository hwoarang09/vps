// devLogUtils.ts
// DevLog OPFS 파일 관리 유틸리티

export interface DevLogFileInfo {
  fileName: string;
  size: number;
  createdAt: number;
}

export interface DeleteResult {
  deleted: string[];
  failed: string[];
}

/**
 * OPFS dev_logs 디렉토리의 모든 로그 파일 목록 조회
 */
export async function listDevLogFiles(): Promise<DevLogFileInfo[]> {
  try {
    const root = await navigator.storage.getDirectory();
    const logsDir = await root.getDirectoryHandle("dev_logs", { create: false });

    const files: DevLogFileInfo[] = [];

    for await (const [name, handle] of logsDir.entries()) {
      if (handle.kind === "file" && name.endsWith(".txt")) {
        const file = await (handle as FileSystemFileHandle).getFile();
        // 파일명에서 타임스탬프 추출 (dev_log_w_1234567890_xxxx.txt)
        const match = name.match(/dev_log_.*?(\d+)/);
        const createdAt = match ? parseInt(match[1]) : file.lastModified;

        files.push({
          fileName: name,
          size: file.size,
          createdAt,
        });
      }
    }

    // 최신 파일 먼저
    files.sort((a, b) => b.createdAt - a.createdAt);

    return files;
  } catch {
    // 디렉토리가 없으면 빈 배열 반환
    return [];
  }
}

/**
 * 특정 DevLog 파일 다운로드
 */
export async function downloadDevLogFile(
  fileName: string
): Promise<{ buffer: ArrayBuffer; fileName: string }> {
  const root = await navigator.storage.getDirectory();
  const logsDir = await root.getDirectoryHandle("dev_logs", { create: false });
  const fileHandle = await logsDir.getFileHandle(fileName);
  const file = await fileHandle.getFile();
  const buffer = await file.arrayBuffer();

  return { buffer, fileName };
}

/**
 * 여러 DevLog 파일을 하나로 병합해서 다운로드
 */
export async function downloadMergedDevLogs(
  fileNames: string[]
): Promise<{ content: string; fileName: string }> {
  const root = await navigator.storage.getDirectory();
  const logsDir = await root.getDirectoryHandle("dev_logs", { create: false });

  const contents: string[] = [];
  const decoder = new TextDecoder();

  for (const fileName of fileNames) {
    try {
      const fileHandle = await logsDir.getFileHandle(fileName);
      const file = await fileHandle.getFile();
      const buffer = await file.arrayBuffer();
      const text = decoder.decode(buffer);
      contents.push(`\n${"=".repeat(60)}\n[FILE: ${fileName}]\n${"=".repeat(60)}\n${text}`);
    } catch {
      // 파일 읽기 실패 시 스킵
    }
  }

  const mergedContent = contents.join("\n");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  return {
    content: mergedContent,
    fileName: `dev_logs_merged_${timestamp}.txt`,
  };
}

/**
 * 모든 DevLog 파일 다운로드 (병합)
 */
export async function downloadAllDevLogs(): Promise<{ content: string; fileName: string }> {
  const files = await listDevLogFiles();
  const fileNames = files.map((f) => f.fileName);
  return downloadMergedDevLogs(fileNames);
}

/**
 * 특정 DevLog 파일 삭제
 * @returns true if deleted, false if locked/failed
 */
export async function deleteDevLogFile(fileName: string): Promise<boolean> {
  try {
    const root = await navigator.storage.getDirectory();
    const logsDir = await root.getDirectoryHandle("dev_logs", { create: false });
    await logsDir.removeEntry(fileName);
    return true;
  } catch {
    // 파일이 잠겨있거나 삭제 실패
    return false;
  }
}

/**
 * 여러 DevLog 파일 삭제 (삭제 가능한 것만)
 */
export async function deleteDevLogFiles(fileNames: string[]): Promise<DeleteResult> {
  const deleted: string[] = [];
  const failed: string[] = [];

  for (const fileName of fileNames) {
    const success = await deleteDevLogFile(fileName);
    if (success) {
      deleted.push(fileName);
    } else {
      failed.push(fileName);
    }
  }

  return { deleted, failed };
}

/**
 * 모든 DevLog 파일 삭제 (삭제 가능한 것만)
 */
export async function clearAllDevLogs(): Promise<DeleteResult> {
  const deleted: string[] = [];
  const failed: string[] = [];

  try {
    const root = await navigator.storage.getDirectory();
    const logsDir = await root.getDirectoryHandle("dev_logs", { create: false });

    const files: string[] = [];
    for await (const [name, handle] of logsDir.entries()) {
      if (handle.kind === "file" && name.endsWith(".txt")) {
        files.push(name);
      }
    }

    for (const name of files) {
      try {
        await logsDir.removeEntry(name);
        deleted.push(name);
      } catch {
        // 파일이 잠겨있음 (Worker가 사용중)
        failed.push(name);
      }
    }
  } catch {
    // 디렉토리가 없음
  }

  return { deleted, failed };
}
