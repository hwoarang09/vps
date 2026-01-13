// logger/protocol.ts
// Edge Transit Log 바이너리 프로토콜 정의

/**
 * Edge Transit Log Record (28 bytes)
 *
 * | Field       | Type    | Size    | Offset | Description                    |
 * |-------------|---------|---------|--------|--------------------------------|
 * | timestamp   | Uint32  | 4 bytes | 0      | 기록 시점 (시뮬 tick, ms)       |
 * | workerId    | Uint8   | 1 byte  | 4      | 워커 ID (0~255)                |
 * | fabId       | Uint8   | 1 byte  | 5      | Fab ID (0~255)                 |
 * | edgeId      | Uint16  | 2 bytes | 6      | Edge Index (0~65535)           |
 * | vehId       | Uint32  | 4 bytes | 8      | Vehicle ID (0~4B)              |
 * | enterTime   | Uint32  | 4 bytes | 12     | Edge 진입 시점 (ms)            |
 * | exitTime    | Uint32  | 4 bytes | 16     | Edge 통과 시점 (ms)            |
 * | edgeLength  | Float32 | 4 bytes | 20     | Edge 길이 (meters)             |
 * | edgeType    | Uint8   | 1 byte  | 24     | EdgeType enum index            |
 * | padding     | Uint8x3 | 3 bytes | 25     | 4-byte alignment               |
 */

// ============================================================================
// Constants
// ============================================================================

/** 레코드 하나의 크기 (bytes) */
export const LOG_RECORD_SIZE = 28;

/** 버퍼 크기 (4KB = ~146 records) */
export const LOG_BUFFER_SIZE = 4096;

/** 버퍼당 최대 레코드 수 */
export const MAX_RECORDS_PER_BUFFER = Math.floor(LOG_BUFFER_SIZE / LOG_RECORD_SIZE);

/** Cloud 모드에서 업로드 트리거 크기 (5MB) */
export const CLOUD_UPLOAD_THRESHOLD = 5 * 1024 * 1024;

// Field offsets
export const OFFSET = {
  TIMESTAMP: 0,
  WORKER_ID: 4,
  FAB_ID: 5,
  EDGE_ID: 6,
  VEH_ID: 8,
  ENTER_TIME: 12,
  EXIT_TIME: 16,
  EDGE_LENGTH: 20,
  EDGE_TYPE: 24,
} as const;

// ============================================================================
// EdgeType -> Uint8 매핑
// ============================================================================

export const EDGE_TYPE_MAP: Record<string, number> = {
  LINEAR: 0,
  CURVE_90: 1,
  CURVE_180: 2,
  CURVE_CSC: 3,
  S_CURVE: 4,
  LEFT_CURVE: 5,
  RIGHT_CURVE: 6,
} as const;

export const EDGE_TYPE_REVERSE: Record<number, string> = {
  0: "LINEAR",
  1: "CURVE_90",
  2: "CURVE_180",
  3: "CURVE_CSC",
  4: "S_CURVE",
  5: "LEFT_CURVE",
  6: "RIGHT_CURVE",
} as const;

// ============================================================================
// Types
// ============================================================================

export interface EdgeTransitRecord {
  timestamp: number;
  workerId: number;
  fabId: number;
  edgeId: number;
  vehId: number;
  enterTime: number;
  exitTime: number;
  edgeLength: number;
  edgeType: number;
}

export interface LogFileInfo {
  fileName: string;
  size: number;
  recordCount: number;
  createdAt: number; // timestamp
}

export type LoggerMode = "OPFS" | "CLOUD";

// ============================================================================
// Logger Worker Messages
// ============================================================================

export type LoggerWorkerMessage =
  | { type: "INIT"; mode: LoggerMode; sessionId?: string }
  | { type: "LOG"; buffer: ArrayBuffer }
  | { type: "FLUSH" }
  | { type: "CLOSE" }
  | { type: "DOWNLOAD" }
  | { type: "LIST_FILES" }
  | { type: "DOWNLOAD_FILE"; fileName: string }
  | { type: "DELETE_FILE"; fileName: string };

export type LoggerMainMessage =
  | { type: "READY" }
  | { type: "FLUSHED"; recordCount: number }
  | { type: "UPLOADED"; url: string; recordCount: number }
  | { type: "CLOSED"; totalRecords: number }
  | { type: "DOWNLOADED"; buffer: ArrayBuffer; fileName: string; recordCount: number }
  | { type: "FILE_LIST"; files: LogFileInfo[] }
  | { type: "FILE_DELETED"; fileName: string }
  | { type: "ERROR"; error: string };

// ============================================================================
// Packing / Unpacking Utilities
// ============================================================================

/**
 * EdgeTransitRecord를 ArrayBuffer의 특정 offset에 기록
 */
export function packRecord(
  view: DataView,
  offset: number,
  record: EdgeTransitRecord
): void {
  view.setUint32(offset + OFFSET.TIMESTAMP, record.timestamp, true);
  view.setUint8(offset + OFFSET.WORKER_ID, record.workerId);
  view.setUint8(offset + OFFSET.FAB_ID, record.fabId);
  view.setUint16(offset + OFFSET.EDGE_ID, record.edgeId, true);
  view.setUint32(offset + OFFSET.VEH_ID, record.vehId, true);
  view.setUint32(offset + OFFSET.ENTER_TIME, record.enterTime, true);
  view.setUint32(offset + OFFSET.EXIT_TIME, record.exitTime, true);
  view.setFloat32(offset + OFFSET.EDGE_LENGTH, record.edgeLength, true);
  view.setUint8(offset + OFFSET.EDGE_TYPE, record.edgeType);
}

/**
 * ArrayBuffer에서 EdgeTransitRecord를 읽기
 */
export function unpackRecord(view: DataView, offset: number): EdgeTransitRecord {
  return {
    timestamp: view.getUint32(offset + OFFSET.TIMESTAMP, true),
    workerId: view.getUint8(offset + OFFSET.WORKER_ID),
    fabId: view.getUint8(offset + OFFSET.FAB_ID),
    edgeId: view.getUint16(offset + OFFSET.EDGE_ID, true),
    vehId: view.getUint32(offset + OFFSET.VEH_ID, true),
    enterTime: view.getUint32(offset + OFFSET.ENTER_TIME, true),
    exitTime: view.getUint32(offset + OFFSET.EXIT_TIME, true),
    edgeLength: view.getFloat32(offset + OFFSET.EDGE_LENGTH, true),
    edgeType: view.getUint8(offset + OFFSET.EDGE_TYPE),
  };
}

/**
 * 전체 버퍼에서 모든 레코드 읽기
 */
export function unpackAllRecords(buffer: ArrayBuffer, recordCount: number): EdgeTransitRecord[] {
  const view = new DataView(buffer);
  const records: EdgeTransitRecord[] = [];
  for (let i = 0; i < recordCount; i++) {
    records.push(unpackRecord(view, i * LOG_RECORD_SIZE));
  }
  return records;
}
