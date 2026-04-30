// config/configDb.ts
// IndexedDB 기반 설정 persistence — 외부 라이브러리 없이 native API 사용

import { type PersistedSimConfig, DEFAULT_SIM_CONFIG, PERSISTED_CONFIG_VERSION } from './persistedConfig';

const DB_NAME = "vps-sim-config";
const DB_VERSION = 1;
const STORE_NAME = "config";
const CONFIG_KEY = "current";

let dbInstance: IDBDatabase | null = null;

function openConfigDb(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => {
      dbInstance = request.result;
      resolve(dbInstance);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

export async function loadPersistedConfig(): Promise<PersistedSimConfig | null> {
  try {
    const db = await openConfigDb();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(CONFIG_KEY);
      req.onsuccess = () => {
        const data = req.result as PersistedSimConfig | undefined;
        if (data && data.version === PERSISTED_CONFIG_VERSION) {
          resolve(data);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function savePersistedConfig(config: PersistedSimConfig): Promise<void> {
  try {
    const db = await openConfigDb();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.put(config, CONFIG_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // IndexedDB 불가 환경 (시크릿 모드 등) — 무시
  }
}

export async function patchPersistedConfig(patch: Partial<PersistedSimConfig>): Promise<void> {
  try {
    const current = await loadPersistedConfig();
    const merged = { ...(current ?? DEFAULT_SIM_CONFIG), ...patch };

    // nested object deep merge
    if (patch.routing && current?.routing) {
      merged.routing = { ...current.routing, ...patch.routing };
    }
    if (patch.transfer && current?.transfer) {
      merged.transfer = {
        ...current.transfer,
        ...patch.transfer,
        rate: { ...current.transfer.rate, ...(patch.transfer.rate ?? {}) },
      };
    }

    await savePersistedConfig(merged as PersistedSimConfig);
  } catch {
    // 무시
  }
}
