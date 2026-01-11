# shmSimulator/core - 시뮬레이션 엔진 핵심

Worker 내부에서 실행되는 시뮬레이션 엔진의 핵심 컴포넌트입니다. React/Zustand와 완전히 독립적으로 동작합니다.

## 개념 (왜 이렇게 설계했나)

### Worker 기반 독립 시뮬레이션

Main Thread는 렌더링과 UI만 담당하고, 모든 시뮬레이션 로직은 Worker에서 실행됩니다.

```
Main Thread                     Worker Thread (각각)
┌─────────────────┐            ┌─────────────────────────┐
│ React/Zustand   │            │ SimulationEngine (1개)  │
│ Three.js        │            │   └─ FabContext[]       │
│                 │            │      ├─ FabContext      │
│ READ ONLY       │            │      ├─ FabContext      │
│     ↓           │            │      └─ FabContext      │
│ SharedBuffer ◀──┼────────────┼────────────────────────  │
└─────────────────┘            └─────────────────────────┘
```

**구조:**
- **Worker 1개당 SimulationEngine 1개**
- **SimulationEngine 1개당 여러 FabContext 관리**
- 각 FabContext는 독립적인 매니저(LockMgr, TransferMgr, AutoMgr 등) 소유

**이유:**
- Main Thread의 렌더링 성능 보장 (60 FPS UI 유지)
- 시뮬레이션과 렌더링의 독립적인 FPS 관리
- 멀티 워커로 FAB 병렬 처리 가능

### FAB별 독립 컨텍스트

각 FAB은 **독립적인 평행우주**처럼 동작합니다. `FabContext`가 FAB 하나의 모든 것을 관리합니다.

**계층 구조:**

```
Worker 0 (worker.entry.ts)
└── engine: SimulationEngine (1개)
    └── fabContexts: Map<string, FabContext>
        ├── "fab_0_0" → FabContext
        │   ├── edges: Edge[]              ← edge0001, edge0002...
        │   ├── nodes: Node[]              ← (x, y) 좌표
        │   ├── EngineStore                ← SharedBuffer[0~999]
        │   ├── LockMgr                    ← 독립 인스턴스
        │   ├── TransferMgr                ← 독립 인스턴스
        │   ├── AutoMgr                    ← 독립 인스턴스
        │   ├── DispatchMgr                ← 독립 인스턴스
        │   └── RoutingMgr                 ← 독립 인스턴스
        │
        ├── "fab_0_1" → FabContext
        │   ├── edges: Edge[]              ← edge1001, edge1002...
        │   ├── nodes: Node[]              ← (x+110, y) 좌표
        │   ├── EngineStore                ← SharedBuffer[1000~1999]
        │   └── ...                        ← 독립적인 매니저들
        │
        └── "fab_0_2" → FabContext
            └── ...

Worker 1 (worker.entry.ts)
└── engine: SimulationEngine (1개)
    └── fabContexts: Map<string, FabContext>
        ├── "fab_1_0" → FabContext
        ├── "fab_1_1" → FabContext
        └── ...
```

**핵심:**
- **Worker 1개당 SimulationEngine 1개** (worker.entry.ts에서 생성)
- **SimulationEngine이 여러 FabContext 관리** (Map으로 저장)
- **각 FabContext는 독립적인 매니저 인스턴스 소유** (fab_0_0의 LockMgr ≠ fab_0_1의 LockMgr)

**이유:**
- FAB 간 완전한 격리 (한 FAB의 버그가 다른 FAB에 영향 없음)
- 각 FAB이 자신만의 맵 복사본에서 경로탐색 수행 (성능 향상)
- 멀티 워커 환경에서 FAB별 분산 처리 용이

### 메모리 영역 분리

멀티 워커 환경에서는 각 Worker가 SharedArrayBuffer의 특정 영역만 접근합니다.

```
SharedArrayBuffer (전체)
┌─────────────────┬─────────────────┬─────────────────┐
│ FAB 0 영역      │ FAB 1 영역      │ FAB 2 영역      │
│ [0~21999]       │ [22000~43999]   │ [44000~65999]   │
│ Worker 0 담당   │ Worker 0 담당   │ Worker 1 담당   │
└─────────────────┴─────────────────┴─────────────────┘
```

