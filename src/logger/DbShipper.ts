// logger/DbShipper.ts
// Worker에서 fetch()로 로그 레코드를 FastAPI 서버에 batch POST

import { EventType, RECORD_SIZE, ML_EVENT_TYPES, ALL_EVENT_TYPES } from './protocol';

const DEFAULT_DB_URL = typeof self !== 'undefined' && self.location
  ? `http://${self.location.hostname}:8100`
  : 'http://localhost:8100';
const FLUSH_INTERVAL_MS = 1000;
const FLUSH_RECORD_LIMIT = 1000;

interface ShipperBuffer {
  buffer: Uint8Array;
  offset: number; // 현재 쓰기 위치 (bytes)
  count: number;  // 레코드 수
  recordSize: number;
}

export class DbShipper {
  private readonly sessionId: string;
  private readonly dbUrl: string;
  private readonly buffers = new Map<EventType, ShipperBuffer>();
  private timerId: ReturnType<typeof setInterval> | null = null;

  constructor(sessionId: string, mode: 'ml' | 'dev', dbUrl?: string) {
    this.sessionId = sessionId;
    this.dbUrl = dbUrl ?? DEFAULT_DB_URL;

    const eventTypes = mode === 'ml' ? ML_EVENT_TYPES : ALL_EVENT_TYPES;
    for (const et of eventTypes) {
      const recordSize = RECORD_SIZE[et];
      this.buffers.set(et, {
        buffer: new Uint8Array(FLUSH_RECORD_LIMIT * recordSize),
        offset: 0,
        count: 0,
        recordSize,
      });
    }
  }

  /** 세션 등록 + 타이머 시작 */
  async start(mode: string, vehicleCount?: number, mapName?: string): Promise<void> {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 2000);
      await fetch(`${this.dbUrl}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: this.sessionId,
          mode,
          vehicle_count: vehicleCount,
          map_name: mapName,
        }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
    } catch {
      // 서버 미기동 시 무시
    }

    this.timerId = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);
  }

  /** 레코드의 raw bytes를 버퍼에 push */
  push(eventType: EventType, view: DataView, byteOffset: number, recordSize: number): void {
    const buf = this.buffers.get(eventType);
    if (!buf) return;

    // 버퍼에 복사
    const src = new Uint8Array(view.buffer, byteOffset, recordSize);
    buf.buffer.set(src, buf.offset);
    buf.offset += recordSize;
    buf.count++;

    if (buf.count >= FLUSH_RECORD_LIMIT) {
      this._shipBuffer(eventType, buf);
    }
  }

  /** 모든 버퍼 전송 */
  flush(): void {
    for (const [et, buf] of this.buffers) {
      if (buf.count > 0) {
        this._shipBuffer(et, buf);
      }
    }
  }

  /** 타이머 정리 + 최종 flush */
  dispose(): void {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    this.flush();
  }

  private _shipBuffer(eventType: EventType, buf: ShipperBuffer): void {
    const data = buf.buffer.slice(0, buf.offset);
    buf.offset = 0;
    buf.count = 0;

    // fire-and-forget — 실패 시 데이터 폐기
    fetch(`${this.dbUrl}/logs/ingest`, {
      method: 'POST',
      headers: {
        'X-Session-Id': this.sessionId,
        'X-Event-Type': String(eventType),
        'Content-Type': 'application/octet-stream',
      },
      body: data,
    }).catch(() => {
      // 서버 미기동 시 무시
    });
  }
}
