# Vehicle Store (State Management)

각 메모리 모드별 Vehicle 상태 관리를 담당하는 Zustand Store입니다. 3가지 모드(`arrayMode`, `shmMode`, `rapierMode`)의 외부 인터페이스를 통일하여 React 컴포넌트가 모드와 무관하게 동작할 수 있도록 합니다.

## 불변조건 (Invariants)

### 3가지 모드 구현
- **모드 필수성**: `arrayMode`, `shmMode`, `rapierMode` 중 하나는 항상 활성화되어야 함
- **공개 API 동일성**: 3가지 모드의 외부 인터페이스(함수 시그니처)는 완전히 동일해야 함
- **모드 전환 시 완전 정리**: 모드 변경 시 기존 모드의 모든 리소스를 완전히 정리해야 함

### 메모리 관리
- **지연 로딩**: Vehicle 생성은 demand-driven (미리 생성하지 않음)
- **메모리 정리**: Vehicle 제거 시 `common/vehicle/memory`에서 데이터 완전 제거
- **공유 메모리 격리**: `shmMode`의 SharedArrayBuffer는 Main Thread와 Worker만 공유

### 상태 동기화
- **단방향 데이터 흐름**: Store → Renderer (역방향 금지)
- **불변성 유지**: Zustand State는 immer를 통해 불변성 보장
- **Selector 최적화**: 불필요한 리렌더링 방지를 위해 selector 사용 필수

## 폴더 구조

```
src/store/vehicle/
├── vehicleGeneralStore.ts      # 공통 상태 (모드 독립적)
├── vehicleTestStore.ts         # 테스트용 Store
│
├── arrayMode/                  # JavaScript 배열 기반
│   ├── vehicleStore.ts         # Main store (Zustand)
│   ├── vehicleDataArray.ts     # Vehicle 데이터 배열
│   ├── sensorPointArray.ts     # Sensor 데이터 배열
│   ├── edgeVehicleQueue.ts     # Edge별 Vehicle 큐
│   └── sensorPresets.ts        # Sensor 프리셋 설정
│
├── shmMode/                    # 공유 메모리 기반
│   └── shmSimulatorStore.ts    # shmSimulator 제어 Store
│
└── rapierMode/                 # Rapier 물리엔진 기반
    └── vehicleStore.ts         # Rapier 전용 Store
```

## 모드별 구현

### 1. `arrayMode` - JavaScript 배열 기반

개발/테스트용 모드로, JavaScript 배열에 Vehicle 데이터를 저장합니다.

#### `vehicleStore.ts`
```typescript
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { VehicleDataArray } from "./vehicleDataArray";
import { SensorPointArray } from "./sensorPointArray";
import { EdgeVehicleQueue } from "./edgeVehicleQueue";

interface VehicleState {
  // 데이터 저장소
  vehicleData: VehicleDataArray;
  sensorData: SensorPointArray;
  queue: EdgeVehicleQueue;

  // 차량 수
  vehicleCount: number;

  // 액션
  initializeVehicles: (config: InitConfig) => void;
  updateVehicle: (vehId: number, updates: Partial<VehicleData>) => void;
  removeVehicle: (vehId: number) => void;
  reset: () => void;
}

export const useVehicleStore = create<VehicleState>()(
  immer((set, get) => ({
    vehicleData: new VehicleDataArray(200000),
    sensorData: new SensorPointArray(200000),
    queue: new EdgeVehicleQueue(),
    vehicleCount: 0,

    initializeVehicles: (config) => {
      set((state) => {
        // 차량 초기화 로직
        const { edges, numVehicles } = config;
        initializeVehicles({
          vehicleData: state.vehicleData,
          edges,
          numVehicles,
        });
        state.vehicleCount = numVehicles;
      });
    },

    updateVehicle: (vehId, updates) => {
      set((state) => {
        if (updates.position) {
          state.vehicleData.setPosition(vehId, ...updates.position);
        }
        if (updates.speed !== undefined) {
          state.vehicleData.setSpeed(vehId, updates.speed);
        }
        // ... 기타 업데이트
      });
    },

    removeVehicle: (vehId) => {
      set((state) => {
        state.vehicleData.remove(vehId);
        state.vehicleCount--;
      });
    },

    reset: () => {
      set((state) => {
        state.vehicleData.clear();
        state.sensorData.clear();
        state.queue.clear();
        state.vehicleCount = 0;
      });
    },
  }))
);
```