**이유:**
- 영역이 겹치지 않으므로 Atomics 불필요 (성능 향상)
- Worker 간 메모리 충돌 방지
- 각 Worker는 할당된 영역만 접근 (버그 방지)

### 맵 데이터 복제

#### 시뮬레이션 (Worker)
각 FAB은 **offset된 맵 복사본**을 가집니다. `SimulationEngine.calculateFabData()`가 원본 맵에서 FAB별 맵을 생성합니다.

```
원본 맵              fab_0 (복사)        fab_1 (복사+offset)
edge0001 (0,0)   →   edge0001 (0,0)      edge1001 (110,0)
node0001 (0,0)   →   node0001 (0,0)      node1001 (110,0)
```

**이유:**
- 각 FabContext가 자신의 맵에서 경로탐색/충돌감지 수행
- FAB별 독립적인 edge index 관리 (0~N)
- 시뮬레이션 코드가 FAB을 의식하지 않아도 됨 (단순화)

#### 렌더링 (Main Thread)
**원본 맵 1개 + Slot offset**으로 여러 FAB을 표시합니다 (메모리 절약).

```
originalMapData (1개)
    ↓
slots (최대 25개)
┌──────┬──────┬──────┐
│ fab0 │ fab1 │ fab2 │ ...
│ +0,0 │ +110 │ +220 │
└──────┴──────┴──────┘
```

**이유:**
- 맵 데이터 메모리 1벌만 사용 (절약)
- 렌더링 시 slot offset만 적용하면 됨 (간단)

---

## 코드 가이드 (API, 사용법)

### SimulationEngine

Worker 내부에서 실행되는 시뮬레이션 총괄 클래스입니다.

#### 주요 메서드

```typescript
class SimulationEngine {
  /**
   * 초기화 (Worker에서 호출됨)
   * @param payload - Main Thread에서 전달받은 초기화 데이터
   * @returns FAB별 실제 차량 수
   */
  init(payload: InitPayload): Record<string, number>

  /**
   * 시뮬레이션 시작 (60 FPS 내부 루프)
   */
  start(): void

  /**
   * 시뮬레이션 정지
   */
  stop(): void

  /**
   * 단일 시뮬레이션 스텝 (모든 FabContext.step() 호출)
   * @param delta - 프레임 간격 (초 단위)
   */
  step(delta: number): void

  /**
   * 특정 FAB에 명령 전달
   * @param fabId - FAB 식별자 (예: "fab_0_0")
   * @param command - 명령 객체
   */
  handleCommand(fabId: string, command: unknown): void

  /**
   * FAB 동적 추가
   */
  addFab(fabData: FabInitData, config: SimulationConfig): number

  /**
   * FAB 동적 제거
   */
  removeFab(fabId: string): boolean

  /**
   * 특정 FAB 컨텍스트 가져오기
   */
  getFabContext(fabId: string): FabContext | undefined
}
```

#### 초기화 흐름

```typescript
// worker.entry.ts
const engine = new SimulationEngine();

function handleInit(payload: InitPayload) {
  // 1. Engine 초기화
  const fabVehicleCounts = engine.init(payload);

  // 2. 내부적으로:
  //    - FabContext 생성 (각 FAB마다)
  //    - calculateFabData()로 맵 복제
  //    - SharedBuffer 영역 할당
  //    - 차량 초기화

  // 3. Main Thread에 완료 알림
  postMessage({
    type: "INITIALIZED",
    fabVehicleCounts
  });

  // 4. 시뮬레이션 시작
  engine.start();
}
```

#### 시뮬레이션 루프 (step() 호출 구조)

```typescript
// SimulationEngine 내부
start(): void {
  const targetInterval = 1000 / this.config.targetFps;  // 60 FPS → 16.67ms

  this.loopHandle = setInterval(() => {
    const now = performance.now();
    const realDelta = (now - this.lastStepTime) / 1000;
    this.lastStepTime = now;

    this.step(realDelta);  // ← SimulationEngine.step() 호출
  }, targetInterval);
}

// SimulationEngine.step() - 전체 엔진 업데이트
step(delta: number): void {
  const stepStart = performance.now();
  const clampedDelta = Math.min(delta, this.config.maxDelta);

  // 모든 FAB 업데이트 (순회)
  for (const context of this.fabContexts.values()) {
    context.step(clampedDelta);  // ← FabContext.step() 호출
  }

  // 성능 측정 및 통계 수집
  const stepEnd = performance.now();
  this.stepTimes.push(stepEnd - stepStart);
  this.reportPerfStats();  // 5초마다 통계 보고
}
```

