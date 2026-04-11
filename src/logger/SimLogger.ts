// logger/SimLogger.ts
// Worker 스레드 전용 로거 - OPFS SyncAccessHandle로 직접 쓰기

// FileSystemSyncAccessHandle은 Worker 컨텍스트에서만 사용 가능한 OPFS API
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const FileSystemSyncAccessHandle: any;

import {
  EventType,
  RECORD_SIZE,
  FLUSH_THRESHOLD,
  getFileName,
} from './protocol';
import { DbShipper } from './DbShipper';

/** 이벤트별 enable 플래그 */
export interface LogEvents {
  edgeTransit?: boolean;      // ML_EDGE_TRANSIT (기본: true)
  lock?: boolean;             // ML_LOCK (기본: true)
  orderComplete?: boolean;    // ML_ORDER_COMPLETE (기본: false)
  replaySnapshot?: boolean;   // ML_REPLAY_SNAPSHOT (기본: true)
  vehState?: boolean;         // DEV_VEH_STATE (기본: false)
  path?: boolean;             // DEV_PATH (기본: true in dev)
  lockDetail?: boolean;       // DEV_LOCK_DETAIL (기본: false)
  transfer?: boolean;         // DEV_TRANSFER (기본: true in dev)
  edgeQueue?: boolean;        // DEV_EDGE_QUEUE (기본: false)
  checkpoint?: boolean;       // DEV_CHECKPOINT (기본: true)
}

export interface LogTargets {
  opfs?: boolean;    // OPFS 파일 쓰기 (기본: true)
  db?: boolean;      // MQTT → DB 전송 (기본: true)
  mqttUrl?: string;  // 기본: ws://localhost:9003
}

export interface SimLoggerConfig {
  sessionId: string;
  workerId: number;
  mode: 'ml' | 'dev';       // ml = ML이벤트만, dev = ML+디버그 전체
  vehStateHz?: 10 | 30 | 60; // dev mode veh_state 기록 빈도 (기본: 30)
  targets?: LogTargets;
  events?: LogEvents;        // 이벤트별 on/off (미지정 시 mode 기반 기본값)
}

interface EventBuffer {
  buffer: ArrayBuffer;
  view: DataView;
  count: number;          // 버퍼에 쌓인 레코드 수
  recordSize: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handle: any | null;     // FileSystemSyncAccessHandle (Worker 전용)
  fileOffset: number;     // 파일에 쓴 누적 bytes
}

export class SimLogger {
  private readonly config: SimLoggerConfig;
  private readonly eventBuffers = new Map<EventType, EventBuffer>();
  private readonly enabledEvents: Set<EventType>;
  private dbShipper: DbShipper | null = null;
  private readonly useOpfs: boolean;
  private readonly useDb: boolean;
  private initialized = false;
  private frameCount = 0;

  constructor(config: SimLoggerConfig) {
    this.config = config;
    this.useOpfs = config.targets?.opfs !== false; // 기본 true
    this.useDb = config.targets?.db !== false;     // 기본 true
    this.enabledEvents = this._resolveEnabledEvents();
  }

  async init(): Promise<void> {
    const eventTypes = [...this.enabledEvents];

    if (this.useOpfs) {
      const root = await navigator.storage.getDirectory();

      for (const eventType of eventTypes) {
        const recordSize = RECORD_SIZE[eventType];
        const bufferBytes = FLUSH_THRESHOLD * recordSize;
        const buffer = new ArrayBuffer(bufferBytes);

        const fileName = getFileName(this.config.sessionId, eventType);
        const fileHandle = await root.getFileHandle(fileName, { create: true });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const handle = await (fileHandle as any).createSyncAccessHandle();
        const fileSize = (handle as { getSize(): number }).getSize();

        this.eventBuffers.set(eventType, {
          buffer,
          view: new DataView(buffer),
          count: 0,
          recordSize,
          handle,
          fileOffset: fileSize,
        });
      }
    } else {
      // db-only: OPFS 없이 버퍼만 생성 (DbShipper에 push하기 위해)
      for (const eventType of eventTypes) {
        const recordSize = RECORD_SIZE[eventType];
        const bufferBytes = FLUSH_THRESHOLD * recordSize;
        const buffer = new ArrayBuffer(bufferBytes);
        this.eventBuffers.set(eventType, {
          buffer,
          view: new DataView(buffer),
          count: 0,
          recordSize,
          handle: null,
          fileOffset: 0,
        });
      }
    }

    if (this.useDb) {
      this.dbShipper = new DbShipper(
        this.config.sessionId,
        this.config.mode,
        this.config.targets?.mqttUrl,
      );
      await this.dbShipper.start(this.config.mode);
    }

    this.initialized = true;
  }

