# shmSimulator/core — 시뮬레이션 엔진 핵심

Worker 내부에서 실행되는 시뮬레이션 엔진. React/Zustand/Three.js와 완전히 독립.

---

## 1. 책임 분리

| 스레드 | 역할 | 코드 위치 |
|--------|------|----------|
| **Main** | 렌더링, UI, MQTT 송수신 | `components/three/`, `store/`, `mqttStore` |
| **Worker** | 물리/충돌/lock/라우팅 | `shmSimulator/`, `common/vehicle/` |
| **데이터 통로** | SharedArrayBuffer (zero-copy) | `MemoryLayoutManager` |

**postMessage는 명령/이벤트용, SharedArrayBuffer는 데이터용**. 매 프레임 수천 대 × 88 bytes 차량 데이터를 postMessage로 보내면 성능이 무너지므로, 위치/속도 같은 hot-path 데이터는 SAB 위에서 직접 read/write.

---

## 2. Worker ↔ FAB 매핑

```
Main Thread
  └─ MultiWorkerController
      ├─ MemoryLayoutManager.calculateLayout()      ← FabMemoryAssignment 산출
      ├─ MemoryLayoutManager.distributeToWorkers()  ← ceil(fabs/workers) 단위 연속 block
      │
      ├─ Worker 0 (worker.entry.ts)
      │   └─ SimulationEngine (1개)
      │       └─ fabContexts: Map<string, FabContext>
      │           ├─ "fab_0_0" → FabContext (매니저 5종 독립 인스턴스)
      │           ├─ "fab_0_1" → FabContext
      │           └─ ...
      │
      └─ Worker 1
          └─ SimulationEngine (1개)
              └─ ...
```

- **Worker당 SimulationEngine 1개** (`worker.entry.ts`에서 생성)
- **SimulationEngine당 FabContext N개** (Map 보관)
- **각 FabContext가 매니저 5종을 독자 소유**: `LockMgr`, `TransferMgr`, `AutoMgr`, `DispatchMgr`, `RoutingMgr` — FAB 간 완전 격리

---

## 3. 메모리 — 시뮬 버퍼 vs 렌더 버퍼 (2-layer)

| 버퍼 | 레이아웃 | 쓰는 쪽 | 읽는 쪽 |
|------|---------|---------|---------|
| **시뮬 버퍼** (4종, FabInitData 안) | FAB별 region 분리 (`FabMemoryAssignment`) | Worker (`FabContext.step`) | Worker |
| **렌더 버퍼** (`vehicleRenderBuffer`, `sensorRenderBuffer`) | 모든 FAB 연속 (전역 인덱스) | Worker (`writeToRenderRegion`, 매 스텝 끝) | Main (Three.js `useFrame`) |

**왜 2-layer로 나눴나**
- 시뮬: region 분리 → Worker 간 메모리 겹침 없음 → Atomics 불필요
- 렌더: 연속 레이아웃이어야 `InstancedMesh` attribute를 한 번에 업데이트 가능
- **fab 좌표 offset (`fabOffset.x/y`) 적용은 렌더 버퍼에 쓸 때만** — 시뮬은 원본 좌표를 그대로 사용

### 시뮬 버퍼 4종 (FAB별 region)

`FabInitData`에 SharedArrayBuffer 4개:

| 버퍼 | 내용 | 1차량당 크기 |
|------|------|------------|
| `sharedBuffer` | Vehicle 데이터 (위치/속도/edge ratio/status/...) | `VEHICLE_DATA_SIZE * 4 bytes` (22 floats) |
| `sensorPointBuffer` | Sensor 포인트 (충돌 감지용) | `SENSOR_DATA_SIZE * 4 bytes` |
| `pathBuffer` | 경로 (Dijkstra 결과) | `MAX_PATH_LENGTH * 4 bytes` (Int32) |
| `checkpointBuffer` | Lock checkpoint 리스트 | `CHECKPOINT_SECTION_SIZE * 4 bytes` |

각 버퍼는 `FabMemoryAssignment.{vehicle|sensor|path|checkpoint}Region`의 `{offset, size}`로 FAB별 region 분할. `MemoryLayoutManager.calculateLayout()`이 산출.