**step() 호출 계층:**

```
Worker Thread (60 FPS setInterval)
    ↓
SimulationEngine.step(delta)              ← 엔진 전체 관리
    ├─ delta 클램핑 (최대값 제한)
    ├─ 성능 측정 시작
    │
    └─ for (const context of fabContexts.values()) {
           context.step(clampedDelta)     ← 각 FAB별 시뮬레이션
               │
               ├─ 1. checkCollisions()         (충돌 감지)
               ├─ 2. updateMovement()          (이동 업데이트)
               └─ 3. autoMgr.update()          (자동 라우팅)
       }
    │
    └─ 성능 통계 수집 및 Main Thread에 보고
```

**역할 분리:**
- `SimulationEngine.step()`: 모든 FAB 순회, 성능 측정, 통계 보고
- `FabContext.step()`: 개별 FAB의 실제 시뮬레이션 로직 (충돌→이동→라우팅)

---

### FabContext

FAB 하나의 시뮬레이션을 담당하는 핵심 클래스입니다.

#### 주요 속성

```typescript
class FabContext {
  // FAB 식별자
  public readonly fabId: string;

  // 메모리
  private readonly store: EngineStore;              // SharedBuffer 접근
  private readonly vehicleDataArray: VehicleDataArrayBase;
  private readonly sensorPointArray: SensorPointArrayBase;
  private readonly edgeVehicleQueue: EdgeVehicleQueue;

  // 맵 데이터 (offset된 복사본)
  private edges: Edge[];
  private nodes: Node[];
  private edgeNameToIndex: Map<string, number>;    // edge1001 → 0

  // 로직 매니저
  private readonly lockMgr: LockMgr;                // Merge 노드 잠금
  private readonly transferMgr: TransferMgr;        // 차량 이동 명령
  private readonly autoMgr: AutoMgr;                // 자동 라우팅
  private readonly dispatchMgr: DispatchMgr;        // 배차 관리
  public readonly routingMgr: RoutingMgr;           // 경로 계산

  // 런타임
  private actualNumVehicles: number;                // 실제 차량 수
}
```

#### 주요 메서드

```typescript
class FabContext {
  /**
   * 단일 시뮬레이션 스텝
   * @param clampedDelta - 프레임 간격 (초 단위, clamped)
   */
  step(clampedDelta: number): void

  /**
   * 외부 명령 처리 (MQTT/REST)
   */
  handleCommand(command: unknown): void

  /**
   * 실제 차량 수 반환
   */
  getActualNumVehicles(): number

  /**
   * 차량 데이터 배열 반환
   */
  getVehicleData(): Float32Array

  /**
   * 리소스 정리 (GC 대상)
   */
  dispose(): void
}
```

#### FabContext.step() 내부 동작

**SimulationEngine.step()에서 호출되며, 이 FAB의 실제 시뮬레이션을 수행합니다.**

```typescript
// FabContext.step() - 개별 FAB의 시뮬레이션 로직
step(clampedDelta: number): void {
  // 1. 충돌 감지 (Collision Check)
  const collisionCtx: CollisionCheckContext = {
    vehicleArrayData: this.vehicleDataArray.getData(),
    edgeArray: this.edges,
    edgeVehicleQueue: this.edgeVehicleQueue,
    sensorPointArray: this.sensorPointArray,
    config: this.config,
  };
  checkCollisions(collisionCtx);
  // → 앞차와의 거리 체크, 센서 충돌 감지
  // → 차량 상태를 MOVING/STOPPED/BLOCKED로 변경

  // 2. 이동 업데이트 (Movement Update)
  const movementCtx: MovementUpdateContext = {
    vehicleDataArray: this.vehicleDataArray,
    sensorPointArray: this.sensorPointArray,
    edgeArray: this.edges,
    actualNumVehicles: this.actualNumVehicles,
    vehicleLoopMap: this.vehicleLoopMap,
    edgeNameToIndex: this.edgeNameToIndex,
    store: {
      moveVehicleToEdge: this.store.moveVehicleToEdge.bind(this.store),
      transferMode: this.store.transferMode,
    },
    lockMgr: this.lockMgr,
    transferMgr: this.transferMgr,
    clampedDelta,
    config: this.config,
  };
  updateMovement(movementCtx);
  // → 속도/위치 업데이트 (가속/감속)
  // → edge 이동 처리 (edge 끝에 도달 시 다음 edge로)
  // → SharedBuffer에 쓰기 (Main Thread가 읽을 수 있도록)

  // 3. 자동 라우팅 (Auto Routing)
  this.autoMgr.update(
    this.store.transferMode,
    this.actualNumVehicles,
    this.vehicleDataArray,
    this.edges,
    this.edgeNameToIndex,
    this.transferMgr
  );
  // → 목적지 도착 확인
  // → 새 경로 자동 설정 (TransferMgr 큐에 추가)
}
```