  /** mode + events 설정 기반으로 활성화할 EventType 결정 */
  private _resolveEnabledEvents(): Set<EventType> {
    const ev = this.config.events ?? {};
    const enabled = new Set<EventType>();

    // ML events
    if (ev.orderComplete)                          enabled.add(EventType.ML_ORDER_COMPLETE);
    if (ev.edgeTransit !== false)                  enabled.add(EventType.ML_EDGE_TRANSIT);
    if (ev.lock !== false)                         enabled.add(EventType.ML_LOCK);
    if (ev.replaySnapshot !== false)               enabled.add(EventType.ML_REPLAY_SNAPSHOT);
    // DEV events (기본: dev 모드일 때만)
    if (ev.vehState === true)                      enabled.add(EventType.DEV_VEH_STATE);
    if (ev.path !== false)                         enabled.add(EventType.DEV_PATH);      // 기본 on (ml 포함)
    if (ev.lockDetail === true)                    enabled.add(EventType.DEV_LOCK_DETAIL);
    if (ev.transfer !== false)                     enabled.add(EventType.DEV_TRANSFER);  // 기본 on (ml 포함)
    if (ev.edgeQueue === true)                     enabled.add(EventType.DEV_EDGE_QUEUE);
    if (ev.checkpoint !== false)                   enabled.add(EventType.DEV_CHECKPOINT); // 기본 on

    return enabled;
  }

  // ============================================================================
  // ML 이벤트
  // ============================================================================

  logOrderComplete(
    orderId: number, vehId: number, destEdge: number,
    moveToPickupTs: number, pickupArriveTs: number, pickupStartTs: number, pickupDoneTs: number,
    moveToDropTs: number, dropArriveTs: number, dropStartTs: number, dropDoneTs: number,
  ): void {
    const buf = this.eventBuffers.get(EventType.ML_ORDER_COMPLETE);
    if (!buf) return;
    const off = buf.count * buf.recordSize;
    buf.view.setUint32(off + 0, orderId, true);
    buf.view.setUint32(off + 4, vehId, true);
    buf.view.setUint32(off + 8, destEdge, true);
    buf.view.setUint32(off + 12, moveToPickupTs, true);
    buf.view.setUint32(off + 16, pickupArriveTs, true);
    buf.view.setUint32(off + 20, pickupStartTs, true);
    buf.view.setUint32(off + 24, pickupDoneTs, true);
    buf.view.setUint32(off + 28, moveToDropTs, true);
    buf.view.setUint32(off + 32, dropArriveTs, true);
    buf.view.setUint32(off + 36, dropStartTs, true);
    buf.view.setUint32(off + 40, dropDoneTs, true);
    this._increment(buf, EventType.ML_ORDER_COMPLETE);
  }

  logEdgeTransit(ts: number, vehId: number, edgeId: number, enterTs: number, exitTs: number, edgeLen: number): void {
    const buf = this.eventBuffers.get(EventType.ML_EDGE_TRANSIT);
    if (!buf) return;
    const off = buf.count * buf.recordSize;
    buf.view.setUint32(off + 0, ts, true);
    buf.view.setUint32(off + 4, vehId, true);
    buf.view.setUint32(off + 8, edgeId, true);
    buf.view.setUint32(off + 12, enterTs, true);
    buf.view.setUint32(off + 16, exitTs, true);
    buf.view.setFloat32(off + 20, edgeLen, true);
    this._increment(buf, EventType.ML_EDGE_TRANSIT);
  }