---

## 4. 맵 데이터 — `SharedMapRef` (zero-copy)

옛 구조는 FAB마다 맵을 복제했지만 (`edge1001`, `edge2001` 식 이름 변환), **현재는 모든 FAB이 같은 `edges`/`nodes` 배열을 참조**.

- Main → Worker로 `sharedMapData`를 **init 시 1회 postMessage**
- `SimulationEngine.buildSharedMapRef()`가 `SharedMapRef` 1개를 만들어 모든 `FabContext`에 동일 참조 주입
- edge_name 변환 **없음**. 시뮬은 원본 좌표를 그대로 사용
- FAB 간 시각적 분리는 `fabOffset = calculateFabOffset(col, row)`을 **렌더 버퍼 쓸 때만** 적용 (`writeToRenderRegion`)

```typescript
interface SharedMapRef {
  edges: Edge[];                                  // 원본 (FAB 공유)
  nodes: Node[];                                  // 원본 (FAB 공유)
  edgeNameToIndex: Map<string, number>;           // 공유 lookup
  nodeNameToIndex: Map<string, number>;
  stations: StationRawData[];
  waitRelocations?: Map<string, WaitRelocationEntry>;  // 변형 DZ wait relocation
}
```

레거시 모드 (`sharedMapRef` 없이 fab별 `edges`/`nodes` 받는 경로)도 코드에는 남아있지만 멀티-FAB 환경에서는 사실상 미사용.

---

## 5. SimulationEngine API

`core/SimulationEngine.ts` — Worker 내 시뮬레이션 총괄.

```typescript
class SimulationEngine {
  // === Lifecycle ===
  init(payload: InitPayload): Record<string, number>     // fabId → actualNumVehicles
  start(): void                                          // 60 FPS setInterval 시작
  stop(): void
  dispose(): void

  // === FAB 관리 ===
  addFab(fab: FabInitData, globalConfig: SimulationConfig): number
  removeFab(fabId: string): boolean
  getFabContext(fabId: string): FabContext | undefined
  getFabIds(): string[]
  forEachFab(fn: (ctx: FabContext) => void): void

  // === 메인 루프 ===
  step(delta: number): void                              // 각 FabContext.step() 호출

  // === 명령 처리 ===
  handleCommand(fabId: string, command: unknown): void

  // === 렌더 버퍼 분배 (Main → Worker) ===
  setRenderBuffers(
    vehicleRenderBuffer: SharedArrayBuffer,
    sensorRenderBuffer: SharedArrayBuffer,
    fabAssignments: FabRenderAssignment[],
    totalVehicles: number
  ): void

  // === 로깅 ===
  setLoggerPort(port: MessagePort, workerId: number): Promise<void>
  flushLogs(): void

  // === 통계 조회 ===
  getTotalVehicleCount(): number
  getVehicleCountsByFab(): Record<string, number>
  getSimulationTime(): number                            // ms 누적
  getLockTableData(fabId: string): LockTableData | null
}
```

### `init()` 흐름

```
1. payload.sharedMapData가 있으면 → buildSharedMapRef() 1회 호출 (모든 FAB 공유 참조)
2. payload.fabs 순회:
   a. fab별 config 병합: { ...globalConfig, ...fab.config }  (fab override 우선)
   b. calculateFabOffset(col, row)                            (렌더용 좌표 offset)
   c. params = { sharedBuffer, sensorPointBuffer, pathBuffer, checkpointBuffer,
                 sharedMapRef, fabOffset, memoryAssignment, config, ... }
   d. new FabContext(params) → fabContexts.set(fabId, ctx)
3. return fabVehicleCounts  // { fabId → actualNumVehicles }
```

### `step()` 내부

```typescript
step(delta: number): void {
  if (!this.isRunning) return;

  const clampedDelta = Math.min(delta, this.config.maxDelta);
  this.simulationTime += clampedDelta * 1000;             // ms 단위 누적

  for (const ctx of this.fabContexts.values()) {
    ctx.step(clampedDelta, this.simulationTime);          // simulationTime 전달
  }

  this.perfStats.addSample(stepTimeMs);                   // RollingPerformanceStats (5초 윈도우)
  if (now - lastPerfReportTime >= 5000) {
    this.reportPerfStats();                               // PERF_STATS postMessage
  }
}
```

