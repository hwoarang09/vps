// Routing config → 표시 텍스트 변환 (한 곳에서만 관리)
import type { RoutingConfig, RoutingStrategy } from "@/store/simulation/fabConfigStore";

/** strategy enum → 짧은 라벨 */
export const ROUTING_LABEL: Record<string, string> = {
  DISTANCE: "Distance",
  BPR: "BPR",
  EWMA: "EWMA",
};

interface RoutingLike {
  strategy: RoutingStrategy | string;
  bprAlpha?: number;
  bprBeta?: number;
  bprGamma?: number;
  ewmaAlpha?: number;
}

/** 전체 routing config → 한줄 요약 텍스트 (예: "BPR a=4 b=8 c=0.2") */
export function routingText(cfg: RoutingLike): string {
  if (cfg.strategy === "BPR") {
    return `BPR a${cfg.bprAlpha ?? "?"} b${cfg.bprBeta ?? "?"} c${cfg.bprGamma ?? "?"}`;
  }
  if (cfg.strategy === "EWMA") {
    return `EWMA α${cfg.ewmaAlpha ?? "?"}`;
  }
  return ROUTING_LABEL[cfg.strategy] ?? String(cfg.strategy);
}

/** fab의 effective routing config 조합 (override + global fallback) */
export function fabRoutingText(
  globalRouting: RoutingConfig,
  override?: Partial<RoutingConfig>,
): string {
  return routingText({
    strategy: override?.strategy ?? globalRouting.strategy,
    bprAlpha: override?.bprAlpha ?? globalRouting.bprAlpha,
    bprBeta: override?.bprBeta ?? globalRouting.bprBeta,
    bprGamma: override?.bprGamma ?? globalRouting.bprGamma,
    ewmaAlpha: override?.ewmaAlpha ?? globalRouting.ewmaAlpha,
  });
}
