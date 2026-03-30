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

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
  const note = config.logSessionNote ? `_${config.logSessionNote}` : "";
  const sessionId = `${ts}${note}`;

  const logger = new SimLogger({
    sessionId,
    workerId: workerId % 256,
    mode: 'ml',
    targets: config.logTargets ?? { opfs: true, db: true },
    events: config.logEvents,
  });

  try {
    await logger.init();
    // Main Thread에 sessionId 알림
    globalThis.postMessage({ type: "LOG_SESSION_STARTED", sessionId, fabId });
    console.log(`[SimLogger] initialized: session=${sessionId}, mode=ml, fabId=${fabId}`);
    return logger;
  } catch (err) {
    console.error(`[SimLogger] init failed:`, err);
    return null;
  }
}
