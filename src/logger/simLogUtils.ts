// simLogUtils.ts
// SimLogger OPFS 파일 관리 유틸리티 (Main Thread에서 호출)

import { type SimLogFileInfo } from './protocol';

/**
 * OPFS 루트에서 SimLogger .bin 파일 목록 조회
 */
export async function listSimLogFiles(): Promise<SimLogFileInfo[]> {
  try {
    const root = await navigator.storage.getDirectory();
    const files: SimLogFileInfo[] = [];

    for await (const [name, handle] of root.entries()) {
      if (handle.kind === 'file' && name.endsWith('.bin')) {
        const file = await (handle as FileSystemFileHandle).getFile();
        const suffix = extractSuffix(name);
        if (!suffix) continue;

        // recordSize를 suffix에서 유추
        const recordSize = SUFFIX_RECORD_SIZE[suffix];
        if (!recordSize) continue;

        files.push({
          fileName: name,
          size: file.size,
          recordCount: Math.floor(file.size / recordSize),
          eventType: suffix,
        });
      }
    }

    files.sort((a, b) => a.fileName.localeCompare(b.fileName));
    return files;
  } catch {
    return [];
  }
}

/**
 * SimLogger .bin 파일 다운로드 (브라우저로 저장)
 */
export async function downloadSimLogFile(fileName: string): Promise<void> {
  const root = await navigator.storage.getDirectory();
  const fileHandle = await root.getFileHandle(fileName);
  const file = await fileHandle.getFile();
  const buffer = await file.arrayBuffer();

  const blob = new Blob([buffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * SimLogger .bin 파일 삭제
 */
export async function deleteSimLogFile(fileName: string): Promise<boolean> {
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(fileName);
    return true;
  } catch {
    return false;
  }
}

/**
 * 모든 SimLogger .bin 파일 삭제
 */
export async function clearAllSimLogs(): Promise<{ deleted: string[]; failed: string[] }> {
  const deleted: string[] = [];
  const failed: string[] = [];

  try {
    const root = await navigator.storage.getDirectory();
    const names: string[] = [];
    for await (const [name, handle] of root.entries()) {
      if (handle.kind === 'file' && name.endsWith('.bin')) {
        names.push(name);
      }
    }

    for (const name of names) {
      try {
        await root.removeEntry(name);
        deleted.push(name);
      } catch {
        failed.push(name);
      }
    }
  } catch {
    // root 접근 실패
  }

  return { deleted, failed };
}

// ============================================================================
// Internal
// ============================================================================

const SUFFIX_RECORD_SIZE: Record<string, number> = {
  pickup: 16,
  dropoff: 16,
  edge_transit: 24,
  lock: 16,
  veh_state: 44,
  path: 16,
  lock_detail: 20,
  transfer: 16,
  edge_queue: 16,
};

function extractSuffix(fileName: string): string | null {
  // e.g., "session_123_edge_transit.bin" → "edge_transit"
  const stem = fileName.replace('.bin', '');
  for (const suffix of Object.keys(SUFFIX_RECORD_SIZE)) {
    if (stem.endsWith(`_${suffix}`)) {
      return suffix;
    }
  }
  return null;
}
