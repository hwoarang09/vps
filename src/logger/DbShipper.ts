// logger/DbShipper.ts
// Worker에서 fetch()로 로그 레코드를 FastAPI 서버에 batch POST

import { EventType, RECORD_SIZE, ML_EVENT_TYPES, ALL_EVENT_TYPES } from './protocol';

const DEFAULT_DB_URL = 'http://localhost:8100';
const FLUSH_INTERVAL_MS = 5000;
const FLUSH_RECORD_LIMIT = 2000;
const MAX_CONSECUTIVE_FAILURES = 3;

interface ShipperBuffer {
  buffer: Uint8Array;
  offset: number;
  count: number;
  recordSize: number;
}

export class DbShipper {
  private readonly sessionId: string;
  private readonly dbUrl: string;
  private readonly buffers = new Map<EventType, ShipperBuffer>();
  private timerId: ReturnType<typeof setInterval> | null = null;
  private consecutiveFailures = 0;
  private disabled = false;

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

  async start(mode: string, vehicleCount?: number, mapName?: string): Promise<void> {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 2000);
      const res = await fetch(`${this.dbUrl}/sessions`, {
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
      if (!res.ok) throw new Error(`${res.status}`);
      console.log(`[DbShipper] session registered: ${this.sessionId}`);
    } catch {
      console.warn(`[DbShipper] server unreachable (${this.dbUrl}), disabling DB shipping`);
      this.disabled = true;
      return;
    }

    this.timerId = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);
  }

  push(eventType: EventType, view: DataView, byteOffset: number, recordSize: number): void {
    if (this.disabled) return;
    const buf = this.buffers.get(eventType);
    if (!buf) return;

    const src = new Uint8Array(view.buffer, byteOffset, recordSize);
    buf.buffer.set(src, buf.offset);
    buf.offset += recordSize;
    buf.count++;

    if (buf.count >= FLUSH_RECORD_LIMIT) {
      this._shipBuffer(eventType, buf);
    }
  }

  flush(): void {
    if (this.disabled) return;
    for (const [et, buf] of this.buffers) {
      if (buf.count > 0) {
        this._shipBuffer(et, buf);
      }
    }
  }

  dispose(): void {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    if (!this.disabled) this.flush();
  }

  private _shipBuffer(eventType: EventType, buf: ShipperBuffer): void {
    const data = buf.buffer.slice(0, buf.offset);
    buf.offset = 0;
    buf.count = 0;

    fetch(`${this.dbUrl}/logs/ingest`, {
      method: 'POST',
      headers: {
        'X-Session-Id': this.sessionId,
        'X-Event-Type': String(eventType),
        'Content-Type': 'application/octet-stream',
      },
      body: data,
    }).then(() => {
      this.consecutiveFailures = 0;
    }).catch(() => {
      this.consecutiveFailures++;
      if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        console.warn(`[DbShipper] ${MAX_CONSECUTIVE_FAILURES} failures, disabling`);
        this.disabled = true;
        if (this.timerId !== null) {
          clearInterval(this.timerId);
          this.timerId = null;
        }
      }
    });
  }
}
