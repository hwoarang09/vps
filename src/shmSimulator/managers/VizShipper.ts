// shmSimulator/managers/VizShipper.ts
// Worker → MQTT(ws) 로 실시간 차량 위치를 외부 뷰어(Omniverse 등)에 publish.
//
//   토픽   : VPS/viz/{fabId}/vehicles
//   payload: {"t": sim_ms, "v": [[id, x, y, rot, spd, job], ...]}  (JSON)
//            job = JobState enum (0=INIT,1=IDLE,2=MOVE_TO_LOAD,3=LOADING,
//                  4=MOVE_TO_UNLOAD,5=UNLOADING,6=ERROR) → 수신측 색상 분기
//
// 발행 시점은 simulation-step 이 결정 (0.5s 주기 + 속도 0 전환 = 정지 이벤트).
// 수신측(Omniverse extension)은 타임스탬프 버퍼 + 속도기반 Hermite 보간으로
// 60fps 매끈하게 그린다. → publish 는 듬성듬성(저rate)이어도 됨.
//
// 로그용 DbShipper 와 별개 (DbShipper=binary 로그 DB, 이건=실시간 viz). 둘 다 worker
// 에서 mqtt ws 사용. 브로커 없으면 조용히 disable (시뮬엔 영향 없음).

import mqtt from 'mqtt';
import { MQTT_WS_URL } from '@/config/logConfig';

export class VizShipper {
  private client: mqtt.MqttClient | null = null;
  private connected = false;
  private disabled = false;
  private readonly topic: string;

  constructor(fabId: string, url: string = MQTT_WS_URL) {
    this.topic = `VPS/viz/${fabId}/vehicles`;
    try {
      this.client = mqtt.connect(url, {
        clientId: `vps_viz_${fabId}_${Date.now()}`,
        connectTimeout: 3000,
        reconnectPeriod: 2000,
      });
      this.client.on('connect', () => {
        this.connected = true;
        console.log(`[VizShipper] connected: ${url} → ${this.topic}`);
      });
      this.client.on('error', (err) => {
        console.warn('[VizShipper] mqtt error:', err);
      });
      this.client.on('offline', () => {
        this.connected = false;
      });
    } catch (err) {
      console.warn('[VizShipper] connect failed, disabled:', err);
      this.disabled = true;
    }
  }

  /** rows: [[id, x, y, rot_deg, spd, job], ...] — 빈 배열이면 무시 */
  publish(simTimeMs: number, rows: number[][]): void {
    if (this.disabled || !this.client || !this.connected || rows.length === 0) return;
    this.client.publish(this.topic, JSON.stringify({ t: simTimeMs, v: rows }), { qos: 0 });
  }

  dispose(): void {
    if (this.client) {
      this.client.end(true);
      this.client = null;
    }
    this.connected = false;
  }
}
