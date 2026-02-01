# Shared Memory Simulator - AI Context

## File Map
```yaml
src/shmSimulator/types.ts
  purpose: 타입 정의 및 Worker-Main 메시지 프로토콜

  message types:
    WorkerMessage (Main → Worker):
      - INIT, START, STOP, PAUSE, RESUME, DISPOSE
      - COMMAND, SET_RENDER_BUFFER, SET_LOGGER_PORT
      - ADD_FAB, REMOVE_FAB, GET_LOCK_TABLE

    MainMessage (Worker → Main):
      - READY, INITIALIZED, DISPOSED, ERROR
      - PERF_STATS, FAB_ADDED, FAB_REMOVED
      - LOCK_TABLE, UNUSUAL_MOVE

  key types:
    UnusualMoveData: 연결되지 않은 edge 이동 감지 이벤트
    SimulationConfig: 시뮬레이션 설정 (속도, Lock 거리 등)
    FabInitData: Fab 초기화 데이터

src/shmSimulator/worker.entry.ts
  purpose: Worker 진입점, 메시지 라우팅

  handlers:
    handleInit → engine.init()
    handleStart → engine.start()
    handleStop → engine.stop()
    handleCommand → engine.handleCommand()

src/shmSimulator/MultiWorkerController.ts
  purpose: Main Thread에서 Worker 관리

  callbacks:
    onPerfStats: 성능 통계 수신
    onError: 에러 수신
    onUnusualMove: 비정상 이동 감지

  methods:
    init(fabs, config) → Worker 생성 및 초기화
    start/stop/pause/resume → 시뮬레이션 제어
    sendCommand(fabId, payload) → Fab별 명령 전송
    getLockTableData(fabId) → Lock 상태 조회

src/shmSimulator/core/SimulationEngine.ts
  purpose: Worker 내부 엔진, Fab 컨텍스트 관리

  key methods:
    init(payload) → FabContext 생성
    step(delta) → 모든 Fab 업데이트
    setRenderBuffers() → 렌더 버퍼 연결

src/shmSimulator/core/FabContext.ts:564
  purpose: Fab별 시뮬레이션 컨텍스트

  step(delta, simulationTime):
    1. checkCollisions()
    2. autoMgr.update()
    3. updateMovement() ← onUnusualMove 콜백 전달
    4. writeToRenderRegion()

  onUnusualMove callback:
    - 비정상 edge 전환 감지 시 호출
    - globalThis.postMessage({ type: "UNUSUAL_MOVE", data })

src/common/vehicle/movement/edgeTransition.ts
  purpose: Edge 전환 로직 (공유 코드)

  UnusualMove detection (L203-222):
    if (currentEdge.to_node !== nextEdge.from_node):
      → onUnusualMove 콜백 호출
      → 연결되지 않은 edge 간 이동 감지

  interface:
    UnusualMoveEvent: { vehicleIndex, prevEdgeName, prevEdgeToNode, nextEdgeName, nextEdgeFromNode, posX, posY }
    OnUnusualMoveCallback: (event) => void

src/store/vehicle/shmMode/shmSimulatorStore.ts
  purpose: Zustand store, 시뮬레이션 상태 관리

  state:
    controller: MultiWorkerController | null
    isRunning, isInitialized: boolean
    unusualMove: UnusualMoveData | null  # 비정상 이동 정보

  actions:
    initMultiFab → controller.onUnusualMove() 콜백 등록
    clearUnusualMove → unusualMove = null

  onUnusualMove callback (L155-159):
    set({ unusualMove: data })
    controller.stop()  # 자동 시뮬레이션 중지
    set({ isRunning: false })

src/components/three/overlays/UnusualMoveModal.tsx
  purpose: UnusualMove 발생 시 모달 표시

  displays:
    - Vehicle Index, Fab ID, Position
    - Previous Edge (name, to_node)
    - Next Edge (name, from_node)
    - Error explanation
```

## Worker-Main Communication Flow

### UnusualMove Event Flow
```
Worker Thread (FabContext.step)
    ↓
movementUpdate() with onUnusualMove callback
    ↓
edgeTransition.handleEdgeTransition()
    ↓
if (currentEdge.to_node !== nextEdge.from_node):
    onUnusualMove({ vehicleIndex, prevEdge, nextEdge, position })
    ↓
globalThis.postMessage({ type: "UNUSUAL_MOVE", data })
    ↓
Main Thread (MultiWorkerController.handleWorkerMessage)
    ↓
onUnusualMoveCallback(data)
    ↓
shmSimulatorStore:
    - set({ unusualMove: data })
    - controller.stop()
    ↓
UnusualMoveModal renders
```

