// Fab별 시뮬레이션 파라미터 오버라이드 스토어
import { create } from "zustand";
import {
  getLockWaitDistance,
  getLockRequestDistance,
  getLockGrantStrategy,
  getLinearMaxSpeed,
  getLinearAcceleration,
  getLinearDeceleration,
  getLinearPreBrakeDeceleration,
  getCurveMaxSpeed,
  getCurveAcceleration,
  type GrantStrategy,
} from "@/config/simulationConfig";

/**
 * Fab별로 오버라이드 가능한 Lock 설정
 */
export interface LockConfigOverride {
  waitDistance?: number;
  requestDistance?: number; // -1이면 진입 즉시 요청
  grantStrategy?: GrantStrategy;
}

export { type GrantStrategy };

/**
 * Fab별로 오버라이드 가능한 Movement 설정
 */
export interface MovementConfigOverride {
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
}

/**
 * Fab별로 오버라이드 가능한 전체 설정
 */
export interface FabConfigOverride {
  lock?: LockConfigOverride;
  movement?: MovementConfigOverride;
}

/**
 * 기본 설정 (simulationConfig에서 로드)
 */
export interface BaseSimulationConfig {
  lock: {
    waitDistance: number;
    requestDistance: number;
    grantStrategy: GrantStrategy;
  };
  movement: {
    linear: {
      maxSpeed: number;
      acceleration: number;
      deceleration: number;
      preBrakeDeceleration: number;
    };
    curve: {
      maxSpeed: number;
      acceleration: number;
    };
  };
}

interface FabConfigStore {
  // 기본 설정 (readonly, simulationConfig에서 로드)
  baseConfig: BaseSimulationConfig;

  // Fab별 오버라이드 (fabIndex -> override)
  fabOverrides: Record<number, FabConfigOverride>;

  // 모달 상태
  isModalOpen: boolean;

  // Actions
  setBaseConfig: (config: BaseSimulationConfig) => void;
  setFabOverride: (fabIndex: number, override: FabConfigOverride) => void;
  removeFabOverride: (fabIndex: number) => void;
  clearAllOverrides: () => void;
  setModalOpen: (open: boolean) => void;

  // Getters
  getFabConfig: (fabIndex: number) => {
    lock: { waitDistance: number; requestDistance: number; grantStrategy: GrantStrategy };
    movement: {
      linear: { maxSpeed: number; acceleration: number; deceleration: number; preBrakeDeceleration: number };
      curve: { maxSpeed: number; acceleration: number };
    };
  };
  hasOverride: (fabIndex: number) => boolean;

  // simulationConfig에서 baseConfig 동기화
  syncFromSimulationConfig: () => void;
}

/**
 * simulationConfig에서 현재 값을 가져와 BaseSimulationConfig 생성
 */
function loadBaseConfigFromSimulation(): BaseSimulationConfig {
  return {
    lock: {
      waitDistance: getLockWaitDistance(),
      requestDistance: getLockRequestDistance(),
      grantStrategy: getLockGrantStrategy(),
    },
    movement: {
      linear: {
        maxSpeed: getLinearMaxSpeed(),
        acceleration: getLinearAcceleration(),
        deceleration: getLinearDeceleration(),
        preBrakeDeceleration: getLinearPreBrakeDeceleration(),
      },
      curve: {
        maxSpeed: getCurveMaxSpeed(),
        acceleration: getCurveAcceleration(),
      },
    },
  };
}

export const useFabConfigStore = create<FabConfigStore>((set, get) => ({
  // 초기값: simulationConfig에서 로드 (JSON 로드 전이면 기본값 사용)
  baseConfig: loadBaseConfigFromSimulation(),

  fabOverrides: {},

  isModalOpen: false,

  setBaseConfig: (config) => {
    set({ baseConfig: config });
  },

  syncFromSimulationConfig: () => {
    set({ baseConfig: loadBaseConfigFromSimulation() });
  },

  setFabOverride: (fabIndex, override) => {
    set((state) => ({
      fabOverrides: {
        ...state.fabOverrides,
        [fabIndex]: override,
      },
    }));
  },

  removeFabOverride: (fabIndex) => {
    set((state) => {
      const newOverrides = { ...state.fabOverrides };
      delete newOverrides[fabIndex];
      return { fabOverrides: newOverrides };
    });
  },

  clearAllOverrides: () => {
    set({ fabOverrides: {} });
  },

  setModalOpen: (open) => {
    set({ isModalOpen: open });
  },

  /**
   * fab의 최종 config 반환 (baseConfig + override)
   */
  getFabConfig: (fabIndex) => {
    const { baseConfig, fabOverrides } = get();
    const override = fabOverrides[fabIndex];

    if (!override) {
      return baseConfig;
    }

    return {
      lock: {
        waitDistance: override.lock?.waitDistance ?? baseConfig.lock.waitDistance,
        requestDistance: override.lock?.requestDistance ?? baseConfig.lock.requestDistance,
        grantStrategy: override.lock?.grantStrategy ?? baseConfig.lock.grantStrategy,
      },
      movement: {
        linear: {
          maxSpeed: override.movement?.linear?.maxSpeed ?? baseConfig.movement.linear.maxSpeed,
          acceleration: override.movement?.linear?.acceleration ?? baseConfig.movement.linear.acceleration,
          deceleration: override.movement?.linear?.deceleration ?? baseConfig.movement.linear.deceleration,
          preBrakeDeceleration: override.movement?.linear?.preBrakeDeceleration ?? baseConfig.movement.linear.preBrakeDeceleration,
        },
        curve: {
          maxSpeed: override.movement?.curve?.maxSpeed ?? baseConfig.movement.curve.maxSpeed,
          acceleration: override.movement?.curve?.acceleration ?? baseConfig.movement.curve.acceleration,
        },
      },
    };
  },

  hasOverride: (fabIndex) => {
    return fabIndex in get().fabOverrides;
  },
}));
