# Shared Memory Simulator

공유 메모리(SharedArrayBuffer) 기반의 독립적인 차량 시뮬레이션 엔진입니다. React/Zustand에 의존하지 않으며, 웹 워커에서 실행되는 Headless Game Engine처럼 동작합니다.

## 불변조건 (Invariants)

### 메모리 관리
- **Worker 독립성**: 각 워커는 할당된 메모리 범위(`MemoryRegion`)만 접근한다
- **영역 간 격리**: 메모리 영역이 겹치지 않으므로 Atomics 불필요 (대부분의 경우)
- **레이아웃 일관성**: `core/`에 정의된 메모리 구조는 모든 모드에서 동일하다

### 동기화 메커니즘
- **프레임 원자성**: 모든 업데이트는 frame 단위로 원자성을 유지한다
- **Main Thread 읽기 전용**: Main Thread는 SharedArrayBuffer를 읽기만 한다

### 에러 처리
- **Worker 에러**: `String(error)` 대신 `error.message` 사용 필수 (CLAUDE.md)
- **ErrorEvent 처리**: `error.message`로 접근하여 '[object Object]' 방지

### React 독립성
- **절대 금지**: Worker 내부에서 React Hooks, Zustand Store 접근 금지
- **Snapshot Injection**: Main Thread에서 맵 데이터를 JSON으로 직렬화하여 전달

## 폴더 구조

```
src/shmSimulator/
├── types.ts                    # 타입 정의 (MemoryRegion, InitPayload 등)
├── worker.entry.ts             # Worker 진입점
├── index.ts                    # Main Thread 컨트롤러 래퍼
├── MemoryLayoutManager.ts      # 메모리 레이아웃 계산
├── MultiWorkerController.ts    # 멀티 워커 관리
│
├── core/
│   ├── SimulationEngine.ts     # 핵심 엔진 (모든 상태와 로직 보유)
│   ├── FabContext.ts           # Fab별 컨텍스트 (맵, 차량 관리)
│   ├── EngineStore.ts          # 공유 메모리 래퍼
│   └── initializeVehicles.ts   # 차량 초기화 로직
│
├── managers/
│   ├── DispatchMgr.ts          # 차량 배차 관리
│   └── RoutingMgr.ts           # 경로 계산 관리
│
├── systems/
│   └── (물리/충돌 시스템 - 향후 확장)
│
└── utils/
    └── (유틸리티 함수)
```

## 핵심 클래스

### `SimulationEngine` (Worker 내부)

모든 상태와 로직을 보유하는 신(God) 클래스입니다. 기존 `VehicleArrayMode` 컴포넌트와 Zustand Store가 하던 일을 모두 흡수합니다.

```typescript
export class SimulationEngine {
  // 메모리 & 상태 (Zustand 대체)
  private fabContexts = new Map<string, FabContext>();
  private config: SimulationConfig;

  // 로직 시스템
  private dispatchMgr: DispatchMgr;
  private routingMgr: RoutingMgr;

  // 런타임 상태
  private isRunning = false;
  private lastTime = 0;

  init(payload: InitPayload): Record<string, number> { ... }
  start(): void { ... }
  stop(): void { ... }
  step(delta: number): void { ... }
}
```

### `FabContext` (Fab별 컨텍스트)

각 Fab의 맵 데이터, 차량 데이터, 내부 자료구조를 관리합니다.

```typescript
export class FabContext {
  private store: EngineStore;          // 공유 메모리 래퍼
  private edges: Edge[] = [];
  private nodes: Node[] = [];
  private edgeMap = new Map<string, number>();

  init(params: FabInitParams): number { ... }
  step(delta: number): void { ... }
}
```

### `EngineStore` (메모리 래퍼)

`VehicleDataArrayBase`와 `SensorPointArrayBase`를 래핑하여 공유 메모리 접근을 제공합니다.

```typescript
export class EngineStore {
  private vehicleData: VehicleDataArrayBase;
  private sensorData: SensorPointArrayBase;

  setSharedBuffer(vehicleBuffer: Float32Array): void { ... }
  setSharedBufferWithRegion(
    vehicleBuffer: SharedArrayBuffer,
    vehicleRegion: MemoryRegion,
    sensorBuffer: SharedArrayBuffer,
    sensorRegion: MemoryRegion
  ): void { ... }
}
```

