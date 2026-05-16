// store/ui/logSettingsStore.ts
// 로그 설정 store — 시뮬레이션 시작 전 어떤 로그를 남길지 구성한다.
// 값은 시뮬 시작 시 SimulationConfig.logEvents 로 워커에 전달된다.
//
// 설정은 "런 시작 전" 설정이다. SimLogger 생성자에서 enabledEvents 가
// 한 번 확정되므로 (SimLogger.ts) 런 도중 토글은 반영되지 않는다.

import { create } from "zustand";
import type { LogEvents } from "@/logger";

/** LogEvents 의 모든 이벤트 키 */
export type LogEventKey = keyof LogEvents;

/** 로그 그룹 정의 — UI 의 3그룹(+snapshot) 체크박스가 이 매핑을 쓴다 */
export interface LogGroup {
  label: string;
  desc: string;
  events: LogEventKey[];
}

/**
 * 그룹 매핑
 * - basic   : throughput/cycle KPI. 거의 공짜, 평소에도 켤 만함
 * - ml      : ML 학습 데이터셋 (edge cost 예측 프로젝트)
 * - dev     : 디버그 전용, 무거움 — 개발할 때만 켠다
 * - snapshot: replay 스냅샷. 단연 제일 무거움 → 독립 토글
 */
export const LOG_GROUPS: Record<string, LogGroup> = {
  basic: {
    label: "기본",
    desc: "throughput / cycle time KPI",
    events: ["orderComplete"],
  },
  ml: {
    label: "ML",
    desc: "ML edge cost 학습 데이터",
    events: ["edgeTransit", "lock"],
  },
  dev: {
    label: "개발",
    desc: "디버그 전용 (무거움)",
    events: ["vehState", "path", "lockDetail", "transfer", "edgeQueue", "checkpoint"],
  },
  snapshot: {
    label: "Snapshot",
    desc: "replay 스냅샷 (매우 무거움)",
    events: ["replaySnapshot"],
  },
};

/** 이벤트 키별 사람이 읽는 라벨 (세부 토글 표시용) */
export const LOG_EVENT_LABELS: Record<LogEventKey, string> = {
  orderComplete: "Order Complete",
  edgeTransit: "Edge Transit",
  lock: "Lock",
  replaySnapshot: "Replay Snapshot",
  vehState: "Vehicle State",
  path: "Path",
  lockDetail: "Lock Detail",
  transfer: "Transfer",
  edgeQueue: "Edge Queue",
  checkpoint: "Checkpoint",
};

/** 기본값: 기본 + ML 그룹 on, 개발 + snapshot off */
const DEFAULT_EVENTS: Required<LogEvents> = {
  orderComplete: true,
  edgeTransit: true,
  lock: true,
  replaySnapshot: false,
  vehState: false,
  path: false,
  lockDetail: false,
  transfer: false,
  edgeQueue: false,
  checkpoint: false,
};

const STORAGE_KEY = "vps.logSettings";

interface PersistedState {
  logEvents: Required<LogEvents>;
  logSessionNote: string;
}

function loadPersisted(): PersistedState {
  const fallback: PersistedState = {
    logEvents: { ...DEFAULT_EVENTS },
    logSessionNote: "",
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    return {
      // 저장 안 된/신규 키는 기본값으로 채운다
      logEvents: { ...DEFAULT_EVENTS, ...(parsed.logEvents ?? {}) },
      logSessionNote: parsed.logSessionNote ?? "",
    };
  } catch {
    return fallback;
  }
}

function persist(state: PersistedState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* localStorage 불가 — 무시 */
  }
}

/** 그룹 체크 상태 — 전체 on / 일부만 on / 전체 off */
export type GroupCheckState = "all" | "some" | "none";

export function getGroupState(events: Required<LogEvents>, groupKey: string): GroupCheckState {
  const group = LOG_GROUPS[groupKey];
  if (!group) return "none";
  const onCount = group.events.filter((e) => events[e]).length;
  if (onCount === 0) return "none";
  if (onCount === group.events.length) return "all";
  return "some";
}

interface LogSettingsState {
  /** 이벤트별 on/off — 워커로 전달되는 source of truth */
  logEvents: Required<LogEvents>;
  /** 로그 세션 메모 (sessionId 에 붙음) */
  logSessionNote: string;

  /** 이벤트 하나 토글 */
  setEvent: (key: LogEventKey, on: boolean) => void;
  /** 그룹 전체 토글 — 그룹 내 모든 이벤트를 on/off */
  setGroup: (groupKey: string, on: boolean) => void;
  /** 세션 메모 설정 */
  setSessionNote: (note: string) => void;
  /** 기본값으로 리셋 */
  resetDefaults: () => void;
}

export const useLogSettingsStore = create<LogSettingsState>((set, get) => {
  const initial = loadPersisted();

  const save = () => {
    const { logEvents, logSessionNote } = get();
    persist({ logEvents, logSessionNote });
  };

  return {
    logEvents: initial.logEvents,
    logSessionNote: initial.logSessionNote,

    setEvent: (key, on) => {
      set((s) => ({ logEvents: { ...s.logEvents, [key]: on } }));
      save();
    },

    setGroup: (groupKey, on) => {
      const group = LOG_GROUPS[groupKey];
      if (!group) return;
      set((s) => {
        const next = { ...s.logEvents };
        for (const e of group.events) next[e] = on;
        return { logEvents: next };
      });
      save();
    },

    setSessionNote: (note) => {
      set({ logSessionNote: note });
      save();
    },

    resetDefaults: () => {
      set({ logEvents: { ...DEFAULT_EVENTS }, logSessionNote: "" });
      save();
    },
  };
});
