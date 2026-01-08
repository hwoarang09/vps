# Multi-Fab 메모리 분리 구현

## 개요

기존에는 모든 Fab의 데이터가 하나의 SharedArrayBuffer에서 관리되어 다익스트라 경로 탐색 시 모든 edge를 탐색해야 했습니다. 이번 구현으로 **Fab별로 독립적인 메모리 공간**을 가지게 되어 각 Fab 내에서만 경로 탐색 및 관리가 이루어집니다.

## 아키텍처 변경

### 기존 구조
```
Worker (1개)
  └── SimulationEngine
       ├── EngineStore (단일)
       │    ├── vehicleDataArray (모든 fab의 비히클)
       │    └── edgeVehicleQueue (단일)
       ├── LockMgr (단일)
       ├── TransferMgr (단일)
       └── AutoMgr (단일)
```

### 새로운 구조
```
Worker (1개)
  └── SimulationEngine
       └── fabContexts: Map<fabId, FabContext>
            ├── fab_A: FabContext
            │    ├── sharedBuffer (별도)
            │    ├── sensorPointBuffer (별도)
            │    ├── vehicleDataArray
            │    ├── edgeVehicleQueue
            │    ├── LockMgr
            │    ├── TransferMgr
            │    └── AutoMgr
            │
            └── fab_B: FabContext
                 ├── sharedBuffer (별도)
                 ├── ... (독립적인 인스턴스들)
```

## 변경된 파일들

### 1. 새 파일: `src/shmSimulator/core/FabContext.ts`

Fab 단위로 모든 매니저와 메모리를 묶어서 관리하는 클래스입니다.

```typescript
export class FabContext {
  public readonly fabId: string;

  // 독립적인 메모리
  private readonly vehicleDataArray: VehicleDataArrayBase;
  private readonly sensorPointArray: SensorPointArrayBase;
  private readonly edgeVehicleQueue: EdgeVehicleQueue;

  // 독립적인 매니저들
  private readonly lockMgr: LockMgr;
  private readonly transferMgr: TransferMgr;
  private readonly autoMgr: AutoMgr;

  // ...
}
```

### 2. `src/shmSimulator/types.ts`

멀티 Fab을 지원하는 타입 추가:

```typescript
// 단일 Fab 초기화 데이터
export interface FabInitData {
  fabId: string;
  sharedBuffer: SharedArrayBuffer;
  sensorPointBuffer: SharedArrayBuffer;
  edges: Edge[];
  nodes: Node[];
  vehicleConfigs: VehicleInitConfig[];
  numVehicles: number;
  transferMode: TransferMode;
  stationData: StationRawData[];
}

// 멀티 Fab 지원 Init Payload
export interface InitPayload {
  config: SimulationConfig;
  fabs: FabInitData[];
}

// Worker 메시지에 fabId 추가
export type WorkerMessage =
  | { type: "COMMAND"; fabId: string; payload: unknown }
  | { type: "ADD_FAB"; fab: FabInitData; config: SimulationConfig }
  | { type: "REMOVE_FAB"; fabId: string }
  // ...
```

### 3. `src/shmSimulator/core/SimulationEngine.ts`

FabContext Map으로 관리하도록 변경:

```typescript
export class SimulationEngine {
  private readonly fabContexts: Map<string, FabContext> = new Map();

  init(payload: InitPayload): Record<string, number> {
    for (const fabData of payload.fabs) {
      const context = new FabContext(params);
      this.fabContexts.set(fabData.fabId, context);
    }
  }

  step(delta: number): void {
    // 모든 fab context 업데이트
    for (const context of this.fabContexts.values()) {
      context.step(clampedDelta);
    }
  }

  // 동적 fab 추가/제거
  addFab(fabData: FabInitData, config: SimulationConfig): number { ... }
  removeFab(fabId: string): boolean { ... }
}
```

### 4. `src/shmSimulator/index.ts` (ShmSimulatorController)

Fab별 SharedArrayBuffer 관리:

```typescript
export class ShmSimulatorController {
  private fabBuffers: Map<string, FabBufferData> = new Map();

  async init(params: { fabs: FabInitParams[]; config?: Partial<SimulationConfig> }) {
    for (const fabParams of fabs) {
      const bufferData = this.createFabBuffers(fabParams.fabId);
      this.fabBuffers.set(fabParams.fabId, bufferData);
    }
  }

  // Fab별 데이터 접근
  getVehicleData(fabId: string): Float32Array | null { ... }
  getSensorPointData(fabId: string): Float32Array | null { ... }

  // 동적 fab 추가/제거
  async addFab(fabParams: FabInitParams): Promise<number> { ... }
  async removeFab(fabId: string): Promise<void> { ... }
}
```

