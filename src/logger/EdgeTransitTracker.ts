// logger/EdgeTransitTracker.ts
// Edge 진입/통과 시간 추적 및 로그 생성

import { LogBuffer, type LogBufferConfig } from "./LogBuffer";
import type { Edge } from "@/types/edge";

/**
 * Edge Transit Tracker
 *
 * 차량의 edge 진입 시간을 추적하고, 통과 시 로그를 생성합니다.
 *
 * 사용법:
 * 1. 차량이 edge에 진입할 때: tracker.onEdgeEnter(vehId, edgeIndex, timestamp)
 * 2. 차량이 edge를 벗어날 때: tracker.onEdgeExit(vehId, edgeIndex, exitTime, edge)
 */
export class EdgeTransitTracker {
  private readonly logBuffer: LogBuffer;
  private enabled: boolean = true;

  // vehId -> (edgeIndex, enterTime)
  // 각 차량은 동시에 하나의 edge에만 있으므로 단순 Map 사용
  private readonly enterTimeMap: Map<number, { edgeIndex: number; enterTime: number }> = new Map();

  constructor(config: LogBufferConfig) {
    this.logBuffer = new LogBuffer(config);
  }

  /**
   * 로깅 활성화/비활성화
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * 로깅 활성화 상태 확인
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Logger Worker에 연결된 MessagePort 설정
   */
  setLoggerPort(port: MessagePort): void {
    this.logBuffer.setLoggerPort(port);
  }

  /**
   * Edge 진입 시 호출
   * @param vehId Vehicle ID (고유 식별자)
   * @param edgeIndex 진입한 Edge의 인덱스
   * @param timestamp 진입 시점 (시뮬레이션 누적 시간 ms)
   */
  onEdgeEnter(vehId: number, edgeIndex: number, timestamp: number): void {
    if (!this.enabled) return;
    this.enterTimeMap.set(vehId, { edgeIndex, enterTime: timestamp });
  }

  /**
   * Edge 통과(이탈) 시 호출 - 로그 생성
   * @param vehId Vehicle ID
   * @param fromEdgeIndex 떠나는 Edge의 인덱스
   * @param exitTime 통과 시점 (시뮬레이션 누적 시간 ms)
   * @param edge Edge 정보 (길이, 타입)
   */
  onEdgeExit(
    vehId: number,
    fromEdgeIndex: number,
    exitTime: number,
    edge: Edge
  ): void {
    if (!this.enabled) return;
    const entry = this.enterTimeMap.get(vehId);

    if (entry?.edgeIndex !== fromEdgeIndex) {
      // 진입 기록이 없거나 edge가 일치하지 않으면 무시
      // (초기화 시 또는 teleport 등의 경우)
      return;
    }
    // 로그 기록
    this.logBuffer.logEdgeTransit(
      exitTime,
      fromEdgeIndex,
      vehId,
      entry.enterTime,
      exitTime,
      edge.distance,
      edge.vos_rail_type
    );

    // 진입 기록 삭제 (다음 edge 진입 시 새로 기록됨)
    this.enterTimeMap.delete(vehId);
  }

  /**
   * 버퍼 플러시
   */
  flush(): void {
    this.logBuffer.flush();
  }

  /**
   * 현재 버퍼에 쌓인 레코드 수
   */
  getBufferedRecordCount(): number {
    return this.logBuffer.getRecordCount();
  }

  /**
   * 추적 중인 차량 수 (진입 후 아직 통과하지 않은)
   */
  getTrackingCount(): number {
    return this.enterTimeMap.size;
  }

  /**
   * 리소스 정리
   */
  dispose(): void {
    this.flush();
    this.enterTimeMap.clear();
  }
}