  logLock(ts: number, vehId: number, nodeIdx: number, lockEventType: number, waitMs: number): void {
    const buf = this.eventBuffers.get(EventType.ML_LOCK);
    if (!buf) return;
    const off = buf.count * buf.recordSize;
    buf.view.setUint32(off + 0, ts, true);
    buf.view.setUint32(off + 4, vehId, true);
    buf.view.setUint16(off + 8, nodeIdx, true);
    buf.view.setUint8(off + 10, lockEventType);
    buf.view.setUint8(off + 11, 0); // padding
    buf.view.setUint32(off + 12, waitMs, true);
    this._increment(buf, EventType.ML_LOCK);
  }

  /** 리플레이용 스냅샷 (36B): ts vehId x y z edgeIdx ratio speed status */
  logReplaySnapshot(ts: number, vehId: number, x: number, y: number, z: number, edgeIdx: number, ratio: number, speed: number, status: number): void {
    const buf = this.eventBuffers.get(EventType.ML_REPLAY_SNAPSHOT);
    if (!buf) return;
    const off = buf.count * buf.recordSize;
    buf.view.setUint32(off + 0, ts, true);
    buf.view.setUint32(off + 4, vehId, true);
    buf.view.setFloat32(off + 8, x, true);
    buf.view.setFloat32(off + 12, y, true);
    buf.view.setFloat32(off + 16, z, true);
    buf.view.setUint32(off + 20, edgeIdx, true);
    buf.view.setFloat32(off + 24, ratio, true);
    buf.view.setFloat32(off + 28, speed, true);
    buf.view.setUint32(off + 32, status, true);
    this._increment(buf, EventType.ML_REPLAY_SNAPSHOT);
  }

  /** replay snapshot 활성화 여부 */
  isReplayEnabled(): boolean {
    return this.enabledEvents.has(EventType.ML_REPLAY_SNAPSHOT);
  }

  // ============================================================================
  // Dev 이벤트
  // ============================================================================

  logVehState(ts: number, vehId: number, x: number, y: number, z: number, edge: number, ratio: number, speed: number, movingStatus: number, trafficState: number, jobState: number): void {
    const buf = this.eventBuffers.get(EventType.DEV_VEH_STATE);
    if (!buf) return;
    const off = buf.count * buf.recordSize;
    buf.view.setUint32(off + 0, ts, true);
    buf.view.setUint32(off + 4, vehId, true);
    buf.view.setFloat32(off + 8, x, true);
    buf.view.setFloat32(off + 12, y, true);
    buf.view.setFloat32(off + 16, z, true);
    buf.view.setFloat32(off + 20, edge, true);
    buf.view.setFloat32(off + 24, ratio, true);
    buf.view.setFloat32(off + 28, speed, true);
    buf.view.setFloat32(off + 32, movingStatus, true);
    buf.view.setFloat32(off + 36, trafficState, true);
    buf.view.setFloat32(off + 40, jobState, true);
    this._increment(buf, EventType.DEV_VEH_STATE);
  }

  logPath(ts: number, vehId: number, destEdge: number, pathLen: number): void {
    const buf = this.eventBuffers.get(EventType.DEV_PATH);
    if (!buf) return;
    const off = buf.count * buf.recordSize;
    buf.view.setUint32(off + 0, ts, true);
    buf.view.setUint32(off + 4, vehId, true);
    buf.view.setUint32(off + 8, destEdge, true);
    buf.view.setUint32(off + 12, pathLen, true);
    this._increment(buf, EventType.DEV_PATH);
  }

  logLockDetail(ts: number, vehId: number, nodeIdx: number, type: number, holderVehId: number, waitMs: number): void {
    const buf = this.eventBuffers.get(EventType.DEV_LOCK_DETAIL);
    if (!buf) return;
    const off = buf.count * buf.recordSize;
    buf.view.setUint32(off + 0, ts, true);
    buf.view.setUint32(off + 4, vehId, true);
    buf.view.setUint16(off + 8, nodeIdx, true);
    buf.view.setUint8(off + 10, type);
    buf.view.setUint8(off + 11, 0); // padding
    buf.view.setUint32(off + 12, holderVehId, true);
    buf.view.setUint32(off + 16, waitMs, true);
    this._increment(buf, EventType.DEV_LOCK_DETAIL);
  }