### Standard Message Flow
```
Main → Worker:
  controller.start() → postMessage({ type: "START" })
  controller.sendCommand(fabId, payload) → postMessage({ type: "COMMAND", fabId, payload })

Worker → Main:
  engine.step() 완료 → PERF_STATS 주기적 전송
  에러 발생 → postMessage({ type: "ERROR", error })
  비정상 이동 → postMessage({ type: "UNUSUAL_MOVE", data })
```

## Data Flow Patterns

### SharedArrayBuffer Read/Write
```
Worker (write):
  FabContext.step()
    → vehicleDataArray.getData()[ptr + offset] = value
    → writeToRenderRegion() with fabOffset

Main Thread (read-only):
  VehicleArrayRenderer.useFrame()
    → shmSimulatorStore.getVehicleData()
    → instancedMesh.instanceMatrix 업데이트
```

### Callback Registration Pattern
```typescript
// MultiWorkerController
controller.onPerfStats((stats) => { ... });
controller.onError((error) => { ... });
controller.onUnusualMove((data) => { ... });

// 내부에서 handleWorkerMessage에서 콜백 호출
switch (message.type) {
  case "UNUSUAL_MOVE":
    this.onUnusualMoveCallback?.(message.data);
    break;
}
```

## Critical Rules

**Worker → Main 통신:**
- 고빈도 데이터 (위치) → SharedArrayBuffer 사용
- 저빈도 이벤트 (에러, 상태변경) → postMessage 사용
- 콜백은 항상 optional chaining (?.) 사용

**에러 처리:**
- Worker 내부 에러 → try-catch + postMessage({ type: "ERROR" })
- UnusualMove → 시뮬레이션 자동 중지 + 모달 표시
- Main Thread에서 controller.stop() 호출

**Store 상태 동기화:**
```typescript
// onUnusualMove 콜백에서
set({ unusualMove: data });  // 상태 저장 먼저
controller.stop();            // 그 다음 중지
set({ isRunning: false });    // 마지막 상태 업데이트
```

**React 컴포넌트 (UnusualMoveModal):**
- Store 구독: `useShmSimulatorStore((s) => s.unusualMove)`
- 조건부 렌더링: `if (!unusualMove) return null`
- 닫기 시: `clearUnusualMove()` 호출

## Adding New Worker → Main Events

1. **types.ts**: MainMessage에 새 타입 추가
```typescript
| { type: "NEW_EVENT"; data: NewEventData };
```

2. **FabContext.ts**: 이벤트 발생 시 postMessage
```typescript
globalThis.postMessage({ type: "NEW_EVENT", data: eventData });
```

3. **MultiWorkerController.ts**: 콜백 필드 + 핸들러 추가
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

4. **shmSimulatorStore.ts**: 상태 + 콜백 연결
```typescript
// state
newEventData: NewEventData | null;

// initMultiFab에서
controller.onNewEvent((data) => {
  set({ newEventData: data });
});
```

5. **React 컴포넌트**: Store 구독 + UI 표시

## Impact Map

| 수정 | 확인 필요 |
|------|-----------|
| types.ts 메시지 타입 | worker.entry.ts, MultiWorkerController |
| FabContext 콜백 | movementUpdate, edgeTransition |
| MultiWorkerController 콜백 | shmSimulatorStore 연결 |
| shmSimulatorStore 상태 | React 컴포넌트 구독 |
| UnusualMoveModal | App.tsx 렌더링 |

## Debugging

### Worker 메시지 확인
```typescript
// worker.entry.ts
globalThis.onmessage = (e) => {
  console.log('[Worker] received:', e.data.type);
  // ...
};
```

### Main 메시지 확인
```typescript
// MultiWorkerController.handleWorkerMessage
console.log('[Main] received:', message.type, message);
```

### UnusualMove 상태 확인
```typescript
// 개발자 콘솔
const state = useShmSimulatorStore.getState();
console.log('[UnusualMove]', state.unusualMove);
```
