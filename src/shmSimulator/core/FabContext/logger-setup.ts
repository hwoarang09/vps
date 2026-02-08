// FabContext/logger-setup.ts
// Logger Worker 연결 로직

import { EdgeTransitTracker } from "@/logger";
import type { SimulationConfig } from "../../types";
import type { EngineStore } from "../EngineStore";

/**
 * Logger Worker와 연결된 MessagePort 설정
 * 이후 edge transit 로그가 자동으로 전송됨
 *
 * @param fabId - Fab ID (예: "fab_0")
 * @param config - Simulation config
 * @param workerId - Worker ID
 * @param actualNumVehicles - 실제 차량 수
 * @param store - Engine store (edge index 조회용)
 * @returns EdgeTransitTracker 인스턴스 또는 null
 */
export function setupLoggerPort(
  fabId: string,
  config: SimulationConfig,
  port: MessagePort,
  workerId: number,
  actualNumVehicles: number,
  store: EngineStore
): EdgeTransitTracker | null {
  // config에서 edgeTransitLogEnabled가 false면 로거 생성 안 함
  if (config.edgeTransitLogEnabled === false) {
    return null;
  }

  // fabId에서 숫자 추출 시도 (예: "fab_0" -> 0)
  let fabIdNum = 0;
  const match = /\d+/.exec(fabId);
  if (match) {
    fabIdNum = Number.parseInt(match[0], 10) % 256;
  }

  const edgeTransitTracker = new EdgeTransitTracker({
    workerId: workerId % 256,
    fabId: fabIdNum,
  });
  edgeTransitTracker.setLoggerPort(port);

  // 초기 진입 시간 기록 (모든 차량이 현재 edge에 이미 있음)
  // 초기화 시점의 시뮬레이션 시간은 0
  for (let i = 0; i < actualNumVehicles; i++) {
    const edgeIndex = store.getVehicleCurrentEdge(i);
    edgeTransitTracker.onEdgeEnter(i, edgeIndex, 0);
  }

  return edgeTransitTracker;
}