**3단계 실행 순서 (중요):**
1. **충돌 감지 먼저**: 차량 상태 결정 (정지/감속 필요 여부)
2. **이동 업데이트**: 충돌 상태를 반영하여 위치/속도 갱신
3. **자동 라우팅 마지막**: 다음 프레임부터 적용될 경로 설정

---

### EngineStore

SharedArrayBuffer 접근을 래핑하는 클래스입니다. Zustand `vehicleArrayStore`를 대체합니다.

#### 주요 메서드

```typescript
class EngineStore implements IVehicleStore {
  /**
   * SharedArrayBuffer 설정 (하위호환: 전체 버퍼)
   */
  setSharedBuffer(buffer: SharedArrayBuffer): void

  /**
   * SharedArrayBuffer 설정 (멀티 워커: 영역 제한)
   */
  setSharedBufferWithRegion(
    buffer: SharedArrayBuffer,
    region: VehicleMemoryRegion
  ): void

  // 데이터 접근
  getVehicleDataArray(): VehicleDataArrayBase
  getEdgeVehicleQueue(): EdgeVehicleQueue
  getVehicleData(): Float32Array

  // 차량 속성
  setVehiclePosition(vehicleIndex: number, x: number, y: number, z: number): void
  getVehiclePosition(vehicleIndex: number): { x: number; y: number; z: number }
  setVehicleVelocity(vehicleIndex: number, velocity: number): void
  getVehicleVelocity(vehicleIndex: number): number
  setVehicleCurrentEdge(vehicleIndex: number, edgeIndex: number): void
  getVehicleCurrentEdge(vehicleIndex: number): number

  // Edge 큐 관리
  addVehicleToEdgeList(edgeIndex: number, vehicleIndex: number): void
  removeVehicleFromEdgeList(edgeIndex: number, vehicleIndex: number): void
  getVehiclesInEdge(edgeIndex: number): number[]

  // 차량 관리
  addVehicle(vehicleIndex: number, data: AddVehicleData): void
  removeVehicle(vehicleIndex: number): void
  moveVehicleToEdge(vehicleIndex: number, newEdgeIndex: number, edgeRatio?: number): void

  // 리소스 정리
  dispose(): void
}
```

#### 사용 예시

```typescript
// FabContext 내부
const store = new EngineStore(maxVehicles, maxEdges, true);

// SharedBuffer 설정 (멀티 워커)
store.setSharedBufferWithRegion(sharedBuffer, {
  offset: 0,
  size: 88000,
  maxVehicles: 1000
});

// 차량 데이터 접근
const vehicleData = store.getVehicleData();
const position = store.getVehiclePosition(0);
store.setVehicleVelocity(0, 5.0);

// Edge 큐 관리
store.addVehicleToEdgeList(edgeIndex, vehicleIndex);
const vehiclesInEdge = store.getVehiclesInEdge(edgeIndex);
```

---

## 초기화 흐름

