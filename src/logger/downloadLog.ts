// logger/downloadLog.ts
// OPFS에 저장된 로그 파일을 다운로드하는 유틸리티

/**
 * OPFS에 저장된 로그 파일을 사용자 PC로 다운로드
 *
 * @param sessionId - 로그 파일의 세션 ID
 * @returns 다운로드된 파일명과 레코드 수
 */
export async function downloadLogFromOPFS(sessionId: string): Promise<{
  fileName: string;
  recordCount: number;
  fileSize: number;
}> {
  try {
    // OPFS에서 파일 가져오기
    const root = await navigator.storage.getDirectory();
    const fileName = `edge_transit_${sessionId}.bin`;
    const fileHandle = await root.getFileHandle(fileName);
    const file = await fileHandle.getFile();

    // Blob 생성
    const blob = new Blob([await file.arrayBuffer()], {
      type: "application/octet-stream",
    });

    // 다운로드 트리거
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);

    const recordCount = file.size / 28; // LOG_RECORD_SIZE = 28
    return {
      fileName,
      recordCount,
      fileSize: file.size,
    };
  } catch (error) {
    throw new Error(
      `Failed to download log: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * OPFS에 저장된 모든 로그 파일 목록 조회
 */
export async function listLogFiles(): Promise<
  Array<{ fileName: string; size: number; recordCount: number; createdAt: number }>
> {
  try {
    const root = await navigator.storage.getDirectory();
    const files: Array<{ fileName: string; size: number; recordCount: number; createdAt: number }> =
      [];

    for await (const [name, handle] of root.entries()) {
      if (name.startsWith("edge_transit_") && name.endsWith(".bin")) {
        const file = await (handle as FileSystemFileHandle).getFile();
        // Extract timestamp from filename
        const match = /edge_transit_(\d+)/.exec(name);
        const createdAt = match ? Number.parseInt(match[1], 10) : file.lastModified;
        files.push({
          fileName: name,
          size: file.size,
          recordCount: Math.floor(file.size / 28),
          createdAt,
        });
      }
    }

    // Sort by creation time (newest first)
    files.sort((a, b) => b.createdAt - a.createdAt);

    return files;
  } catch (error) {
    throw new Error(
      `Failed to list log files: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * OPFS에서 특정 로그 파일 삭제 (파일명으로)
 */
export async function deleteLogFile(fileName: string): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(fileName);
  } catch (error) {
    throw new Error(
      `Failed to delete log file: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * OPFS에서 특정 로그 파일 다운로드 (파일명으로)
 */
export async function downloadLogFile(fileName: string): Promise<{
  buffer: ArrayBuffer;
  fileName: string;
  recordCount: number;
}> {
  try {
    const root = await navigator.storage.getDirectory();
    const fileHandle = await root.getFileHandle(fileName);
    const file = await fileHandle.getFile();
    const buffer = await file.arrayBuffer();
    const recordCount = Math.floor(file.size / 28);

    return { buffer, fileName, recordCount };
  } catch (error) {
    throw new Error(
      `Failed to download log file: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * OPFS의 모든 로그 파일 삭제
 * @param excludeSessionId - 제외할 세션 ID (현재 사용 중인 세션의 모든 파일 제외)
 */
export async function clearAllLogs(excludeSessionId?: string): Promise<number> {
  try {
    const root = await navigator.storage.getDirectory();
    let count = 0;

    // excludeSessionId에서 sessionId 추출 (파일명이 넘어올 수도 있음)
    let sessionPrefix: string | undefined;
    if (excludeSessionId) {
      // 파일명 형태면 sessionId 추출
      const match = /edge_transit_(\d+)/.exec(excludeSessionId);
      if (match) {
        sessionPrefix = `edge_transit_${match[1]}`;
      } else {
        // 순수 sessionId면 그대로 사용
        sessionPrefix = `edge_transit_${excludeSessionId}`;
      }
    }

    for await (const [name] of root.entries()) {
      if (name.startsWith("edge_transit_") && name.endsWith(".bin")) {
        // 현재 세션의 모든 파일 제외 (통합 + veh별)
        if (sessionPrefix && name.startsWith(sessionPrefix)) {
          continue;
        }
        await root.removeEntry(name);
        count++;
      }
    }

    return count;
  } catch (error) {
    throw new Error(
      `Failed to clear logs: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