## 데이터 흐름

### 초기화 흐름

```
Main Thread (VehicleSharedMode.tsx)
    ↓
MultiWorkerController.init()
    ├─ MemoryLayoutManager.calculateLayout()
    ├─ new SharedArrayBuffer(totalSize)
    └─ Worker.postMessage({ type: "INIT", payload })
        ↓
Worker (worker.entry.ts)
    ↓
handleInit(payload)
    ↓
engine = new SimulationEngine()
engine.init(payload)
    ├─ Create FabContext for each fab
    ├─ fabContext.init(fabData)
    │   ├─ store.setSharedBuffer()
    │   ├─ Build edgeMap, nodeMap
    │   └─ initializeVehicles()
    └─ Return fabVehicleCounts
    ↓
postMessage({ type: "INITIALIZED", fabVehicleCounts })
```

### 시뮬레이션 루프

```
Worker (60 FPS internal loop)
    ↓
engine.step(delta)
    ↓
for each FabContext:
    fabContext.step(delta)
        ├─ updatePhysics(context)
        ├─ checkCollisions(context)
        ├─ updateMovement(context)
        └─ Write to SharedArrayBuffer
            ↓
Main Thread (requestAnimationFrame)
    ↓
Read from SharedArrayBuffer
    ↓
Update InstancedMesh matrices
    ↓
Three.js rendering
```

### 명령 처리

```
MQTT/REST API
    ↓
Main Thread
    ↓
MultiWorkerController.sendCommand(fabId, payload)
    ↓
worker.postMessage({ type: "COMMAND", fabId, payload })
    ↓
Worker
    ↓
engine.handleCommand(fabId, payload)
    ↓
fabContext.handleCommand(payload)
    ↓
Execute command logic
    ↓
Update SharedArrayBuffer
```

## 메모리 관리

### 멀티 워커 환경

```typescript
// MemoryLayoutManager가 계산
const layout = {
  totalSize: 352000000,  // bytes
  fabAssignments: {
    "fab_A": {
      vehicleRegion: { offset: 0, size: 88000000, maxVehicles: 100000 },
      sensorRegion: { offset: 0, size: 144000000, maxVehicles: 100000 }
    },
    "fab_B": {
      vehicleRegion: { offset: 88000000, size: 88000000, maxVehicles: 100000 },
      sensorRegion: { offset: 144000000, size: 144000000, maxVehicles: 100000 }
    }
  }
};

// Worker 1: fab_A 담당
const vehicleView = new Float32Array(
  sharedBuffer,
  layout.fabAssignments["fab_A"].vehicleRegion.offset,
  layout.fabAssignments["fab_A"].vehicleRegion.size / 4
);

// Worker 2: fab_B 담당
const vehicleView = new Float32Array(
  sharedBuffer,
  layout.fabAssignments["fab_B"].vehicleRegion.offset,
  layout.fabAssignments["fab_B"].vehicleRegion.size / 4
);
```

### 단일 워커 환경 (하위 호환)

```typescript
// memoryAssignment가 없으면 전체 버퍼 사용
fabContext.init({
  fabId: "fab_A",
  sharedBuffer: entireBuffer,  // 전체 버퍼
  // memoryAssignment: undefined (하위 호환)
});
```

## 사용 예시

### Main Thread에서 시뮬레이터 초기화

```typescript
import { MultiWorkerController } from "@/shmSimulator";

const controller = new MultiWorkerController();

await controller.init({
  fabs: [
    {
      fabId: "fab_A",
      sharedBuffer: vehicleBuffer,
      sensorPointBuffer: sensorBuffer,
      edges: edgesA,
      nodes: nodesA,
      vehicleConfigs: [{ acceleration: 3, deceleration: 5, maxSpeed: 5 }],
      numVehicles: 1000,
      transferMode: TransferMode.DISABLED
    }
  ],
  workerCount: 2,
  config: {
    maxVehicles: 200000,
    targetFps: 60,
    // ... 기타 설정
  }
});

controller.start();

// 특정 Fab의 Vehicle 데이터 읽기
const vehicleData = controller.getVehicleData("fab_A");
```

### Worker 내부에서 로직 추가