  logTransfer(ts: number, vehId: number, fromEdge: number, toEdge: number): void {
    const buf = this.eventBuffers.get(EventType.DEV_TRANSFER);
    if (!buf) return;
    const off = buf.count * buf.recordSize;
    buf.view.setUint32(off + 0, ts, true);
    buf.view.setUint32(off + 4, vehId, true);
    buf.view.setUint32(off + 8, fromEdge, true);
    buf.view.setUint32(off + 12, toEdge, true);
    this._increment(buf, EventType.DEV_TRANSFER);
  }

  logEdgeQueue(ts: number, edgeId: number, vehId: number, count: number, type: number): void {
    const buf = this.eventBuffers.get(EventType.DEV_EDGE_QUEUE);
    if (!buf) return;
    const off = buf.count * buf.recordSize;
    buf.view.setUint32(off + 0, ts, true);
    buf.view.setUint32(off + 4, edgeId, true);
    buf.view.setUint32(off + 8, vehId, true);
    buf.view.setUint16(off + 12, count, true);
    buf.view.setUint8(off + 14, type);
    buf.view.setUint8(off + 15, 0); // padding
    this._increment(buf, EventType.DEV_EDGE_QUEUE);
  }

  /** checkpoint 이벤트 (24B): ts vehId cpEdge cpFlags action cpRatio currentEdge currentRatio */
  logCheckpoint(ts: number, vehId: number, cpEdge: number, cpFlags: number, action: number, cpRatio: number, currentEdge: number, currentRatio: number): void {
    const buf = this.eventBuffers.get(EventType.DEV_CHECKPOINT);
    if (!buf) return;
    const off = buf.count * buf.recordSize;
    buf.view.setUint32(off + 0, ts, true);
    buf.view.setUint32(off + 4, vehId, true);
    buf.view.setUint16(off + 8, cpEdge, true);
    buf.view.setUint8(off + 10, cpFlags);
    buf.view.setUint8(off + 11, action);
    buf.view.setFloat32(off + 12, cpRatio, true);
    buf.view.setUint32(off + 16, currentEdge, true);
    buf.view.setFloat32(off + 20, currentRatio, true);
    this._increment(buf, EventType.DEV_CHECKPOINT);
  }

  // ============================================================================
  // 관리
  // ============================================================================

  flush(): void {
    for (const [eventType, buf] of this.eventBuffers) {
      this._flushBuffer(buf, eventType);
    }
  }

  dispose(): void {
    this.flush();
    for (const buf of this.eventBuffers.values()) {
      buf.handle?.close();
      buf.handle = null;
    }
    this.eventBuffers.clear();
    this.dbShipper?.dispose();
    this.dbShipper = null;
    this.initialized = false;
  }

  isDevMode(): boolean {
    return this.config.mode === 'dev';
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  /** Hz 체크: frameCount 기반으로 veh_state 기록 여부 결정 */
  shouldRecordVehState(currentFrameCount: number): boolean {
    const hz = this.config.vehStateHz ?? 30;
    const targetFps = 30; // default
    const interval = Math.max(1, Math.round(targetFps / hz));
    return currentFrameCount % interval === 0;
  }

  incrementFrameCount(): void {
    this.frameCount++;
  }

  getFrameCount(): number {
    return this.frameCount;
  }

  // ============================================================================
  // 내부 유틸
  // ============================================================================

  private _increment(buf: EventBuffer, eventType: EventType): void {
    // DbShipper: 레코드 1건씩 push (flush 전에)
    if (this.dbShipper) {
      const recordOffset = (buf.count) * buf.recordSize;
      this.dbShipper.push(eventType, buf.view, recordOffset, buf.recordSize);
    }

    buf.count++;
    if (buf.count >= FLUSH_THRESHOLD) {
      this._flushBuffer(buf, eventType);
    }
  }

  private _flushBuffer(buf: EventBuffer, _eventType: EventType): void {
    if (buf.count === 0) return;
    if (this.useOpfs && buf.handle) {
      const bytes = buf.count * buf.recordSize;
      const slice = buf.buffer.slice(0, bytes);
      buf.handle.write(slice, { at: buf.fileOffset });
      buf.handle.flush();
      buf.fileOffset += bytes;
    }
    buf.count = 0;
  }
}