```
Main Thread                  Worker Thread (worker.entry.ts)
     │                            │
     ├─ init() 호출               │
     │                            │
     ├─ Worker 생성               │
     ├─ SharedBuffer 할당         │
     │                            │
     ├─ postMessage(INIT) ────────▶ handleInit(payload)
     │                            │
     │                            ├─ engine = new SimulationEngine()  ← Worker당 1개
     │                            ├─ engine.init(payload)
     │                            │   │
     │                            │   ├─ for each fabData:
     │                            │   │   ├─ calculateFabData()  ← 맵 복제
     │                            │   │   ├─ new FabContext(params)  ← FAB별 생성
     │                            │   │   │   ├─ new EngineStore()
     │                            │   │   │   ├─ new LockMgr()       ← 독립 인스턴스
     │                            │   │   │   ├─ new TransferMgr()   ← 독립 인스턴스
     │                            │   │   │   ├─ new DispatchMgr()   ← 독립 인스턴스
     │                            │   │   │   ├─ new RoutingMgr()    ← 독립 인스턴스
     │                            │   │   │   ├─ new AutoMgr()       ← 독립 인스턴스
     │                            │   │   │   │
     │                            │   │   │   ├─ store.setSharedBufferWithRegion()
     │                            │   │   │   ├─ edgeNameToIndex 빌드
     │                            │   │   │   └─ initializeVehicles()
     │                            │   │   │
     │                            │   │   └─ fabContexts.set(fabId, context)
     │                            │   │
     │                            │   └─ return fabVehicleCounts
     │                            │
     │◀─────────────────────────── postMessage(INITIALIZED)
     │                            │
     │                            ├─ engine.start()  ← 60 FPS 루프 시작
     │                            │
     ▼                            ▼
```

**핵심:**
- Worker마다 `SimulationEngine` 1개 생성 (worker.entry.ts)
- `SimulationEngine.init()`에서 각 FAB마다 `FabContext` 생성
- 각 `FabContext`는 독립적인 매니저 인스턴스 소유

---

## 시뮬레이션 루프 (전체 흐름)

```
Worker Thread (60 FPS setInterval)
     │
     ├─ setInterval(16.67ms)
     │       │
     │       ├─ const delta = (now - lastTime) / 1000
     │       │
     │       ├─ SimulationEngine.step(delta)  ◄─ 엔진 전체 관리
     │       │       │
     │       │       ├─ const clampedDelta = Math.min(delta, maxDelta)
     │       │       ├─ 성능 측정 시작
     │       │       │
     │       │       ├─ for (const context of fabContexts.values()) {
     │       │       │       │
     │       │       │       ├─ FabContext.step(clampedDelta)  ◄─ FAB별 시뮬레이션
     │       │       │       │       │
     │       │       │       │       ├─ 1. checkCollisions()
     │       │       │       │       │      └─ 앞차 거리 체크, 센서 충돌 감지
     │       │       │       │       │         → MOVING/STOPPED/BLOCKED 상태 변경
     │       │       │       │       │
     │       │       │       │       ├─ 2. updateMovement()
     │       │       │       │       │      ├─ 속도/위치 업데이트 (충돌 상태 반영)
     │       │       │       │       │      ├─ edge 이동 처리
     │       │       │       │       │      └─ SharedBuffer에 쓰기
     │       │       │       │       │
     │       │       │       │       └─ 3. autoMgr.update()
     │       │       │       │              └─ 목적지 도착 시 새 경로 설정
     │       │       │       │
     │       │       │       └─ (다음 FabContext.step())
     │       │       │   }
     │       │       │
     │       │       ├─ 성능 측정 종료
     │       │       └─ reportPerfStats() (5초마다 통계 보고)
     │       │
     │       └─ (다음 프레임 대기)
     │
     ▼
```

**step() 호출 계층:**
- `SimulationEngine.step()`: 전체 FAB 순회 + 성능 측정
- `FabContext.step()`: 개별 FAB의 충돌→이동→라우팅 (3단계)

---

## 명령 처리 흐름