```typescript
// src/shmSimulator/core/FabContext.ts

step(delta: number): void {
  const context = {
    data: this.store.vehicleData.getData(),
    edges: this.edges,
    edgeMap: this.edgeMap,
    // ... 기타 컨텍스트
  };

  // 1. 물리 업데이트
  updatePhysics(context, delta);

  // 2. 충돌 감지
  checkCollisions(context);

  // 3. 이동 처리
  updateMovement(context, delta);

  // 결과는 자동으로 SharedArrayBuffer에 반영됨
}
```

## 개발 가이드

### 새로운 Manager 추가

1. `src/shmSimulator/managers/` 에 새 파일 생성
2. `SimulationEngine` 생성자에서 인스턴스 생성
3. `FabContext.step()` 내에서 호출

```typescript
// managers/NewMgr.ts
export class NewMgr {
  init(): void { ... }
  update(context: Context): void { ... }
}

// core/SimulationEngine.ts
constructor() {
  this.newMgr = new NewMgr();
}

init(payload: InitPayload) {
  this.newMgr.init();
}
```

### 메모리 레이아웃 변경

1. `src/common/vehicle/memory/VehicleDataArrayBase.ts` 수정
2. 모든 관련 offset 계산 업데이트
3. `MemoryLayoutManager.ts`의 `VEHICLE_DATA_SIZE` 상수 변경

```typescript
// 예: 새 필드 추가 (reserved4 → customField)
// VehicleDataArrayBase.ts
export const OFFSET = {
  // ...
  CUSTOM_FIELD: 21,  // 기존 reserved4
} as const;

// MemoryLayoutManager.ts
private readonly VEHICLE_DATA_SIZE = 22;  // floats per vehicle
```

### 성능 측정

```typescript
// FabContext.ts
step(delta: number): void {
  const startTime = performance.now();

  // ... 로직 실행

  const elapsedMs = performance.now() - startTime;
  if (elapsedMs > 16.67) {  // 60 FPS 기준
    console.warn(`[FabContext] Slow frame: ${elapsedMs.toFixed(2)}ms`);
  }
}
```

## 주의사항

### React 의존성 제거
- ❌ `import { useStore } from "@/store/vehicleStore"`
- ❌ `const edges = edgeStore.getState().edges`
- ✅ 모든 데이터는 `init()` 시 payload로 전달받음

### 에러 처리
```typescript
// ❌ 잘못된 에러 처리
worker.onerror = (error) => {
  console.log(String(error));  // '[object Object]'
};

// ✅ 올바른 에러 처리
worker.onerror = (error) => {
  if (error instanceof ErrorEvent) {
    console.log(error.message);
  }
};
```

### 반복문
```typescript
// ❌ forEach 사용 금지
vehicles.forEach((veh) => updateVehicle(veh));

// ✅ for...of 사용
for (const veh of vehicles) {
  updateVehicle(veh);
}

// ✅ index가 필요한 경우
for (const [index, veh] of vehicles.entries()) {
  updateVehicle(index, veh);
}
```

## 디버깅 팁

### Worker 콘솔 확인
Chrome DevTools > Sources > Worker 탭에서 Worker 콘솔을 별도로 확인할 수 있습니다.

### 메모리 덤프
```typescript
// Main Thread
const data = new Float32Array(sharedBuffer);
console.log("First vehicle:", data.slice(0, 22));

// Worker
const vehicleData = this.store.vehicleData.getData();
console.log("Vehicle 0:", vehicleData.slice(0, 22));
```

### 성능 프로파일링
```typescript
// FabContext.ts
const perfStats = {
  physics: 0,
  collision: 0,
  movement: 0
};

let start = performance.now();
updatePhysics(context);
perfStats.physics += performance.now() - start;

// 주기적으로 평균 출력
console.log("Avg physics:", (perfStats.physics / frameCount).toFixed(2), "ms");
```

## Worker-Main 통신

Worker와 Main Thread 간의 통신은 두 가지 방식으로 이루어집니다:

### 1. SharedArrayBuffer (고빈도 데이터)
차량 위치, 센서 포인트 등 60fps로 업데이트되는 데이터는 SharedArrayBuffer를 통해 공유합니다.