### 5. `src/store/vehicle/shmMode/shmSimulatorStore.ts`

하위 호환성을 유지하면서 멀티 Fab API 추가:

```typescript
// 기존 API (하위 호환)
init: async (params) => {
  await get().initMultiFab({
    fabs: [{ fabId: "default", ...params }],
    config,
  });
}

// 새로운 멀티 Fab API
initMultiFab: async (params) => { ... }
addFab: async (params) => { ... }
removeFab: async (fabId) => { ... }

// Fab별 데이터 접근
getVehicleData: (fabId = "default") => { ... }
getActualNumVehicles: (fabId = "default") => { ... }
```

## AutoMgr 구역(Region) 매핑

Fab 내에서도 물리적으로 분리된 구역(층, 건물 등)이 있을 수 있어 구역 매핑 기능을 추가했습니다.

### `src/common/vehicle/logic/AutoMgr.ts`

```typescript
export class AutoMgr {
  // Edge -> Region ID 매핑
  private edgeToRegion: Map<number, number> = new Map();
  // Region ID -> 해당 구역의 스테이션들
  private regionStations: Map<number, StationTarget[]> = new Map();

  // 구역 매핑 빌드 (O(E) 복잡도)
  private buildRegionMapping(edgeArray: Edge[]) {
    // 역방향 인덱스 미리 구축
    const prevEdges: number[][] = Array.from({ length: edgeArray.length }, () => []);
    for (let i = 0; i < edgeArray.length; i++) {
      const nextIndices = edgeArray[i]?.nextEdgeIndices || [];
      for (const next of nextIndices) {
        prevEdges[next].push(i);
      }
    }

    // BFS로 연결된 edge들을 같은 구역으로 분류
    // ...
  }

  // 현재 edge가 속한 구역의 스테이션만 선택
  assignRandomDestination(...) {
    const availableStations = this.getStationsForEdge(currentEdgeIdx);
    // 같은 구역 내에서만 목적지 선택
  }
}
```

## 사용법

### 기존 방식 (하위 호환)
```typescript
await store.init({
  edges, nodes, numVehicles, stations,
  // fabId 지정 안하면 "default" 사용
});

const data = store.getVehicleData(); // default fab
```

### 멀티 Fab 방식
```typescript
// 초기화
await store.initMultiFab({
  fabs: [
    { fabId: "fab_A", edges: edgesA, nodes: nodesA, numVehicles: 100, stations: stationsA },
    { fabId: "fab_B", edges: edgesB, nodes: nodesB, numVehicles: 200, stations: stationsB },
  ],
  config: { ... },
});

// Fab별 데이터 접근
const dataA = store.getVehicleData("fab_A");
const dataB = store.getVehicleData("fab_B");

// Fab별 명령 전송
store.sendCommand(payload, "fab_A");

// 동적 Fab 추가/제거
await store.addFab({ fabId: "fab_C", ... });
await store.removeFab("fab_C");

// 전체 정보
const fabIds = store.getFabIds();
const totalCount = store.getTotalVehicleCount();
```

## 성능 최적화

### buildRegionMapping O(E²) → O(E)

기존 역방향 탐색이 매번 전체 edge를 순회하는 O(E²) 복잡도였으나, 역방향 인덱스를 미리 구축하여 O(E)로 최적화했습니다.

```typescript
// Before: O(E²)
for (let i = 0; i < edgeArray.length; i++) {
  if (itsNextEdges.includes(current)) { ... }
}

// After: O(E)
const prevEdges = buildReverseIndex(edgeArray);
for (const prev of prevEdges[current]) { ... }
```

## 결과

- 각 Fab은 완전히 독립적인 메모리 공간과 매니저 인스턴스를 가짐
- 경로 탐색(다익스트라)이 해당 Fab 내의 edge만 탐색
- 물리적으로 분리된 구역(층, 건물)도 자동으로 감지하여 같은 구역 내에서만 목적지 선택
- 하위 호환성 유지 (기존 단일 Fab 코드 수정 불필요)
