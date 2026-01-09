# Multi-Worker Architecture 개발 계획

## 1. 개요

현재 단일 워커 구조를 멀티 워커 구조로 확장하여 CPU 병렬화를 통한 성능 향상을 목표로 한다.

### 1.1 현재 구조
```
Main Thread (ShmSimulatorController)
├── Fab A용 SAB 생성
├── Fab B용 SAB 생성
└── Worker 1개 생성
     └── SimulationEngine
          ├── FabContext A (Fab A SAB 전체 사용)
          └── FabContext B (Fab B SAB 전체 사용)
```

### 1.2 목표 구조
```
Main Thread (오케스트레이터 역할)
├── 하나의 거대한 SAB 생성
├── 메모리 영역 분배 계산
├── Worker 1 생성 → Fab A, B 담당 (offset 0 ~ X)
├── Worker 2 생성 → Fab C, D 담당 (offset X ~ Y)
└── 렌더링 (SAB 읽기만)
```

---

## 2. 핵심 설계 원칙

### 2.1 메모리 영역 분리
- 각 워커는 자기가 담당하는 **메모리 영역(offset, size)만 접근**
- 영역이 겹치지 않으므로 **Atomics 불필요** (대부분의 경우)
- Main은 전체 SAB를 읽기 전용으로 접근

### 2.2 오케스트레이터 = Main Thread
- Main Thread가 SAB 할당 및 워커 관리
- Nested Worker 불필요 → 구현 단순화
- 워커 간 통신은 Main을 경유

---

## 3. 구현 단계

### Phase 1: 엔진에 메모리 영역 개념 도입 (우선 구현)

**목표**: SimulationEngine이 "자기 영역"만 사용하도록 변경

#### 3.1.1 현재 문제점

```typescript
// 현재: FabContext가 SAB 전체를 받음
const params: FabInitParams = {
  sharedBuffer: fabData.sharedBuffer,  // Fab 전용 SAB
  // ...
};
```

- 각 Fab마다 개별 SAB 생성 (비효율)
- 엔진은 받은 Fab 전체를 순차 처리
- 메모리 영역 제한 개념 없음

#### 3.1.2 변경 사항

**A. 메모리 할당 정보 타입 정의**

```typescript
// src/shmSimulator/types.ts

/** 워커에게 할당되는 메모리 영역 정보 */
interface MemoryRegion {
  /** SharedArrayBuffer 내 시작 오프셋 (bytes) */
  offset: number;
  /** 할당된 영역 크기 (bytes) */
  size: number;
  /** 최대 Vehicle 수 */
  maxVehicles: number;
}

/** Fab별 메모리 할당 정보 */
interface FabMemoryAssignment {
  fabId: string;
  vehicleRegion: MemoryRegion;   // Vehicle 데이터 영역
  sensorRegion: MemoryRegion;    // Sensor 데이터 영역
}

/** 워커 초기화 페이로드 (확장) */
interface WorkerInitPayload {
  /** 전체 공유 버퍼 (모든 Fab 데이터 포함) */
  sharedBuffer: SharedArrayBuffer;
  sensorPointBuffer: SharedArrayBuffer;

  /** 이 워커가 담당하는 Fab들의 메모리 할당 정보 */
  fabAssignments: FabMemoryAssignment[];

  /** 각 Fab의 맵/노드 정보 등 */
  fabConfigs: FabConfigData[];

  config: SimulationConfig;
}
```

**B. FabContext 변경**

```typescript
// src/shmSimulator/core/FabContext.ts

export interface FabInitParams {
  fabId: string;

  // 기존: 개별 SAB
  // sharedBuffer: SharedArrayBuffer;

  // 변경: 공유 SAB + 영역 정보
  sharedBuffer: SharedArrayBuffer;
  memoryAssignment: FabMemoryAssignment;

  edges: Edge[];
  nodes: Node[];
  // ...
}

export class FabContext {
  constructor(params: FabInitParams) {
    const { sharedBuffer, memoryAssignment } = params;

    // 자기 영역만 사용하는 Float32Array 뷰 생성
    const vehicleData = new Float32Array(
      sharedBuffer,
      memoryAssignment.vehicleRegion.offset,
      memoryAssignment.vehicleRegion.size / Float32Array.BYTES_PER_ELEMENT
    );

    this.store.setSharedBuffer(vehicleData);
    // ...
  }
}
```

**C. VehicleDataArrayBase 변경**

```typescript
// src/common/vehicle/memory/VehicleDataArrayBase.ts

export class VehicleDataArrayBase {
  // 기존: 전체 버퍼 사용
  // private data: Float32Array;

  // 변경: 영역 제한된 뷰 사용
  private data: Float32Array;
  private readonly baseOffset: number;  // 뷰 내부 오프셋
  private readonly maxVehicles: number;

  /**
   * 영역 제한된 버퍼 설정
   */
  setBuffer(
    buffer: SharedArrayBuffer,
    region: MemoryRegion
  ): void {
    this.data = new Float32Array(
      buffer,
      region.offset,
      region.size / Float32Array.BYTES_PER_ELEMENT
    );
    this.maxVehicles = region.maxVehicles;
  }

  /**
   * Vehicle ID가 유효 범위 내인지 확인
   */
  private validateVehicleId(vehId: number): void {
    if (vehId < 0 || vehId >= this.maxVehicles) {
      throw new RangeError(
        `Vehicle ID ${vehId} out of range [0, ${this.maxVehicles})`
      );
    }
  }
}
```