---

## 6. FabContext API

`core/FabContext/index.ts` — FAB 1개의 시뮬레이션 + 렌더 버퍼 변환을 담당.

### 인스턴스 멤버

```typescript
class FabContext {
  // === 식별 / 설정 ===
  public readonly fabId: string;
  private readonly config: SimulationConfig;
  private actualNumVehicles: number;

  // === 시뮬 메모리 ===
  private readonly store: EngineStore;                    // sharedBuffer 래퍼
  private readonly vehicleDataArray: VehicleDataArrayBase;
  private readonly sensorPointArray: SensorPointArrayBase;
  private readonly edgeVehicleQueue: EdgeVehicleQueue;
  private checkpointArray: Float32Array | null;

  // === 렌더 메모리 (setRenderBuffer 후 할당) ===
  private vehicleRenderData: Float32Array | null;
  private sensorRenderData: Float32Array | null;
  private fabOffset: FabRenderOffset;                     // {x, y} 렌더 좌표 offset
  private sectionOffsets: SensorSectionOffsets | null;

  // === 맵 (sharedMapRef 참조 또는 fab 전용) ===
  private edges: Edge[];
  private nodes: Node[];
  private edgeNameToIndex: Map<string, number>;
  private readonly nodeNameToIndex: Map<string, number>;

  // === 매니저 5종 (FAB별 독립 인스턴스) ===
  private readonly lockMgr: LockMgr;
  private readonly transferMgr: TransferMgr;
  private readonly dispatchMgr: DispatchMgr;
  public  readonly routingMgr: RoutingMgr;                // public — handleCommand가 직접 호출
  private readonly autoMgr: AutoMgr;

  // === 라우팅 / 통계 (per-fab) ===
  private routingContext: RoutingContext;                 // BPR/EWMA config
  private readonly edgeStatsTracker: EdgeStatsTracker;    // EWMA 관측치

  // === 로깅 ===
  private simLogger: SimLogger | null;
  private snapshotLogger: SnapshotLogger | null;

  // === 런타임 상태 ===
  private readonly vehicleLoopMap: Map<number, VehicleLoop>;       // SIMPLE_LOOP 모드
  private readonly vehicleBayLoopMap: Map<number, VehicleBayLoop>; // LOOP 모드
  private readonly edgeEnterTimes: Map<number, number>;            // EWMA용
  private readonly collisionCheckTimers: Map<number, number>;
  private readonly curveBrakeCheckTimers: Map<number, number>;
}
```

### 메서드

```typescript
// 메인 루프
step(clampedDelta: number, simulationTime: number = 0): void

// 렌더 버퍼 연결 (Main → Worker, SET_RENDER_BUFFER 메시지 처리)
setRenderBuffer(
  vehicleRenderBuffer, sensorRenderBuffer,
  vehicleRenderOffset, actualVehicles,
  totalVehicles, vehicleStartIndex
): void

// 명령 처리 (MQTT/REST)
handleCommand(command: unknown): void                     // → routingMgr.receiveMessage

// 런타임 설정 변경
setTransferMode(mode), setTransferEnabled(b), setTransferRate(rateMode, ...)
updateMovementConfig({ linearMaxSpeed, linearAcceleration, ... })
updateRoutingConfig(strategy, bprAlpha?, bprBeta?, rerouteInterval?, ewmaAlpha?)

// 로깅
async setLoggerPort(port: MessagePort, workerId): Promise<void>
flushLogs(): void
resetOrderStats(simulationTime: number): void

// 조회 / 정리
getActualNumVehicles(): number
getVehicleData(): Float32Array
getLockTableData(): LockTableData
dispose(): void
```

### `step()` 흐름 — 7 단계

