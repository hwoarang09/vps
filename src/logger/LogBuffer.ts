// logger/LogBuffer.ts
// SimWorker에서 사용하는 로그 버퍼 (Double Buffering)

import {
  LOG_BUFFER_SIZE,
  LOG_RECORD_SIZE,
  MAX_RECORDS_PER_BUFFER,
  OFFSET,
  EDGE_TYPE_MAP,
} from "./protocol";

export interface LogBufferConfig {
  workerId: number;
  fabId: number;
}

/**
 * Edge Transit Log Buffer
 *
 * 특징:
 * - Double Buffering: 전송 중에도 새 로그 수집 가능
 * - Zero-Copy Transfer: ArrayBuffer 소유권 이전으로 복사 비용 제거
 * - 버퍼가 가득 차면 자동으로 전송
 */
export class LogBuffer {
  private buffer: ArrayBuffer;
  private view: DataView;
  private recordCount: number = 0;

  private readonly workerId: number;
  private readonly fabId: number;

  private loggerPort: MessagePort | null = null;

  constructor(config: LogBufferConfig) {
    this.workerId = config.workerId;
    this.fabId = config.fabId;
    this.buffer = new ArrayBuffer(LOG_BUFFER_SIZE);
    this.view = new DataView(this.buffer);
  }

  /**
   * Logger Worker와 연결된 MessagePort 설정
   */
  setLoggerPort(port: MessagePort): void {
    this.loggerPort = port;
  }

  /**
   * Edge 통과 로그 기록
   *
   * @param timestamp 기록 시점 (시뮬레이션 누적 시간 ms)
   * @param edgeId Edge 인덱스
   * @param vehId Vehicle ID
   * @param enterTime Edge 진입 시점 (ms)
   * @param exitTime Edge 통과 시점 (ms)
   * @param edgeLength Edge 길이 (meters)
   * @param edgeType EdgeType enum 문자열
   */
  logEdgeTransit(
    timestamp: number,
    edgeId: number,
    vehId: number,
    enterTime: number,
    exitTime: number,
    edgeLength: number,
    edgeType: string
  ): void {
    if (this.recordCount >= MAX_RECORDS_PER_BUFFER) {
      this.flush();
    }

    const offset = this.recordCount * LOG_RECORD_SIZE;
    const edgeTypeCode = EDGE_TYPE_MAP[edgeType] ?? 0;

    this.view.setUint32(offset + OFFSET.TIMESTAMP, Math.trunc(timestamp), true);
    this.view.setUint8(offset + OFFSET.WORKER_ID, this.workerId);
    this.view.setUint8(offset + OFFSET.FAB_ID, this.fabId);
    this.view.setUint16(offset + OFFSET.EDGE_ID, edgeId, true);
    this.view.setUint32(offset + OFFSET.VEH_ID, vehId, true);
    this.view.setUint32(offset + OFFSET.ENTER_TIME, Math.trunc(enterTime), true);
    this.view.setUint32(offset + OFFSET.EXIT_TIME, Math.trunc(exitTime), true);
    this.view.setFloat32(offset + OFFSET.EDGE_LENGTH, edgeLength, true);
    this.view.setUint8(offset + OFFSET.EDGE_TYPE, edgeTypeCode);

    this.recordCount++;
  }

  /**
   * 버퍼를 Logger Worker로 전송하고 새 버퍼 할당
   */
  flush(): void {
    if (this.recordCount === 0) return;
    if (!this.loggerPort) {
      this.reset();
      return;
    }

    // 실제 사용된 크기만큼만 잘라서 전송
    const usedBytes = this.recordCount * LOG_RECORD_SIZE;
    const transferBuffer = this.buffer.slice(0, usedBytes);

    // 소유권 이전 (Zero-Copy)
    this.loggerPort.postMessage(
      { type: "LOG", buffer: transferBuffer },
      [transferBuffer]
    );

    // 새 버퍼 할당 (Double Buffering)
    this.buffer = new ArrayBuffer(LOG_BUFFER_SIZE);
    this.view = new DataView(this.buffer);
    this.recordCount = 0;
  }

  /**
   * 버퍼 초기화 (전송 없이)
   */
  private reset(): void {
    this.recordCount = 0;
  }

  /**
   * 현재 버퍼에 쌓인 레코드 수
   */
  getRecordCount(): number {
    return this.recordCount;
  }
}
