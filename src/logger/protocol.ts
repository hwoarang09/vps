// logger/protocol.ts
// SimLogger 멀티 이벤트 바이너리 프로토콜

// ============================================================================
// Event Types
// ============================================================================

export enum EventType {
  // ML 이벤트 (통계용, 항상 기록)
  ML_ORDER_COMPLETE = 1,
  ML_EDGE_TRANSIT = 3,
  ML_LOCK = 4,
  ML_REPLAY_SNAPSHOT = 5,
  // Dev 이벤트 (디버그용)
  DEV_VEH_STATE = 10,
  DEV_PATH = 11,
  DEV_LOCK_DETAIL = 12,
  DEV_TRANSFER = 13,
  DEV_EDGE_QUEUE = 14,
}

// ============================================================================
// Record Sizes (bytes)
// ============================================================================

/**
 * ML_ORDER_COMPLETE (44B): orderId(4) vehId(4) destEdge(4) moveToPickupTs(4) pickupArriveTs(4) pickupStartTs(4) pickupDoneTs(4) moveToDropTs(4) dropArriveTs(4) dropStartTs(4) dropDoneTs(4)
 * ML_EDGE_TRANSIT (24B): ts(4) vehId(4) edgeId(4) enterTs(4) exitTs(4) edgeLen(f32,4)
 * ML_LOCK (16B): ts(4) vehId(4) nodeIdx(2) eventType(1) pad(1) waitMs(4)
 * ML_REPLAY_SNAPSHOT (36B): ts(4) vehId(4) x(f4) y(f4) z(f4) edgeIdx(4) ratio(f4) speed(f4) status(4)
 * DEV_VEH_STATE (44B): ts(4) vehId(4) x(f4) y(f4) z(f4) edge(f4) ratio(f4) speed(f4) movingStatus(f4) trafficState(f4) jobState(f4)
 * DEV_PATH (16B): ts(4) vehId(4) destEdge(4) pathLen(4)
 * DEV_LOCK_DETAIL (20B): ts(4) vehId(4) nodeIdx(2) type(1) pad(1) holderVehId(4) waitMs(4)
 * DEV_TRANSFER (16B): ts(4) vehId(4) fromEdge(4) toEdge(4)
 * DEV_EDGE_QUEUE (16B): ts(4) edgeId(4) vehId(4) count(2) type(1) pad(1)
 */
export const RECORD_SIZE: Record<EventType, number> = {
  [EventType.ML_ORDER_COMPLETE]: 44,
  [EventType.ML_EDGE_TRANSIT]: 24,
  [EventType.ML_LOCK]: 16,
  [EventType.ML_REPLAY_SNAPSHOT]: 36,
  [EventType.DEV_VEH_STATE]: 44,
  [EventType.DEV_PATH]: 16,
  [EventType.DEV_LOCK_DETAIL]: 20,
  [EventType.DEV_TRANSFER]: 16,
  [EventType.DEV_EDGE_QUEUE]: 16,
};

// ============================================================================
// Constants
// ============================================================================

/** 버퍼 flush 트리거 레코드 수 */
export const FLUSH_THRESHOLD = 512;

/** ML 이벤트 타입 목록 */
export const ML_EVENT_TYPES: EventType[] = [
  EventType.ML_ORDER_COMPLETE,
  EventType.ML_EDGE_TRANSIT,
  EventType.ML_LOCK,
  EventType.ML_REPLAY_SNAPSHOT,
];

/** 전체 이벤트 타입 목록 (ML + Dev) */
export const ALL_EVENT_TYPES: EventType[] = [
  EventType.ML_ORDER_COMPLETE,
  EventType.ML_EDGE_TRANSIT,
  EventType.ML_LOCK,
  EventType.ML_REPLAY_SNAPSHOT,
  EventType.DEV_VEH_STATE,
  EventType.DEV_PATH,
  EventType.DEV_LOCK_DETAIL,
  EventType.DEV_TRANSFER,
  EventType.DEV_EDGE_QUEUE,
];

// ============================================================================
// File Naming
// ============================================================================

const EVENT_FILE_SUFFIX: Record<EventType, string> = {
  [EventType.ML_ORDER_COMPLETE]: 'order',
  [EventType.ML_EDGE_TRANSIT]: 'edge_transit',
  [EventType.ML_LOCK]: 'lock',
  [EventType.ML_REPLAY_SNAPSHOT]: 'replay',
  [EventType.DEV_VEH_STATE]: 'veh_state',
  [EventType.DEV_PATH]: 'path',
  [EventType.DEV_LOCK_DETAIL]: 'lock_detail',
  [EventType.DEV_TRANSFER]: 'transfer',
  [EventType.DEV_EDGE_QUEUE]: 'edge_queue',
};

/** 이벤트 타입별 파일명 생성 */
export function getFileName(sessionId: string, eventType: EventType): string {
  return `${sessionId}_${EVENT_FILE_SUFFIX[eventType]}.bin`;
}

/** 파일명에서 이벤트 타입 suffix 추출 */
export function getFileSuffix(eventType: EventType): string {
  return EVENT_FILE_SUFFIX[eventType];
}

// ============================================================================
// Types
// ============================================================================

export interface SimLogFileInfo {
  fileName: string;
  size: number;
  recordCount: number;
  eventType: string;
}
