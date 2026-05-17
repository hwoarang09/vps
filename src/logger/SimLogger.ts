// logger/SimLogger.ts
// Worker 스레드 전용 로거 - OPFS SyncAccessHandle로 직접 쓰기

// FileSystemSyncAccessHandle은 Worker 컨텍스트에서만 사용 가능한 OPFS API
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const FileSystemSyncAccessHandle: any;

import {
  EventType,
  RECORD_SIZE,
  ROUTE_MAX_EDGES,
  FLUSH_THRESHOLD,
  getFileName,
} from './protocol';
import { DbShipper } from './DbShipper';

// ============================================================================
// Context Object Interfaces (Max 7 params 규칙 준수)
// ============================================================================

export interface LogOrderCompleteParams {
  orderId: number;
  vehId: number;
  srcStation: number;
  destStation: number;
  createTs: number;      // 반송명령생성시점 (현재는 assignTs와 동일)
  assignTs: number;      // 반송할당시점
  pickupStartTs: number; // 픽업도착시점
  pickupCompleteTs: number; // 픽업완료시점
  dropStartTs: number;   // 드롭도착시점
  dropCompleteTs: number; // 드롭완료시점 = 반송완료
}

export interface LogReplaySnapshotParams {
  ts: number;
  vehId: number;
  x: number;
  y: number;
  z: number;
  edgeIdx: number;
  ratio: number;
  speed: number;
  status: number;
}

export interface LogCheckpointParams {
  ts: number;
  vehId: number;
  cpEdge: number;
  cpFlags: number;
  action: number;
  cpRatio: number;
  currentEdge: number;
  currentRatio: number;
}

/** 이벤트별 enable 플래그 */
export interface LogEvents {
  edgeTransit?: boolean;      // ML_EDGE_TRANSIT (기본: true)
  lock?: boolean;             // ML_LOCK (기본: true)
  route?: boolean;            // ML_ROUTE (기본: true)
  orderComplete?: boolean;    // ML_ORDER_COMPLETE (기본: false)
  replaySnapshot?: boolean;   // ML_REPLAY_SNAPSHOT (기본: true)
  path?: boolean;             // DEV_PATH (기본: true in dev)
  lockDetail?: boolean;       // DEV_LOCK_DETAIL (기본: false)
  transfer?: boolean;         // DEV_TRANSFER (기본: true in dev)
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
  fabId?: string;            // fab 식별자 (파일명에 포함, 예: "fab_0")
  mode: 'ml' | 'dev';       // ml = ML이벤트만, dev = ML+디버그 전체
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

/** 주기적 flush 간격 (ms) - 데이터 유실 방지 */
const PERIODIC_FLUSH_INTERVAL = 10_000; // 10초

export class SimLogger {
  private readonly config: SimLoggerConfig;
  private readonly eventBuffers = new Map<EventType, EventBuffer>();
  private readonly enabledEvents: Set<EventType>;
  private dbShipper: DbShipper | null = null;
  private readonly useOpfs: boolean;
  private readonly useDb: boolean;
  private initialized = false;
  private frameCount = 0;
  private flushTimerId: ReturnType<typeof setInterval> | null = null;

  constructor(config: SimLoggerConfig) {
    this.config = config;
    this.useOpfs = config.targets?.opfs !== false; // 기본 true
    this.useDb = config.targets?.db !== false;     // 기본 true
    this.enabledEvents = this._resolveEnabledEvents();
  }

  /** 현재 sessionId 조회 */
  getSessionId(): string {
    return this.config.sessionId;
  }