#### 사용 예시
```typescript
// React 컴포넌트에서
import { useVehicleStore } from "@/store/vehicle/arrayMode/vehicleStore";

const VehicleArrayMode = () => {
  const vehicleData = useVehicleStore((state) => state.vehicleData);
  const vehicleCount = useVehicleStore((state) => state.vehicleCount);
  const initializeVehicles = useVehicleStore((state) => state.initializeVehicles);

  useEffect(() => {
    initializeVehicles({ edges, numVehicles: 1000 });
  }, []);

  useFrame(() => {
    // 시뮬레이션 스텝
    updateMovement({ vehicleData, edges }, delta);
  });

  return (
    <VehicleArrayRenderer
      vehicleData={vehicleData}
      count={vehicleCount}
    />
  );
};
```

---

### 2. `shmMode` - 공유 메모리 기반

프로덕션 모드로, Web Worker와 SharedArrayBuffer를 사용합니다.

#### `shmSimulatorStore.ts`
```typescript
import { create } from "zustand";
import { MultiWorkerController } from "@/shmSimulator";

interface ShmSimulatorState {
  // 컨트롤러
  controller: MultiWorkerController | null;

  // 공유 메모리
  sharedBuffer: SharedArrayBuffer | null;
  sensorBuffer: SharedArrayBuffer | null;

  // 상태
  isInitialized: boolean;
  isRunning: boolean;
  vehicleCount: number;

  // 액션
  initialize: (config: InitConfig) => Promise<void>;
  start: () => void;
  stop: () => void;
  dispose: () => void;
  sendCommand: (fabId: string, command: VehicleCommand) => void;
}

export const useShmSimulatorStore = create<ShmSimulatorState>()(
  (set, get) => ({
    controller: null,
    sharedBuffer: null,
    sensorBuffer: null,
    isInitialized: false,
    isRunning: false,
    vehicleCount: 0,

    initialize: async (config) => {
      const controller = new MultiWorkerController();

      await controller.init({
        fabs: config.fabs,
        workerCount: config.workerCount ?? 2,
        config: config.simulationConfig,
      });

      set({
        controller,
        isInitialized: true,
        vehicleCount: config.fabs.reduce((sum, fab) => sum + fab.numVehicles, 0),
      });
    },

    start: () => {
      const { controller } = get();
      if (controller) {
        controller.start();
        set({ isRunning: true });
      }
    },

    stop: () => {
      const { controller } = get();
      if (controller) {
        controller.stop();
        set({ isRunning: false });
      }
    },

    dispose: () => {
      const { controller } = get();
      if (controller) {
        controller.dispose();
        set({
          controller: null,
          sharedBuffer: null,
          sensorBuffer: null,
          isInitialized: false,
          isRunning: false,
          vehicleCount: 0,
        });
      }
    },

    sendCommand: (fabId, command) => {
      const { controller } = get();
      if (controller) {
        controller.sendCommand(fabId, command);
      }
    },
  })
);
```