```
MQTT Broker
     │
     ├─ 차량 이동 명령
     ▼
Main Thread
     │
     ├─ mqttStore.onMessage()
     ├─ useShmSimulatorStore.sendCommand()
     ├─ MultiWorkerController.sendCommand(fabId, payload)
     │
     ├─ postMessage({ type: "COMMAND", fabId, payload })
     ▼
Worker Thread
     │
     ├─ handleCommand(fabId, payload)
     ├─ engine.handleCommand(fabId, payload)
     │       │
     │       ├─ context = fabContexts.get(fabId)
     │       ├─ context.handleCommand(payload)
     │       │       │
     │       │       ├─ routingMgr.receiveMessage(payload)
     │       │       │       │
     │       │       │       ├─ dispatchMgr.handleTransfer()
     │       │       │       │       │
     │       │       │       │       ├─ 경로 탐색 (Dijkstra)
     │       │       │       │       └─ transferMgr.startTransfer()
     │       │       │       │               │
     │       │       │       │               └─ 이동 큐에 추가
     │       │       │       │
     │       │       │       └─ (다음 프레임에서 실행)
     │       │       │
     │       │       └─ autoMgr.update()에서 transferMgr 큐 처리
     │       │
     │       └─ (다음 FabContext로)
     │
     ▼
```

---

## 개발 가이드

### 새로운 Manager 추가

```typescript
// 1. managers/NewMgr.ts 생성
export class NewMgr {
  init(): void { ... }
  update(context: Context): void { ... }
}

// 2. FabContext에 추가
class FabContext {
  private readonly newMgr: NewMgr;

  constructor(params: FabInitParams) {
    this.newMgr = new NewMgr();
  }

  step(delta: number): void {
    // ... 기존 로직

    // 4. step()에서 호출
    this.newMgr.update(context);
  }
}
```

### 메모리 레이아웃 변경

```typescript
// 1. VehicleDataArrayBase.ts 수정
export const OFFSET = {
  // ...
  CUSTOM_FIELD: 21,  // 새 필드 추가
} as const;

// 2. MemoryLayoutManager.ts 수정
private readonly VEHICLE_DATA_SIZE = 22;  // floats per vehicle

// 3. 관련 접근 메서드 추가
// EngineStore.ts
setCustomField(vehicleIndex: number, value: number): void {
  const ptr = vehicleIndex * VEHICLE_DATA_SIZE + OFFSET.CUSTOM_FIELD;
  this.vehicleDataArray.getData()[ptr] = value;
}
```

### 성능 측정

```typescript
// FabContext.ts
step(delta: number): void {
  const stepStart = performance.now();

  checkCollisions(collisionCtx);
  const collisionTime = performance.now() - stepStart;

  updateMovement(movementCtx);
  const movementTime = performance.now() - stepStart - collisionTime;

  this.autoMgr.update(...);
  const autoTime = performance.now() - stepStart - collisionTime - movementTime;

  const totalTime = performance.now() - stepStart;

  if (totalTime > 16.67) {  // 60 FPS 기준
    console.warn(`[${this.fabId}] Slow frame: ${totalTime.toFixed(2)}ms`);
    console.warn(`  collision: ${collisionTime.toFixed(2)}ms`);
    console.warn(`  movement: ${movementTime.toFixed(2)}ms`);
    console.warn(`  auto: ${autoTime.toFixed(2)}ms`);
  }
}
```

---

## 주의사항

### React 의존성 제거

Worker 내부에서는 React/Zustand를 사용할 수 없습니다.

```typescript
// ❌ Worker에서 금지
import { useStore } from "@/store/vehicleStore";
const edges = edgeStore.getState().edges;

// ✅ 모든 데이터는 init() payload로 전달
init(payload: InitPayload) {
  const edges = payload.fabs[0].edges;  // JSON 직렬화된 데이터
}
```

### 에러 처리

```typescript
// ❌ String(error) 사용 금지
worker.onerror = (error) => {
  console.log(String(error));  // '[object Object]'
};

// ✅ error.message 사용
worker.onerror = (error) => {
  if (error instanceof ErrorEvent) {
    console.log(error.message);
  }
};
```

### 반복문

```typescript
// ❌ forEach 금지
fabContexts.forEach((ctx) => ctx.step(delta));

// ✅ for...of 사용
for (const ctx of fabContexts.values()) {
  ctx.step(delta);
}
```

---

## 관련 문서

- [시뮬레이터 전체 개요](../README.md)
- [시스템 아키텍처](../../../doc/SYSTEM_ARCHITECTURE.md)
- [Multi-Worker Architecture](../../../doc/dev_req/MULTI_WORKER_ARCHITECTURE.md)
- [Vehicle 비즈니스 로직](../../common/vehicle/README.md)
