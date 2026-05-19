// Parameter Map Preset — public/config/parameterMap/ JSON 로드 및 적용
import { useFabConfigStore, type RoutingConfig, type TransferRateConfig, type VehInitConfig } from "@/store/simulation/fabConfigStore";
import { useVehicleTestStore } from "@/store/vehicle/vehicleTestStore";
import { updatePersistedConfig } from "@/config/persistedConfig";
import { TransferMode } from "@/common/vehicle/initialize/constants";
import { useFabStatsUIStore } from "@/components/react/menu/panels/FabStats/store";
import {
  getLinearMaxSpeed,
  getLinearAcceleration,
  getLinearDeceleration,
  getLinearPreBrakeDeceleration,
  getCurveMaxSpeed,
  getCurveAcceleration,
  getLockWaitDistanceFromMergingStr,
  getLockRequestDistanceFromMergingStr,
  getLockWaitDistanceFromMergingCurve,
  getLockRequestDistanceFromMergingCurve,
  getLockGrantStrategy,
} from "@/config/worker/simulationConfig";

/** 프리셋 JSON 스키마 — 모든 필드 optional */
export interface ParameterPreset {
  name: string;
  description?: string;

  // ─── 레이아웃 (맵/fab/차량) ───
  /** testSettingConfig의 setting ID (맵 결정) */
  settingId?: string;
  numVehicles?: number;
  fabCountX?: number;
  fabCountY?: number;

  // ─── 시뮬레이션 파라미터 ───
  movement?: {
    linear?: {
      maxSpeed?: number;
      acceleration?: number;
      deceleration?: number;
      preBrakeDeceleration?: number;
    };
    curve?: {
      maxSpeed?: number;
      acceleration?: number;
    };
  };
  lock?: {
    waitDistanceFromMergingStr?: number;
    requestDistanceFromMergingStr?: number;
    waitDistanceFromMergingCurve?: number;
    requestDistanceFromMergingCurve?: number;
    grantStrategy?: string;
  };
  routing?: Partial<RoutingConfig>;
  fabRoutingOverrides?: Record<number, Partial<RoutingConfig>>;
  transfer?: {
    enabled?: boolean;
    mode?: TransferMode;
    rate?: Partial<TransferRateConfig>;
  };
  vehInit?: Partial<VehInitConfig>;

  // ─── 통계 그룹 ───
  groups?: { name: string; fabs: number[] }[];
}

const BASE_PATH = "/config/parameterMap";

// ─── IndexedDB: 마지막 선택 프리셋 파일명 저장 ───

const DB_NAME = "vps-preset";
const DB_VERSION = 1;
const STORE_NAME = "meta";
const ACTIVE_KEY = "activePresetFile";

let dbInstance: IDBDatabase | null = null;

function openPresetDb(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => { dbInstance = req.result; resolve(dbInstance); };
    req.onerror = () => reject(req.error);
  });
}

export async function saveActivePreset(fileName: string): Promise<void> {
  try {
    const db = await openPresetDb();
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(fileName, ACTIVE_KEY);
  } catch { /* 시크릿 모드 등 무시 */ }
}

export async function loadActivePreset(): Promise<string | null> {
  try {
    const db = await openPresetDb();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(ACTIVE_KEY);
      req.onsuccess = () => resolve(req.result as string | undefined ?? null);
      req.onerror = () => resolve(null);
    });
  } catch { return null; }
}

// ─── Preset 로드 ───

export async function loadParameterPresets(): Promise<{ fileName: string; preset: ParameterPreset }[]> {
  const res = await fetch(`${BASE_PATH}/index.json`);
  if (!res.ok) throw new Error(`Failed to load preset index: ${res.statusText}`);
  const fileNames: string[] = await res.json();

  const results = await Promise.all(
    fileNames.map(async (f) => {
      const r = await fetch(`${BASE_PATH}/${f}`);
      if (!r.ok) return null;
      const preset = await r.json() as ParameterPreset;
      return { fileName: f, preset };
    }),
  );
  return results.filter((r): r is { fileName: string; preset: ParameterPreset } => r !== null);
}

async function fetchPresetByFileName(fileName: string): Promise<ParameterPreset | null> {
  try {
    const r = await fetch(`${BASE_PATH}/${fileName}`);
    if (!r.ok) return null;
    return await r.json() as ParameterPreset;
  } catch { return null; }
}

/**
 * 앱 시작 시 호출 — IndexedDB에서 마지막 프리셋 읽기 → fetch → apply
 * 저장된 프리셋 없으면 아무것도 안 함
 */
export async function initPresetFromDb(): Promise<void> {
  const fileName = await loadActivePreset();
  if (!fileName) return;
  const preset = await fetchPresetByFileName(fileName);
  if (preset) applyPreset(preset);
}

// ─── Preset 적용 ───