---

### Phase 2: 메모리 레이아웃 매니저

**목표**: Main에서 전체 메모리 레이아웃을 계산하고 관리

```typescript
// src/shmSimulator/MemoryLayoutManager.ts

interface FabMemoryConfig {
  fabId: string;
  maxVehicles: number;
}

interface MemoryLayout {
  totalSize: number;
  vehicleBufferSize: number;
  sensorBufferSize: number;
  fabAssignments: Map<string, FabMemoryAssignment>;
}

export class MemoryLayoutManager {
  private readonly VEHICLE_DATA_SIZE = 22;  // floats per vehicle
  private readonly SENSOR_DATA_SIZE = 36;   // floats per vehicle

  /**
   * 전체 메모리 레이아웃 계산
   */
  calculateLayout(fabConfigs: FabMemoryConfig[]): MemoryLayout {
    let vehicleOffset = 0;
    let sensorOffset = 0;
    const assignments = new Map<string, FabMemoryAssignment>();

    for (const fab of fabConfigs) {
      const vehicleSize = fab.maxVehicles * this.VEHICLE_DATA_SIZE * 4;
      const sensorSize = fab.maxVehicles * this.SENSOR_DATA_SIZE * 4;

      assignments.set(fab.fabId, {
        fabId: fab.fabId,
        vehicleRegion: {
          offset: vehicleOffset,
          size: vehicleSize,
          maxVehicles: fab.maxVehicles,
        },
        sensorRegion: {
          offset: sensorOffset,
          size: sensorSize,
          maxVehicles: fab.maxVehicles,
        },
      });

      vehicleOffset += vehicleSize;
      sensorOffset += sensorSize;
    }

    return {
      totalSize: vehicleOffset + sensorOffset,
      vehicleBufferSize: vehicleOffset,
      sensorBufferSize: sensorOffset,
      fabAssignments: assignments,
    };
  }

  /**
   * 워커별 Fab 분배
   */
  distributeToWorkers(
    fabConfigs: FabMemoryConfig[],
    workerCount: number
  ): FabMemoryConfig[][] {
    const fabsPerWorker = Math.ceil(fabConfigs.length / workerCount);
    const distribution: FabMemoryConfig[][] = [];

    for (let i = 0; i < workerCount; i++) {
      const start = i * fabsPerWorker;
      const end = Math.min(start + fabsPerWorker, fabConfigs.length);
      distribution.push(fabConfigs.slice(start, end));
    }

    return distribution;
  }
}
```

---

### Phase 3: 멀티 워커 컨트롤러

**목표**: Main Thread에서 여러 워커를 관리

```typescript
// src/shmSimulator/MultiWorkerController.ts

export class MultiWorkerController {
  private sharedBuffer: SharedArrayBuffer | null = null;
  private sensorBuffer: SharedArrayBuffer | null = null;
  private workers: Worker[] = [];
  private layoutManager = new MemoryLayoutManager();
  private layout: MemoryLayout | null = null;

  async init(params: {
    fabs: FabInitParams[];
    workerCount?: number;
    config?: Partial<SimulationConfig>;
  }): Promise<void> {
    const { fabs, config = {} } = params;
    const workerCount = params.workerCount ??
      Math.min(navigator.hardwareConcurrency, fabs.length);

    // 1. 메모리 레이아웃 계산
    const fabConfigs = fabs.map(f => ({
      fabId: f.fabId,
      maxVehicles: config.maxVehicles ?? 200000,
    }));
    this.layout = this.layoutManager.calculateLayout(fabConfigs);

    // 2. 공유 버퍼 생성
    this.sharedBuffer = new SharedArrayBuffer(this.layout.vehicleBufferSize);
    this.sensorBuffer = new SharedArrayBuffer(this.layout.sensorBufferSize);

    // 3. 워커별 Fab 분배
    const fabDistribution = this.layoutManager.distributeToWorkers(
      fabConfigs,
      workerCount
    );

    // 4. 워커 생성 및 초기화
    const initPromises: Promise<void>[] = [];

    for (let i = 0; i < workerCount; i++) {
      const worker = new Worker(
        new URL("./worker.entry.ts", import.meta.url),
        { type: "module" }
      );

      const assignedFabs = fabDistribution[i];
      const fabAssignments = assignedFabs.map(fc =>
        this.layout!.fabAssignments.get(fc.fabId)!
      );

      const fabConfigData = fabs.filter(f =>
        assignedFabs.some(af => af.fabId === f.fabId)
      );

      const promise = this.initWorker(worker, {
        sharedBuffer: this.sharedBuffer,
        sensorPointBuffer: this.sensorBuffer,
        fabAssignments,
        fabConfigs: fabConfigData,
        config: { ...createDefaultConfig(), ...config },
      });

      initPromises.push(promise);
      this.workers.push(worker);
    }

    await Promise.all(initPromises);
  }

  private initWorker(
    worker: Worker,
    payload: WorkerInitPayload
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      worker.onmessage = (e) => {
        if (e.data.type === "INITIALIZED") {
          resolve();
        } else if (e.data.type === "ERROR") {
          reject(new Error(e.data.error));
        }
      };

      worker.postMessage({ type: "INIT", payload });
    });
  }

  /**
   * 모든 워커에 시작 명령
   */
  start(): void {
    for (const worker of this.workers) {
      worker.postMessage({ type: "START" });
    }
  }

  /**
   * 특정 Fab에 대한 Vehicle 데이터 읽기
   */
  getVehicleData(fabId: string): Float32Array | null {
    if (!this.sharedBuffer || !this.layout) return null;

    const assignment = this.layout.fabAssignments.get(fabId);
    if (!assignment) return null;

    return new Float32Array(
      this.sharedBuffer,
      assignment.vehicleRegion.offset,
      assignment.vehicleRegion.size / 4
    );
  }
}
```

