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
  Array<{ name: string; size: number; recordCount: number }>
> {
  try {
    const root = await navigator.storage.getDirectory();
    const files: Array<{ name: string; size: number; recordCount: number }> =
      [];

    // @ts-expect-error - AsyncIterator 타입 이슈
    for await (const [name, handle] of root.entries()) {
      if (name.startsWith("edge_transit_") && name.endsWith(".bin")) {
        const file = await (handle as FileSystemFileHandle).getFile();
        files.push({
          name,
          size: file.size,
          recordCount: file.size / 28,
        });
      }
    }

    return files;
  } catch (error) {
    throw new Error(
      `Failed to list log files: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * OPFS에서 특정 로그 파일 삭제
 */
export async function deleteLogFile(sessionId: string): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory();
    const fileName = `edge_transit_${sessionId}.bin`;
    await root.removeEntry(fileName);
  } catch (error) {
    throw new Error(
      `Failed to delete log file: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * OPFS의 모든 로그 파일 삭제
 */
export async function clearAllLogs(): Promise<number> {
  try {
    const root = await navigator.storage.getDirectory();
    let count = 0;

    // @ts-expect-error - AsyncIterator 타입 이슈
    for await (const [name] of root.entries()) {
      if (name.startsWith("edge_transit_") && name.endsWith(".bin")) {
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
