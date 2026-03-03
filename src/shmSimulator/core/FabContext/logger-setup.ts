// FabContext/logger-setup.ts
// SimLogger 초기화 로직

import { SimLogger } from "@/logger";
import type { SimulationConfig } from "../../types";

/**
 * SimLogger 초기화
 * Worker 스레드에서 OPFS에 직접 쓰기
 *
 * @param fabId - Fab ID (예: "fab_0")
 * @param config - Simulation config
 * @param workerId - Worker ID
 * @returns SimLogger 인스턴스 또는 null
 */
export async function setupLoggerPort(
  fabId: string,
  config: SimulationConfig,
  workerId: number,
): Promise<SimLogger | null> {
  if (config.edgeTransitLogEnabled === false) {
    return null;
  }

  const sessionId = `sim_${fabId}_${Date.now()}`;
  const logger = new SimLogger({
    sessionId,
    workerId: workerId % 256,
    mode: 'ml',
  });

  await logger.init();
  return logger;
}