/**
 * 프리셋 적용:
 * 1) 파라미터를 fabConfigStore에 세팅
 * 2) persistedConfig 업데이트 (fabCountX/Y, numVehicles)
 * 3) settingId가 있으면 requestSettingChange()로 기존 맵 로드 플로우 트리거
 */
export function applyPreset(preset: ParameterPreset): void {
  const store = useFabConfigStore.getState();

  // 1) Movement
  store.updateBaseMovement({
    linear: {
      maxSpeed: preset.movement?.linear?.maxSpeed ?? getLinearMaxSpeed(),
      acceleration: preset.movement?.linear?.acceleration ?? getLinearAcceleration(),
      deceleration: preset.movement?.linear?.deceleration ?? getLinearDeceleration(),
      preBrakeDeceleration: preset.movement?.linear?.preBrakeDeceleration ?? getLinearPreBrakeDeceleration(),
    },
    curve: {
      maxSpeed: preset.movement?.curve?.maxSpeed ?? getCurveMaxSpeed(),
      acceleration: preset.movement?.curve?.acceleration ?? getCurveAcceleration(),
    },
  });

  // 2) Lock
  store.setBaseConfig({
    ...store.baseConfig,
    lock: {
      waitDistanceFromMergingStr: preset.lock?.waitDistanceFromMergingStr ?? getLockWaitDistanceFromMergingStr(),
      requestDistanceFromMergingStr: preset.lock?.requestDistanceFromMergingStr ?? getLockRequestDistanceFromMergingStr(),
      waitDistanceFromMergingCurve: preset.lock?.waitDistanceFromMergingCurve ?? getLockWaitDistanceFromMergingCurve(),
      requestDistanceFromMergingCurve: preset.lock?.requestDistanceFromMergingCurve ?? getLockRequestDistanceFromMergingCurve(),
      grantStrategy: (preset.lock?.grantStrategy as "FIFO" | "BATCH") ?? getLockGrantStrategy(),
    },
  });

  // 3) Routing
  store.setRoutingConfig({
    strategy: preset.routing?.strategy ?? "BPR",
    bprAlpha: preset.routing?.bprAlpha ?? 4,
    bprBeta: preset.routing?.bprBeta ?? 8,
    bprGamma: preset.routing?.bprGamma ?? 0.2,
    rerouteInterval: preset.routing?.rerouteInterval ?? 0,
    ewmaAlpha: preset.routing?.ewmaAlpha ?? 0.1,
  });

  // 4) Transfer
  store.setTransferEnabled(preset.transfer?.enabled ?? true);
  store.setTransferModeConfig(
    preset.transfer?.mode ?? { idlePolicy: "RANDOM_WALK" } as TransferMode,
  );
  store.setTransferRateConfig({
    mode: preset.transfer?.rate?.mode ?? "utilization",
    utilizationPercent: preset.transfer?.rate?.utilizationPercent ?? 50,
    throughputPerHour: preset.transfer?.rate?.throughputPerHour ?? 4000,
  });

  // 5) Vehicle Init
  store.setVehInit({
    mode: preset.vehInit?.mode ?? "equal",
    perFabCounts: preset.vehInit?.perFabCounts ?? {},
    seedMode: preset.vehInit?.seedMode ?? "random",
    seed: preset.vehInit?.seed ?? 12345,
  });

  // 6) Per-fab routing overrides
  store.clearAllOverrides();
  if (preset.fabRoutingOverrides) {
    for (const [fabIndexStr, routingOverride] of Object.entries(preset.fabRoutingOverrides)) {
      store.setFabOverride(Number(fabIndexStr), { routing: routingOverride });
    }
  }

  // 7) 통계 그룹
  if (preset.groups) {
    const colors = ["#4ecdc4", "#f59e0b", "#8b5cf6", "#ef4444", "#22c55e", "#3b82f6", "#ec4899", "#14b8a6", "#f97316", "#6366f1"];
    useFabStatsUIStore.getState().setFabGroups(
      preset.groups.map((g, i) => ({
        id: `preset-${i}`,
        name: g.name,
        fabIndices: g.fabs,
        color: colors[i % colors.length],
      })),
    );
  }

  // 8) 레이아웃 변경 — persistedConfig 업데이트 후 기존 플로우 트리거
  if (preset.settingId) {
    if (preset.fabCountX !== undefined) updatePersistedConfig({ fabCountX: preset.fabCountX });
    if (preset.fabCountY !== undefined) updatePersistedConfig({ fabCountY: preset.fabCountY });
    if (preset.numVehicles !== undefined) updatePersistedConfig({ numVehicles: preset.numVehicles });

    // 기존 VehicleTest의 settingChangeSeq 플로우 사용
    // → cleanup → loadCFGFiles → applyFabGrid → 차량 생성 전부 기존 코드가 처리
    useVehicleTestStore.getState().requestSettingChange(preset.settingId);
  }
}
