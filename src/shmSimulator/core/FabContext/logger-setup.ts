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
  console.log(`[SimLogger] setupLoggerPort called: fabId=${fabId}, edgeTransitLogEnabled=${config.edgeTransitLogEnabled}`);
  if (config.edgeTransitLogEnabled === false) {
    console.log(`[SimLogger] SKIPPED: edgeTransitLogEnabled is false`);
    return null;
  }

  const sessionId = `sim_${fabId}_${Date.now()}`;
  const logger = new SimLogger({
    sessionId,
    workerId: workerId % 256,
    mode: 'ml',
  });

  try {
    await logger.init();
    console.log(`[SimLogger] initialized: session=${sessionId}, mode=ml, fabId=${fabId}`);
    return logger;
  } catch (err) {
    console.error(`[SimLogger] init failed:`, err);
    return null;
  }
}