```
FabContext.step(clampedDelta, simulationTime)
  │
  └─ executeSimulationStep(ctx)  (simulation-step.ts)
      │
      ├─ 0. simLogger 콜백 등록 (lock 이벤트 logging hook)
      │
      ├─ 1. checkCollisions()             ← 앞차 거리·sensor 충돌 → MOVING/STOPPED/BLOCKED 결정
      │
      ├─ 2. lockMgr.updateAll()           ← merge node에서 멈출지 결정
      │                                       (checkpoint 처리 — REQ/WAIT/RELEASE/PREP)
      │
      ├─ 3. updateMovement()              ← 1·2에서 정지 안 된 차량만 이동
      │   ├─ 가속/감속/위치 적분
      │   ├─ edge 전환 (edge 끝 도달 시)
      │   └─ onEdgeTransit 콜백:
      │       ├─ edgeStatsTracker.observe(edgeIdx, transitSec)   ← EWMA 갱신
      │       └─ simLogger.logEdgeTransit / logTransfer
      │
      ├─ 4. autoMgr.update()              ← 목적지 도착 시 Dijkstra로 새 경로 (rerouteInterval)
      │
      ├─ 4.5. transferMgr.getPathChangedVehicles()
      │       └─ for each: lockMgr.processPathChange(vehId, info)
      │                                   ← 경로 바뀐 차량의 lock 재정합
      │                                     (orphan lock 정리, missed checkpoint 즉시 처리)
      │
      ├─ 5. Replay snapshot (simLogger.isReplayEnabled, 0.5s 주기 + 속도→0 전환 감지)
      └─ 6. Debug snapshot (snapshotLogger, 100ms 주기 — vehicle pos + active edge queues)

  (back in FabContext.step)
      ├─ 7. flushOrderStats(simulationTime)   ← 2초마다 ORDER_STATS postMessage
      └─ 8. writeToRenderRegion()             ← 시뮬 버퍼 → 렌더 버퍼 (+ fabOffset 적용)
```

---

## 7. EngineStore — `IVehicleStore` 구현체

`core/EngineStore.ts`. 옛 Zustand `vehicleArrayStore`를 대체. SAB region 위에 `VehicleDataArrayBase` + `EdgeVehicleQueue`를 래핑.

```typescript
class EngineStore implements IVehicleStore {
  // SAB 연결
  setSharedBuffer(buffer): void                                       // 전체 버퍼 (레거시)
  setSharedBufferWithRegion(buffer, region: VehicleMemoryRegion): void // 멀티 워커

  // 차량 CRUD
  addVehicle(idx, data), removeVehicle(idx)
  clearVehicleData(idx), clearAllVehicles()
  moveVehicleToEdge(idx, newEdgeIdx, edgeRatio?)

  // 차량 속성 (대부분 ops/* 함수에 위임)
  set/getVehiclePosition, set/getVehicleRotation, set/getVehicleVelocity
  set/getVehicleMovingStatus, set/getVehicleEdgeRatio, set/getVehicleCurrentEdge
  setVehicleAcceleration, setVehicleDeceleration

  // Edge 큐
  addVehicleToEdgeList, removeVehicleFromEdgeList
  getVehiclesInEdge, getEdgeVehicleCount

  // Public 속성 (FabContext가 직접 읽음)
  public actualNumVehicles: number
  public transferMode: TransferMode
  public transferEnabled: boolean
  public transferRateMode: 'utilization' | 'throughput'
  public transferUtilizationPercent: number
  public transferThroughputPerHour: number
}
```

---

## 8. 초기화 시퀀스