  async init(): Promise<void> {
    // 이전 init의 잔여 handle이 있으면 먼저 정리
    if (this.eventBuffers.size > 0) {
      for (const buf of this.eventBuffers.values()) {
        try { buf.handle?.close(); } catch { /* ignore */ }
      }
      this.eventBuffers.clear();
    }

    const eventTypes = [...this.enabledEvents];

    if (this.useOpfs) {
      const root = await navigator.storage.getDirectory();

      for (const eventType of eventTypes) {
        const recordSize = RECORD_SIZE[eventType];
        const bufferBytes = FLUSH_THRESHOLD * recordSize;
        const buffer = new ArrayBuffer(bufferBytes);

        const fileName = getFileName(this.config.sessionId, eventType, this.config.fabId);
        const fileHandle = await root.getFileHandle(fileName, { create: true });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let handle: any;
        try {
          handle = await (fileHandle as any).createSyncAccessHandle();
        } catch {
          // 이전 세션의 handle이 아직 열려있을 수 있음 — 잠시 후 재시도
          await new Promise((r) => setTimeout(r, 100));
          handle = await (fileHandle as any).createSyncAccessHandle();
        }
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
        this.config.fabId,
      );
      await this.dbShipper.start(this.config.mode);
    }

    // 주기적 flush 타이머 (데이터 유실 방지)
    this.flushTimerId = setInterval(() => this.flush(), PERIODIC_FLUSH_INTERVAL);

    this.initialized = true;
  }

  /** mode + events 설정 기반으로 활성화할 EventType 결정 */
  private _resolveEnabledEvents(): Set<EventType> {
    const ev = this.config.events ?? {};
    const enabled = new Set<EventType>();

    // ML events
    if (ev.orderComplete)                          enabled.add(EventType.ML_ORDER_COMPLETE);
    if (ev.route !== false)                        enabled.add(EventType.ML_ROUTE);
    if (ev.edgeTransit !== false)                  enabled.add(EventType.ML_EDGE_TRANSIT);
    if (ev.lock !== false)                         enabled.add(EventType.ML_LOCK);
    if (ev.replaySnapshot !== false)               enabled.add(EventType.ML_REPLAY_SNAPSHOT);
    // DEV events (기본: dev 모드일 때만)
    if (ev.path !== false)                         enabled.add(EventType.DEV_PATH);      // 기본 on (ml 포함)
    if (ev.lockDetail === true)                    enabled.add(EventType.DEV_LOCK_DETAIL);
    if (ev.transfer !== false)                     enabled.add(EventType.DEV_TRANSFER);  // 기본 on (ml 포함)
    if (ev.checkpoint !== false)                   enabled.add(EventType.DEV_CHECKPOINT); // 기본 on

    return enabled;
  }

  // ============================================================================
  // ML 이벤트
  // ============================================================================

  logOrderComplete(p: LogOrderCompleteParams): void {
    const buf = this.eventBuffers.get(EventType.ML_ORDER_COMPLETE);
    if (!buf) return;
    const off = buf.count * buf.recordSize;
    buf.view.setUint32(off + 0,  p.orderId,          true);
    buf.view.setUint32(off + 4,  p.vehId,            true);
    buf.view.setUint32(off + 8,  p.srcStation,        true);
    buf.view.setUint32(off + 12, p.destStation,       true);
    buf.view.setUint32(off + 16, p.createTs,          true);
    buf.view.setUint32(off + 20, p.assignTs,          true);
    buf.view.setUint32(off + 24, p.pickupStartTs,     true);
    buf.view.setUint32(off + 28, p.pickupCompleteTs,  true);
    buf.view.setUint32(off + 32, p.dropStartTs,       true);
    buf.view.setUint32(off + 36, p.dropCompleteTs,    true);
    this._increment(buf, EventType.ML_ORDER_COMPLETE);
  }

