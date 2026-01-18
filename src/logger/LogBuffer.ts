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
  /** true면 vehId별로 파일 분리, false면 통합 파일 (기본: true) */
  splitByVeh?: boolean;
}

interface VehBuffer {
  buffer: ArrayBuffer;
  view: DataView;
  recordCount: number;
}

/**
 * Edge Transit Log Buffer
 *
 * 특징:
 * - Double Buffering: 전송 중에도 새 로그 수집 가능
 * - Zero-Copy Transfer: ArrayBuffer 소유권 이전으로 복사 비용 제거
 * - 버퍼가 가득 차면 자동으로 전송
 * - vehId별 파일 분리 지원
 */
export class LogBuffer {
  // 통합 버퍼 (splitByVeh=false일 때 사용)
  private buffer: ArrayBuffer;
  private view: DataView;
  private recordCount: number = 0;

  // vehId별 버퍼 (splitByVeh=true일 때 사용)
  private vehBuffers = new Map<number, VehBuffer>();

  private readonly workerId: number;
  private readonly fabId: number;
  private readonly splitByVeh: boolean;

  private loggerPort: MessagePort | null = null;

  constructor(config: LogBufferConfig) {
    this.workerId = config.workerId;
    this.fabId = config.fabId;
    this.splitByVeh = config.splitByVeh ?? true;
    this.buffer = new ArrayBuffer(LOG_BUFFER_SIZE);
    this.view = new DataView(this.buffer);
    console.log("[LogBuffer] created, splitByVeh:", this.splitByVeh);
  }

  /**
   * Logger Worker와 연결된 MessagePort 설정
   */
  setLoggerPort(port: MessagePort): void {
    this.loggerPort = port;
  }

  /**
   * vehId별 버퍼 가져오기 (없으면 생성)
   */
  private getOrCreateVehBuffer(vehId: number): VehBuffer {
    let vehBuffer = this.vehBuffers.get(vehId);
    if (!vehBuffer) {
      vehBuffer = {
        buffer: new ArrayBuffer(LOG_BUFFER_SIZE),
        view: new DataView(new ArrayBuffer(LOG_BUFFER_SIZE)),
        recordCount: 0,
      };
      vehBuffer.view = new DataView(vehBuffer.buffer);
      this.vehBuffers.set(vehId, vehBuffer);
    }
    return vehBuffer;
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
    console.log("[LogBuffer] logEdgeTransit called, vehId:", vehId, "splitByVeh:", this.splitByVeh);
    const edgeTypeCode = EDGE_TYPE_MAP[edgeType] ?? 0;

    if (this.splitByVeh) {
      // vehId별 버퍼에 기록
      const vehBuffer = this.getOrCreateVehBuffer(vehId);

      if (vehBuffer.recordCount >= MAX_RECORDS_PER_BUFFER) {
        this.flushVehBuffer(vehId, vehBuffer);
      }

      const offset = vehBuffer.recordCount * LOG_RECORD_SIZE;
      vehBuffer.view.setUint32(offset + OFFSET.TIMESTAMP, Math.trunc(timestamp), true);
      vehBuffer.view.setUint8(offset + OFFSET.WORKER_ID, this.workerId);
      vehBuffer.view.setUint8(offset + OFFSET.FAB_ID, this.fabId);
      vehBuffer.view.setUint16(offset + OFFSET.EDGE_ID, edgeId, true);
      vehBuffer.view.setUint32(offset + OFFSET.VEH_ID, vehId, true);
      vehBuffer.view.setUint32(offset + OFFSET.ENTER_TIME, Math.trunc(enterTime), true);
      vehBuffer.view.setUint32(offset + OFFSET.EXIT_TIME, Math.trunc(exitTime), true);
      vehBuffer.view.setFloat32(offset + OFFSET.EDGE_LENGTH, edgeLength, true);
      vehBuffer.view.setUint8(offset + OFFSET.EDGE_TYPE, edgeTypeCode);
      vehBuffer.recordCount++;
    } else {
      // 통합 버퍼에 기록
      if (this.recordCount >= MAX_RECORDS_PER_BUFFER) {
        this.flush();
      }

      const offset = this.recordCount * LOG_RECORD_SIZE;
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
  }

  /**
   * 특정 vehId의 버퍼를 Logger Worker로 전송
   */
  private flushVehBuffer(vehId: number, vehBuffer: VehBuffer): void {
    if (vehBuffer.recordCount === 0) return;
    if (!this.loggerPort) {
      console.log("[LogBuffer] flushVehBuffer: no loggerPort!");
      vehBuffer.recordCount = 0;
      return;
    }

    const usedBytes = vehBuffer.recordCount * LOG_RECORD_SIZE;
    const transferBuffer = vehBuffer.buffer.slice(0, usedBytes);

    console.log("[LogBuffer] sending LOG_BY_VEH, vehId:", vehId, "records:", vehBuffer.recordCount);

    // vehId 정보와 함께 전송
    this.loggerPort.postMessage(
      { type: "LOG_BY_VEH", vehId, buffer: transferBuffer },
      [transferBuffer]
    );

    // 새 버퍼 할당
    vehBuffer.buffer = new ArrayBuffer(LOG_BUFFER_SIZE);
    vehBuffer.view = new DataView(vehBuffer.buffer);
    vehBuffer.recordCount = 0;
  }

  /**
   * 버퍼를 Logger Worker로 전송하고 새 버퍼 할당
   */
  flush(): void {
    if (this.splitByVeh) {
      // 모든 vehId별 버퍼 전송
      for (const [vehId, vehBuffer] of this.vehBuffers) {
        this.flushVehBuffer(vehId, vehBuffer);
      }
    } else {
      // 통합 버퍼 전송
      if (this.recordCount === 0) return;
      if (!this.loggerPort) {
        this.reset();
        return;
      }

      const usedBytes = this.recordCount * LOG_RECORD_SIZE;
      const transferBuffer = this.buffer.slice(0, usedBytes);

      this.loggerPort.postMessage(
        { type: "LOG", buffer: transferBuffer },
        [transferBuffer]
      );

      this.buffer = new ArrayBuffer(LOG_BUFFER_SIZE);
      this.view = new DataView(this.buffer);
      this.recordCount = 0;
    }
  }

  /**
   * 버퍼 초기화 (전송 없이)
   */
  private reset(): void {
    this.recordCount = 0;
  }

  /**
   * 현재 버퍼에 쌓인 레코드 수 (통합)
   */
  getRecordCount(): number {
    if (this.splitByVeh) {
      let total = 0;
      for (const vehBuffer of this.vehBuffers.values()) {
        total += vehBuffer.recordCount;
      }
      return total;
    }
    return this.recordCount;
  }

  /**
   * 특정 vehId의 버퍼에 쌓인 레코드 수
   */
  getVehRecordCount(vehId: number): number {
    const vehBuffer = this.vehBuffers.get(vehId);
    return vehBuffer?.recordCount ?? 0;
  }

  /**
   * 현재 버퍼가 있는 vehId 목록
   */
  getActiveVehIds(): number[] {
    return Array.from(this.vehBuffers.keys());
  }
}
