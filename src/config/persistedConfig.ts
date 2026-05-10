// config/persistedConfig.ts
// 브라우저 IndexedDB에 저장되는 시뮬레이션 설정 — 새로고침 후에도 유지

import { TransferMode } from "@/common/vehicle/initialize/constants";
import type { RoutingStrategy, RoutingConfig, TransferRateConfig } from "@/store/simulation/fabConfigStore";
import { loadPersistedConfig, savePersistedConfig } from "./configDb";

export const PERSISTED_CONFIG_VERSION = 7;

/** Per-fab routing override (fabIndex → routing config) */
export type FabRoutingOverrides = Record<number, Partial<RoutingConfig>>;

export interface PersistedSimConfig {
  version: number;
  selectedSettingId: string;
  numVehicles: number;
  fabCountX: number;
  fabCountY: number;
  routing: {
    strategy: RoutingStrategy;
    bprAlpha: number;
    bprBeta: number;
    rerouteInterval: number;
    ewmaAlpha: number;
  };
  fabRoutingOverrides: FabRoutingOverrides;
  transfer: {
    enabled: boolean;
    mode: TransferMode;
    rate: TransferRateConfig;
  };
}

export const DEFAULT_SIM_CONFIG: PersistedSimConfig = {
  version: PERSISTED_CONFIG_VERSION,
  selectedSettingId: "Y_SHORT",
  numVehicles: 4800,
  fabCountX: 4,
  fabCountY: 6,
  routing: {
    strategy: "BPR",
    bprAlpha: 4,
    bprBeta: 8,
    rerouteInterval: 0,
    ewmaAlpha: 0.1,
  },
  fabRoutingOverrides: {
    // Row 0~1 (fabIndex 0~7): rerouteInterval=0 (도착시만, default)
    0: { strategy: "DISTANCE" },
    1: { strategy: "BPR", bprAlpha: 2, bprBeta: 8 },
    2: { strategy: "BPR", bprAlpha: 4, bprBeta: 8 },
    3: { strategy: "BPR", bprAlpha: 8, bprBeta: 8 },
    4: { strategy: "EWMA", ewmaAlpha: 0.05 },
    5: { strategy: "EWMA", ewmaAlpha: 0.1 },
    6: { strategy: "EWMA", ewmaAlpha: 0.15 },
    7: { strategy: "EWMA", ewmaAlpha: 0.2 },
    // Row 2~3 (fabIndex 8~15): rerouteInterval=5 (동일 전략을 5edge마다 재계산)
    8: { strategy: "DISTANCE", rerouteInterval: 5 },
    9: { strategy: "BPR", bprAlpha: 2, bprBeta: 8, rerouteInterval: 5 },
    10: { strategy: "BPR", bprAlpha: 4, bprBeta: 8, rerouteInterval: 5 },
    11: { strategy: "BPR", bprAlpha: 8, bprBeta: 8, rerouteInterval: 5 },
    12: { strategy: "EWMA", ewmaAlpha: 0.05, rerouteInterval: 5 },
    13: { strategy: "EWMA", ewmaAlpha: 0.1, rerouteInterval: 5 },
    14: { strategy: "EWMA", ewmaAlpha: 0.15, rerouteInterval: 5 },
    15: { strategy: "EWMA", ewmaAlpha: 0.2, rerouteInterval: 5 },
    // Row 4~5 (fabIndex 16~23): rerouteInterval=1 (매 edge 재계산)
    16: { strategy: "DISTANCE", rerouteInterval: 1 },
    17: { strategy: "BPR", bprAlpha: 2, bprBeta: 8, rerouteInterval: 1 },
    18: { strategy: "BPR", bprAlpha: 4, bprBeta: 8, rerouteInterval: 1 },
    19: { strategy: "BPR", bprAlpha: 8, bprBeta: 8, rerouteInterval: 1 },
    20: { strategy: "EWMA", ewmaAlpha: 0.05, rerouteInterval: 1 },
    21: { strategy: "EWMA", ewmaAlpha: 0.1, rerouteInterval: 1 },
    22: { strategy: "EWMA", ewmaAlpha: 0.15, rerouteInterval: 1 },
    23: { strategy: "EWMA", ewmaAlpha: 0.2, rerouteInterval: 1 },
  },
  transfer: {
    enabled: true,
    mode: { idlePolicy: "RANDOM_WALK" },
    rate: {
      mode: "utilization",
      utilizationPercent: 70,
      throughputPerHour: 4000,
    },
  },
};

// 로드된 config 캐시 (fabCountX/Y를 VehicleTest에서 읽기 위해)
let loadedConfig: PersistedSimConfig = DEFAULT_SIM_CONFIG;

export function getPersistedConfig(): PersistedSimConfig {
  return loadedConfig;
}

/**
 * 앱 시작 시 호출 — IndexedDB에서 설정 로드 → store hydrate
 * 최초 방문이면 DEFAULT_SIM_CONFIG로 시드
 */
export async function initConfigFromDb(): Promise<void> {
  const saved = await loadPersistedConfig();

  if (saved) {
    loadedConfig = saved;
  } else {
    loadedConfig = DEFAULT_SIM_CONFIG;
    await savePersistedConfig(DEFAULT_SIM_CONFIG);
  }

  // Zustand store hydrate (lazy import로 순환참조 방지)
  const { useVehicleTestStore } = await import("@/store/vehicle/vehicleTestStore");
  const { useFabConfigStore } = await import("@/store/simulation/fabConfigStore");

  useVehicleTestStore.setState({
    selectedSettingId: loadedConfig.selectedSettingId,
    numVehicles: loadedConfig.numVehicles,
  });

  // Global routing/transfer 설정
  useFabConfigStore.setState({
    routingConfig: loadedConfig.routing,
    transferEnabled: loadedConfig.transfer.enabled,
    transferModeConfig: loadedConfig.transfer.mode,
    transferRateConfig: loadedConfig.transfer.rate,
  });

  // Per-fab routing overrides
  if (loadedConfig.fabRoutingOverrides) {
    const store = useFabConfigStore.getState();
    for (const [fabIndexStr, routingOverride] of Object.entries(loadedConfig.fabRoutingOverrides)) {
      const fabIndex = Number(fabIndexStr);
      const existing = store.fabOverrides[fabIndex] ?? {};
      store.setFabOverride(fabIndex, { ...existing, routing: routingOverride });
    }
  }
}
