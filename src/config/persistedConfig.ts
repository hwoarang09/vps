// config/persistedConfig.ts
// 시뮬레이션 기본 설정 — 프리셋이 런타임에 업데이트 가능

import { TransferMode } from "@/common/vehicle/initialize/constants";
import type { RoutingStrategy, RoutingConfig, TransferRateConfig } from "@/store/simulation/fabConfigStore";

/** Per-fab routing override (fabIndex → routing config) */
export type FabRoutingOverrides = Record<number, Partial<RoutingConfig>>;

export interface PersistedSimConfig {
  selectedSettingId: string;
  numVehicles: number;
  fabCountX: number;
  fabCountY: number;
  routing: {
    strategy: RoutingStrategy;
    bprAlpha: number;
    bprBeta: number;
    bprGamma: number;
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
  selectedSettingId: "Y_SHORT",
  numVehicles: 4800,
  fabCountX: 4,
  fabCountY: 6,
  routing: {
    strategy: "BPR",
    bprAlpha: 4,
    bprBeta: 8,
    bprGamma: 0.2,
    rerouteInterval: 0,
    ewmaAlpha: 0.1,
  },
  fabRoutingOverrides: {},
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

// 런타임에 프리셋이 업데이트하는 mutable config
let activeConfig: PersistedSimConfig = { ...DEFAULT_SIM_CONFIG };

export function getPersistedConfig(): PersistedSimConfig {
  return activeConfig;
}

/** 프리셋 등에서 부분 업데이트 */
export function updatePersistedConfig(patch: Partial<PersistedSimConfig>): void {
  activeConfig = { ...activeConfig, ...patch };
}

/**
 * 앱 시작 시 호출 — DEFAULT_SIM_CONFIG로 store hydrate
 */
export async function initConfig(): Promise<void> {
  activeConfig = { ...DEFAULT_SIM_CONFIG };

  const { useVehicleTestStore } = await import("@/store/vehicle/vehicleTestStore");
  const { useFabConfigStore } = await import("@/store/simulation/fabConfigStore");

  useVehicleTestStore.setState({
    selectedSettingId: activeConfig.selectedSettingId,
    numVehicles: activeConfig.numVehicles,
  });

  useFabConfigStore.setState({
    routingConfig: activeConfig.routing,
    transferEnabled: activeConfig.transfer.enabled,
    transferModeConfig: activeConfig.transfer.mode,
    transferRateConfig: activeConfig.transfer.rate,
  });
}