  /**
   * committed path 기록 (Dijkstra 새 경로 산출 시).
   * path = 1-based edge index 배열, [0]=현재 edge. ROUTE_MAX_EDGES 초과 시 truncate.
   * 고정 412B 레코드: ts(4) vehId(4) pathLen(4) + edge(u32) × 100 (pathLen 유효, 나머지 0)
   */
  logRoute(ts: number, vehId: number, path: number[]): void {
    const buf = this.eventBuffers.get(EventType.ML_ROUTE);
    if (!buf) return;
    const off = buf.count * buf.recordSize;
    const len = Math.min(path.length, ROUTE_MAX_EDGES);
    buf.view.setUint32(off + 0, ts, true);
    buf.view.setUint32(off + 4, vehId, true);
    buf.view.setUint32(off + 8, len, true);
    for (let i = 0; i < ROUTE_MAX_EDGES; i++) {
      // 버퍼 재사용 — 유효 구간 밖은 0으로 채워 이전 레코드 잔재 제거
      buf.view.setUint32(off + 12 + i * 4, i < len ? path[i] : 0, true);
    }
    this._increment(buf, EventType.ML_ROUTE);
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

  logLock(ts: number, vehId: number, nodeIdx: number, lockEventType: number, waitMs: number, holderVehId: number = -1): void {
    const buf = this.eventBuffers.get(EventType.ML_LOCK);
    if (!buf) return;
    const off = buf.count * buf.recordSize;
    buf.view.setUint32(off + 0, ts, true);
    buf.view.setUint32(off + 4, vehId, true);
    buf.view.setUint16(off + 8, nodeIdx, true);
    buf.view.setUint8(off + 10, lockEventType);
    // holderHint: WAIT 시 holder vehId (uint8, 255=없음/초과)
    buf.view.setUint8(off + 11, holderVehId >= 0 && holderVehId < 255 ? holderVehId : 255);
    buf.view.setUint32(off + 12, waitMs, true);
    this._increment(buf, EventType.ML_LOCK);
  }

  /** 리플레이용 스냅샷 (36B): ts vehId x y z edgeIdx ratio speed status */
  logReplaySnapshot(p: LogReplaySnapshotParams): void {
    const buf = this.eventBuffers.get(EventType.ML_REPLAY_SNAPSHOT);
    if (!buf) return;
    const off = buf.count * buf.recordSize;
    buf.view.setUint32(off + 0, p.ts, true);
    buf.view.setUint32(off + 4, p.vehId, true);
    buf.view.setFloat32(off + 8, p.x, true);
    buf.view.setFloat32(off + 12, p.y, true);
    buf.view.setFloat32(off + 16, p.z, true);
    buf.view.setUint32(off + 20, p.edgeIdx, true);
    buf.view.setFloat32(off + 24, p.ratio, true);
    buf.view.setFloat32(off + 28, p.speed, true);
    buf.view.setUint32(off + 32, p.status, true);
    this._increment(buf, EventType.ML_REPLAY_SNAPSHOT);
  }

  /** replay snapshot 활성화 여부 */
  isReplayEnabled(): boolean {
    return this.enabledEvents.has(EventType.ML_REPLAY_SNAPSHOT);
  }

  // ============================================================================
  // Dev 이벤트
  // ============================================================================

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

  /** checkpoint 이벤트 (24B): ts vehId cpEdge cpFlags action cpRatio currentEdge currentRatio */
  logCheckpoint(p: LogCheckpointParams): void {
    const buf = this.eventBuffers.get(EventType.DEV_CHECKPOINT);
    if (!buf) return;
    const off = buf.count * buf.recordSize;
    buf.view.setUint32(off + 0, p.ts, true);
    buf.view.setUint32(off + 4, p.vehId, true);
    buf.view.setUint16(off + 8, p.cpEdge, true);
    buf.view.setUint8(off + 10, p.cpFlags);
    buf.view.setUint8(off + 11, p.action);
    buf.view.setFloat32(off + 12, p.cpRatio, true);
    buf.view.setUint32(off + 16, p.currentEdge, true);
    buf.view.setFloat32(off + 20, p.currentRatio, true);
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
    if (this.flushTimerId !== null) {
      clearInterval(this.flushTimerId);
      this.flushTimerId = null;
    }
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
