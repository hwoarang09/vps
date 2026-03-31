// logger/DbShipper.ts
// Worker에서 MQTT(ws)로 로그 레코드를 batch publish
// 토픽: VPS/logs/{sessionId}/{eventType} (binary payload)
// 세션등록: VPS/logs/session (JSON payload)

import mqtt from 'mqtt';
import { EventType, RECORD_SIZE, ML_EVENT_TYPES, ALL_EVENT_TYPES } from './protocol';

const DEFAULT_MQTT_URL = 'ws://localhost:9003';
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
  private readonly mqttUrl: string;
  private client: mqtt.MqttClient | null = null;
  private readonly buffers = new Map<EventType, ShipperBuffer>();
  private timerId: ReturnType<typeof setInterval> | null = null;
  private consecutiveFailures = 0;
  private disabled = false;
  private connected = false;

  constructor(sessionId: string, mode: 'ml' | 'dev', mqttUrl?: string) {
    this.sessionId = sessionId;
    this.mqttUrl = mqttUrl ?? DEFAULT_MQTT_URL;

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
      await this._connect();
    } catch (err) {
      console.warn(`[DbShipper] MQTT unreachable (${this.mqttUrl}):`, err);
      this.disabled = true;
      return;
    }

    // 세션 등록 (JSON)
    this.client!.publish(
      'VPS/logs/session',
      JSON.stringify({
        session_id: this.sessionId,
        mode,
        vehicle_count: vehicleCount,
        map_name: mapName,
      }),
      { qos: 1 },
    );
    console.log(`[DbShipper] session published via MQTT: ${this.sessionId}`);

    this.timerId = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);
  }

  private _connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('MQTT connect timeout'));
      }, 3000);

      this.client = mqtt.connect(this.mqttUrl, {
        clientId: `vps_worker_${this.sessionId.slice(0, 8)}_${Date.now()}`,
        clean: true,
        connectTimeout: 3000,
      });

      this.client.on('connect', () => {
        clearTimeout(timer);
        this.connected = true;
        console.log(`[DbShipper] MQTT connected: ${this.mqttUrl}`);
        resolve();
      });

      this.client.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });

      this.client.on('offline', () => {
        this.connected = false;
      });

      this.client.on('reconnect', () => {
        console.log('[DbShipper] MQTT reconnecting...');
      });
    });
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
    if (this.client) {
      this.client.end();
      this.client = null;
    }
  }

  private _shipBuffer(eventType: EventType, buf: ShipperBuffer): void {
    const data = buf.buffer.slice(0, buf.offset);
    buf.offset = 0;
    buf.count = 0;

    if (!this.client || !this.connected) {
      this.consecutiveFailures++;
      if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        console.warn(`[DbShipper] ${MAX_CONSECUTIVE_FAILURES} failures, disabling`);
        this.disabled = true;
        if (this.timerId !== null) {
          clearInterval(this.timerId);
          this.timerId = null;
        }
      }
      return;
    }

    const topic = `VPS/logs/${this.sessionId}/${eventType}`;
    this.client.publish(topic, Buffer.from(data), { qos: 1 }, (err) => {
      if (err) {
        this.consecutiveFailures++;
        if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          console.warn(`[DbShipper] ${MAX_CONSECUTIVE_FAILURES} failures, disabling`);
          this.disabled = true;
          if (this.timerId !== null) {
            clearInterval(this.timerId);
            this.timerId = null;
          }
        }
      } else {
        this.consecutiveFailures = 0;
      }
    });
  }
}