```
Worker: vehicleDataArray[ptr] = newPosition
                    ↓ (공유 메모리)
Main Thread: instancedMesh.matrix = vehicleDataArray[ptr]
```

### 2. postMessage (저빈도 이벤트)
에러, 성능 통계, 상태 변경 등 간헐적인 이벤트는 postMessage로 전달합니다.

| 메시지 타입 | 방향 | 용도 |
|------------|------|------|
| `INIT` | Main → Worker | 초기화 |
| `START/STOP` | Main → Worker | 시뮬레이션 제어 |
| `COMMAND` | Main → Worker | Fab별 명령 |
| `PERF_STATS` | Worker → Main | 성능 통계 (5초마다) |
| `ERROR` | Worker → Main | 에러 발생 |
| `UNUSUAL_MOVE` | Worker → Main | 비정상 이동 감지 |

## 에러 감지: UnusualMove

### 개요
차량이 연결되지 않은 edge로 이동하려 할 때 감지되는 에러입니다. 이 에러가 발생하면:
1. 시뮬레이션이 자동으로 중지됩니다
2. 화면에 상세 정보가 포함된 모달이 표시됩니다

### 감지 조건
```typescript
// src/common/vehicle/movement/edgeTransition.ts
if (currentEdge.to_node !== nextEdge.from_node) {
  // 이전 edge의 도착 노드와 다음 edge의 출발 노드가 다름
  // → 연결되지 않은 edge로 이동 시도
  onUnusualMove({ ... });
}
```

### 데이터 구조
```typescript
interface UnusualMoveData {
  vehicleIndex: number;      // 문제가 발생한 차량
  fabId: string;             // Fab ID
  prevEdge: {
    name: string;            // 이전 edge 이름
    toNode: string;          // 이전 edge의 도착 노드
  };
  nextEdge: {
    name: string;            // 다음 edge 이름
    fromNode: string;        // 다음 edge의 출발 노드
  };
  position: { x: number; y: number };  // 발생 위치
  timestamp: number;         // 시뮬레이션 시간 (ms)
}
```

### 이벤트 흐름
```
1. Worker: edgeTransition에서 감지
      ↓
2. Worker: postMessage({ type: "UNUSUAL_MOVE", data })
      ↓
3. Main: MultiWorkerController.onUnusualMove 콜백 호출
      ↓
4. Main: shmSimulatorStore에 상태 저장 + 시뮬레이션 중지
      ↓
5. React: UnusualMoveModal 렌더링
```

### 사용 예시
```typescript
// Store에서 UnusualMove 상태 확인
const unusualMove = useShmSimulatorStore((s) => s.unusualMove);

if (unusualMove) {
  console.log(`Vehicle ${unusualMove.vehicleIndex} attempted invalid transition`);
  console.log(`From: ${unusualMove.prevEdge.name} (to: ${unusualMove.prevEdge.toNode})`);
  console.log(`To: ${unusualMove.nextEdge.name} (from: ${unusualMove.nextEdge.fromNode})`);
}

// 상태 초기화
useShmSimulatorStore.getState().clearUnusualMove();
```

## 새로운 Worker → Main 이벤트 추가하기

1. **타입 정의** (`types.ts`)
```typescript
// MainMessage에 추가
| { type: "NEW_EVENT"; data: NewEventData };
```

2. **Worker에서 발생** (`FabContext.ts` 또는 관련 파일)
```typescript
globalThis.postMessage({ type: "NEW_EVENT", data: eventData });
```

3. **Controller에서 수신** (`MultiWorkerController.ts`)
```typescript
private onNewEventCallback: ((data: NewEventData) => void) | null = null;

onNewEvent(callback: (data: NewEventData) => void): void {
  this.onNewEventCallback = callback;
}

// handleWorkerMessage에서
case "NEW_EVENT":
  this.onNewEventCallback?.(message.data);
  break;
```

4. **Store에서 처리** (`shmSimulatorStore.ts`)
```typescript
controller.onNewEvent((data) => {
  set({ newEventData: data });
  // 필요시 추가 액션
});
```

## 관련 문서
- [시스템 전체 아키텍처](../../doc/README.md)
- [Multi-Worker Architecture](../../doc/dev_req/MULTI_WORKER_ARCHITECTURE.md)
- [Vehicle 비즈니스 로직](../common/vehicle/README.md)