---

## 4. 마이그레이션 전략

### 4.1 하위 호환성 유지

기존 `ShmSimulatorController`는 그대로 유지하고, 새로운 `MultiWorkerController`를 별도로 구현한다.

```typescript
// 기존 코드 (단일 워커)
const controller = new ShmSimulatorController();
await controller.init({ fabs: [...] });

// 새 코드 (멀티 워커)
const controller = new MultiWorkerController();
await controller.init({ fabs: [...], workerCount: 4 });
```

### 4.2 단계별 구현 순서

| 단계 | 작업 | 파일 |
|------|------|------|
| 1 | MemoryRegion 타입 정의 | `types.ts` |
| 2 | VehicleDataArrayBase에 영역 제한 기능 추가 | `VehicleDataArrayBase.ts` |
| 3 | FabContext가 영역 정보 받도록 변경 | `FabContext.ts` |
| 4 | MemoryLayoutManager 구현 | `MemoryLayoutManager.ts` (신규) |
| 5 | MultiWorkerController 구현 | `MultiWorkerController.ts` (신규) |
| 6 | 기존 ShmSimulatorController 유지 (하위호환) | `index.ts` |

---

## 5. Fab 간 차량 전송 (TransferMgr)

### 5.1 문제점

현재 TransferMgr는 워커 내부에서 동작한다. 멀티 워커 환경에서는:
- Worker 1의 Fab A → Worker 2의 Fab C로 차량 전송 시
- 메모리 영역이 다르므로 직접 전송 불가

### 5.2 해결 방안

**Option A: Main 경유 전송**
```
Worker 1 → postMessage → Main → postMessage → Worker 2
```

**Option B: 전송 큐 영역 분리**
```
SAB 내 별도 "전송 큐 영역" 할당
모든 워커가 읽기/쓰기 가능 (Atomics 사용)
```

**권장**: Phase 1~3 완료 후 결정

---

## 6. 동기화 고려사항

### 6.1 Atomics가 필요 없는 경우
- 각 워커가 자기 Fab 영역만 쓰기
- Main이 렌더링용으로 읽기만

### 6.2 Atomics가 필요한 경우
- Fab 간 차량 전송 큐
- 계산 완료 신호 (대안: postMessage)

---

## 7. 예상 성능 향상

| Fab 수 | 워커 수 | 예상 향상 |
|--------|---------|----------|
| 2 | 1 | 기준 |
| 4 | 2 | ~80% (오버헤드 감안) |
| 8 | 4 | ~150% |
| 12 | 4 | ~180% |

---

## 8. 결론

1. **Phase 1 우선 구현**: 엔진에 메모리 영역 개념 도입
2. 기존 단일 워커에서도 동작하도록 하위호환 유지
3. Phase 1 완료 후 Phase 2, 3 순차 진행
4. Fab 간 전송은 Phase 3 이후 별도 설계

---

## 변경 이력

| 날짜 | 버전 | 내용 |
|------|------|------|
| 2026-01-10 | 0.1 | 초안 작성 |
| 2026-01-10 | 1.0 | Phase 1~3 구현 완료 |

---

## 구현 완료 파일

### Phase 1: 엔진에 메모리 영역 개념 도입
- `src/shmSimulator/types.ts` - `MemoryRegion`, `FabMemoryAssignment` 타입 추가
- `src/common/vehicle/memory/VehicleDataArrayBase.ts` - `setBufferWithRegion()` 추가
- `src/common/vehicle/memory/SensorPointArrayBase.ts` - `setBufferWithRegion()` 추가
- `src/shmSimulator/core/EngineStore.ts` - `setSharedBufferWithRegion()` 추가
- `src/shmSimulator/core/FabContext.ts` - `memoryAssignment` 옵션 지원

### Phase 2: MemoryLayoutManager
- `src/shmSimulator/MemoryLayoutManager.ts` - 신규 생성

### Phase 3: MultiWorkerController
- `src/shmSimulator/MultiWorkerController.ts` - 신규 생성
- `src/shmSimulator/core/SimulationEngine.ts` - `memoryAssignment` 전달 추가