```
Main Thread                                        Worker Thread
─────────────                                      ─────────────
MultiWorkerController.start()
  ├─ MemoryLayoutManager.calculateLayout()             ← FabMemoryAssignment 산출
  ├─ MemoryLayoutManager.distributeToWorkers()         ← workerCount Worker 생성
  │
  ├─ for each worker:
  │   postMessage({ type: "INIT", payload }) ───────►  handleInit(payload)
  │                                                    │
  │                                                    ├─ engine = new SimulationEngine()
  │                                                    │
  │                                                    └─ engine.init(payload):
  │                                                        ├─ buildSharedMapRef(payload.sharedMapData)
  │                                                        │
  │                                                        └─ for each fabData:
  │                                                             ├─ calculateFabOffset(col, row)
  │                                                             └─ new FabContext(params)
  │                                                                  └─ initializeFab():
  │                                                                       ├─ store.setSharedBufferWithRegion(vehicleRegion)
  │                                                                       ├─ sensorPointArray.setBufferWithRegion(sensorRegion)
  │                                                                       ├─ transferMgr.setPathBufferFromAutoMgr(pathRegion)
  │                                                                       ├─ transferMgr.setCheckpointBuffer(checkpointRegion)
  │                                                                       ├─ edges/nodes ← sharedMapRef
  │                                                                       ├─ initializeVehicles(...)
  │                                                                       ├─ lockMgr.init(...) + preLockMergeNodes()
  │                                                                       └─ autoMgr.initStations(...)
  │
  │   ◄─────────────────────────────────────────────  postMessage({ type: "INITIALIZED", fabVehicleCounts })
  │
  ├─ MemoryLayoutManager.calculateRenderLayout(actualVehicles)
  │
  ├─ for each worker:
  │   postMessage({ type: "SET_RENDER_BUFFER", ... }) ► engine.setRenderBuffers(...)
  │                                                       └─ for each: ctx.setRenderBuffer(...)
  │
  └─ postMessage({ type: "START" }) ───────────────────► engine.start()
                                                            └─ setInterval(1000/targetFps, step)
```

---

## 9. 명령 처리 (MQTT → Worker)

```
MQTT Broker
   │ publish to VPS/cmd/{fabId}
   ▼
Main Thread
   ├─ mqttStore.onMessage()
   ├─ useShmSimulatorStore.sendCommand(fabId, payload)
   └─ MultiWorkerController.sendCommand(fabId, payload):
        workerIdx = fabToWorkerMap.get(fabId)
        workers[workerIdx].postMessage({ type: "COMMAND", fabId, payload })
   ▼
Worker (worker.entry.ts handleCommand)
   └─ engine.handleCommand(fabId, payload)
        └─ ctx = fabContexts.get(fabId)
           └─ ctx.handleCommand(payload)
              └─ routingMgr.receiveMessage(payload)
                 └─ dispatchMgr.handleTransfer():
                    ├─ Dijkstra 경로 탐색
                    └─ transferMgr.startTransfer() → 이동 큐 등록
                       (다음 step()의 autoMgr.update / movementUpdate에서 소비)
```

---

## 10. 주의사항

### React/Zustand 의존성 금지
Worker 코드 (`shmSimulator/` 하위)에서는 React hook / Zustand store 직접 import 금지. 모든 데이터는 `init(payload)` 또는 message로 전달.

### 매니저 위치
- **공통** (어느 스레드에서도 import 가능): `common/vehicle/logic/{LockMgr,TransferMgr,AutoMgr,Dijkstra}/`
- **Worker 전용** (공통 매니저를 묶는 layer): `shmSimulator/managers/{DispatchMgr,RoutingMgr}.ts`

### Edge index — 1-based vs 0-based
- SHM 안의 `CURRENT_EDGE` / `NEXT_EDGE`: **1-based** (`0` = sentinel "없음")
- `edges[]` 배열 직접 접근: **0-based**
- 권장: `getEdgeByIndex(idx)` 사용 (내부에서 `edges[idx-1]` 처리)

### 반복문
`for (const ctx of map.values())` 사용. hot path에서는 `Map.forEach`보다 V8 인라이닝이 안정적.

### Error 객체 직렬화
Worker에서 Main으로 에러 전송 시 `error.message` 사용. `String(error)`는 `[object Object]`로 깨짐.

---

## 11. 관련 문서

- [SYSTEM_ARCHITECTURE](../../../doc/SYSTEM_ARCHITECTURE.md)
- [LockMgr 상세](../../common/vehicle/logic/LockMgr/README.md)
- [Vehicle Memory Layout](../../common/vehicle/memory/README.md)
- [MemoryLayoutManager](../MemoryLayoutManager.ts) — FAB별 region 분할 로직