#### 사용 예시
```typescript
// React 컴포넌트에서
import { useShmSimulatorStore } from "@/store/vehicle/shmMode/shmSimulatorStore";

const VehicleSharedMemoryMode = ({ fabId }) => {
  const initialize = useShmSimulatorStore((state) => state.initialize);
  const start = useShmSimulatorStore((state) => state.start);
  const dispose = useShmSimulatorStore((state) => state.dispose);
  const controller = useShmSimulatorStore((state) => state.controller);

  useEffect(() => {
    initialize({
      fabs: [{ fabId, edges, nodes, numVehicles: 10000, ... }],
      workerCount: 2,
    }).then(() => {
      start();
    });

    return () => {
      dispose();
    };
  }, []);

  // SharedArrayBuffer에서 직접 읽기
  const sharedBuffer = controller?.getVehicleData(fabId);

  return (
    <VehiclesRenderer
      sharedBuffer={sharedBuffer}
      count={10000}
    />
  );
};
```

---

### 3. `rapierMode` - Rapier 물리엔진 기반

실험적 모드로, Rapier.js 물리 엔진을 사용합니다.

#### `vehicleStore.ts`
```typescript
import { create } from "zustand";
import { World, RigidBody } from "@dimforge/rapier3d-compat";

interface RapierVehicleState {
  // Rapier World
  world: World | null;

  // RigidBody 맵
  rigidBodies: Map<number, RigidBody>;

  // 차량 수
  vehicleCount: number;

  // 액션
  initializeWorld: () => Promise<void>;
  addVehicle: (vehId: number, position: [number, number, number]) => void;
  removeVehicle: (vehId: number) => void;
  step: (delta: number) => void;
  dispose: () => void;
}

export const useRapierVehicleStore = create<RapierVehicleState>()(
  (set, get) => ({
    world: null,
    rigidBodies: new Map(),
    vehicleCount: 0,

    initializeWorld: async () => {
      const RAPIER = await import("@dimforge/rapier3d-compat");
      await RAPIER.init();
      const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });

      set({ world });
    },

    addVehicle: (vehId, position) => {
      const { world } = get();
      if (!world) return;

      const rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(...position);
      const rigidBody = world.createRigidBody(rigidBodyDesc);

      set((state) => {
        state.rigidBodies.set(vehId, rigidBody);
        state.vehicleCount++;
      });
    },

    removeVehicle: (vehId) => {
      const { world, rigidBodies } = get();
      const body = rigidBodies.get(vehId);

      if (world && body) {
        world.removeRigidBody(body);
        rigidBodies.delete(vehId);
        set({ vehicleCount: rigidBodies.size });
      }
    },

    step: (delta) => {
      const { world } = get();
      if (world) {
        world.step();
      }
    },

    dispose: () => {
      const { world } = get();
      if (world) {
        world.free();
        set({
          world: null,
          rigidBodies: new Map(),
          vehicleCount: 0,
        });
      }
    },
  })
);
```

---

## 공통 인터페이스 (추상화)

모든 모드가 동일한 인터페이스를 제공하도록 추상화할 수 있습니다.

```typescript
// vehicleStoreInterface.ts
export interface VehicleStoreInterface {
  // 상태
  vehicleCount: number;
  isInitialized: boolean;

  // 액션
  initialize: (config: InitConfig) => Promise<void>;
  getVehiclePosition: (vehId: number) => [number, number, number];
  updateVehicle: (vehId: number, updates: Partial<VehicleData>) => void;
  dispose: () => void;
}

// 각 모드에서 이 인터페이스를 구현
```

---

## 모드 전환

```typescript
// vehicleGeneralStore.ts
import { create } from "zustand";

export enum VehicleMode {
  ARRAY = "array",
  SHM = "shm",
  RAPIER = "rapier",
}

interface VehicleGeneralState {
  currentMode: VehicleMode;
  setMode: (mode: VehicleMode) => void;
}

export const useVehicleGeneralStore = create<VehicleGeneralState>()(
  (set) => ({
    currentMode: VehicleMode.ARRAY,
    setMode: (mode) => set({ currentMode: mode }),
  })
);

// 컴포넌트에서
const VehicleSystem = () => {
  const currentMode = useVehicleGeneralStore((state) => state.currentMode);

  switch (currentMode) {
    case VehicleMode.ARRAY:
      return <VehicleArrayMode />;
    case VehicleMode.SHM:
      return <VehicleSharedMemoryMode />;
    case VehicleMode.RAPIER:
      return <VehicleRapierMode />;
  }
};
```

---

## 성능 최적화

### Selector 사용으로 리렌더링 최소화

```typescript
// ❌ 전체 상태 구독 (불필요한 리렌더링)
const store = useVehicleStore();

// ✅ 필요한 부분만 구독
const vehicleCount = useVehicleStore((state) => state.vehicleCount);
const vehicleData = useVehicleStore((state) => state.vehicleData);
```

### Shallow Comparison

```typescript
import { shallow } from "zustand/shallow";

// 여러 값을 한번에 구독할 때
const { vehicleCount, vehicleData } = useVehicleStore(
  (state) => ({
    vehicleCount: state.vehicleCount,
    vehicleData: state.vehicleData,
  }),
  shallow
);
```

### Immer 미들웨어로 불변성 보장

```typescript
import { immer } from "zustand/middleware/immer";

const useStore = create<State>()(
  immer((set) => ({
    // immer를 사용하면 draft 직접 수정 가능
    updateVehicle: (vehId, updates) => {
      set((state) => {
        state.vehicleData.setPosition(vehId, ...updates.position);
        // 불변성이 자동으로 보장됨
      });
    },
  }))
);
```

---

## 디버깅 팁

### Devtools 연결

```typescript
import { devtools } from "zustand/middleware";

const useVehicleStore = create<VehicleState>()(
  devtools(
    immer((set, get) => ({
      // ... store 구현
    })),
    { name: "VehicleStore" }
  )
);

// Redux DevTools에서 상태 확인 가능
```

### 상태 변화 로깅

```typescript
const useVehicleStore = create<VehicleState>()(
  immer((set, get) => ({
    updateVehicle: (vehId, updates) => {
      console.log(`[Store] Updating vehicle ${vehId}:`, updates);
      set((state) => {
        // ... 업데이트 로직
      });
    },
  }))
);
```

### 메모리 누수 체크

```typescript
useEffect(() => {
  const interval = setInterval(() => {
    console.log({
      vehicleCount: useVehicleStore.getState().vehicleCount,
      memoryUsage: performance.memory?.usedJSHeapSize,
    });
  }, 5000);

  return () => clearInterval(interval);
}, []);
```

---

## 주의사항

### 모드별 완전 정리
```typescript
// ✅ 모드 전환 시 기존 리소스 정리
useEffect(() => {
  // 초기화
  initialize();

  return () => {
    // 필수: dispose 호출
    dispose();
  };
}, [currentMode]);

// ❌ dispose 없이 모드 전환 (메모리 누수)
useEffect(() => {
  initialize();
  // return 없음
}, [currentMode]);
```

### Store 외부에서 상태 접근 금지
```typescript
// ❌ 직접 접근 (Zustand 추적 불가)
vehicleData.setPosition(0, 1, 2, 3);

// ✅ Store 액션 사용
updateVehicle(0, { position: [1, 2, 3] });
```

### 반복문 규칙 (CLAUDE.md)
```typescript
// ❌ forEach 금지
vehicles.forEach((veh) => updateVehicle(veh.id, veh));

// ✅ for...of 사용
for (const veh of vehicles) {
  updateVehicle(veh.id, veh);
}
```

---

## 관련 문서
- [시스템 전체 아키텍처](../../doc/README.md)
- [shmSimulator 사용법](../shmSimulator/README.md)
- [Vehicle 비즈니스 로직](../common/vehicle/README.md)
- [Three.js 렌더링](../components/three/README.md)

## 외부 라이브러리
- [Zustand](https://docs.pmnd.rs/zustand)
- [Immer](https://immerjs.github.io/immer/)
- [Rapier.js](https://rapier.rs/)
