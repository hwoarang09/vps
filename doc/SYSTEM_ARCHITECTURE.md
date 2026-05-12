# VPS System Architecture

## 1. 시스템 개요

### 1.1 목적
VPS(Vehicle Path Simulation)는 반도체 FAB 내 OHT(Overhead Hoist Transport) 차량의 대규모 시뮬레이션 시스템입니다.

### 1.2 목표
- **대규모 처리**: 수십만 대 차량 실시간 시뮬레이션
- **고성능**: 60 FPS 시뮬레이션 + 부드러운 렌더링
- **확장성**: FAB 수 증가에 따른 선형 확장

### 1.3 핵심 설계 원칙

| 원칙 | 설명 |
|------|------|
| **Zero-Copy** | SharedArrayBuffer로 Main-Worker 간 메모리 복사 없음 |
| **FAB 분리** | 각 FAB은 독립적인 평행우주처럼 동작 |
| **Worker 기반** | 시뮬레이션은 Worker에서, 렌더링은 Main Thread에서 |
| **단일 맵 공유** | 모든 FAB이 동일한 맵 데이터 사용 (메모리 절약) |

---

## 2. 전체 아키텍처

```
┌─────────────────────────────────────────────────────────────────┐
│                        Main Thread                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │ React UI     │  │ Zustand      │  │ Three.js Renderer    │   │
│  │ - Controls   │  │ - mapStore   │  │ - MapRenderer        │   │
│  │ - Dashboard  │  │ - fabStore   │  │ - VehicleRenderer    │   │
│  └──────────────┘  └──────────────┘  └──────────────────────┘   │
│                              │                    ↑              │
│                              │         READ ONLY │              │
│  ┌───────────────────────────┴────────────────────┴───────────┐ │
│  │                   SharedArrayBuffer                         │ │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐           │ │
│  │  │ FAB 0   │ │ FAB 1   │ │ FAB 2   │ │ FAB ... │           │ │
│  │  │ 0~999   │ │1000~1999│ │2000~2999│ │         │           │ │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘           │ │
│  └────────────────────────────────────────────────────────────┘ │
│                              ↑ WRITE                            │
├─────────────────────────────────────────────────────────────────┤
│                       Worker Threads                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ Worker 0     │  │ Worker 1     │  │ Worker N     │          │
│  │ ┌──────────┐ │  │ ┌──────────┐ │  │ ┌──────────┐ │          │
│  │ │FabContext│ │  │ │FabContext│ │  │ │FabContext│ │          │
│  │ │ fab_0_0  │ │  │ │ fab_1_0  │ │  │ │ fab_4_4  │ │          │
│  │ ├──────────┤ │  │ ├──────────┤ │  │ ├──────────┤ │          │
│  │ │FabContext│ │  │ │FabContext│ │  │ │FabContext│ │          │
│  │ │ fab_0_1  │ │  │ │ fab_1_1  │ │  │ │ fab_4_5  │ │          │
│  │ └──────────┘ │  │ └──────────┘ │  │ └──────────┘ │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. 스레드 아키텍처

### 3.1 역할 분리

| Thread | 역할 | 접근 권한 |
|--------|------|----------|
| **Main Thread** | UI, 렌더링, 사용자 입력 | SharedBuffer READ |
| **Worker Thread** | 시뮬레이션, 충돌감지, 경로탐색 | SharedBuffer WRITE |

### 3.2 Worker 분산 전략

Worker 수는 `Math.min(navigator.hardwareConcurrency, fabCount)`로 결정됩니다.

#### 예시: 50개 FAB, 14개 Worker

```
┌─────────────────────────────────────────────────────────────────┐
│                    50 FABs → 14 Workers                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Worker 0    Worker 1    Worker 2    Worker 3    Worker 4       │
│  ┌───────┐   ┌───────┐   ┌───────┐   ┌───────┐   ┌───────┐     │
│  │fab 0  │   │fab 4  │   │fab 8  │   │fab 12 │   │fab 16 │     │
│  │fab 1  │   │fab 5  │   │fab 9  │   │fab 13 │   │fab 17 │     │
│  │fab 2  │   │fab 6  │   │fab 10 │   │fab 14 │   │fab 18 │     │
│  │fab 3  │   │fab 7  │   │fab 11 │   │fab 15 │   │fab 19 │     │
│  └───────┘   └───────┘   └───────┘   └───────┘   └───────┘     │
│   4 fabs      4 fabs      4 fabs      4 fabs      4 fabs        │
│                                                                  │
│  Worker 5    Worker 6    ...         Worker 12   Worker 13      │
│  ┌───────┐   ┌───────┐               ┌───────┐   ┌───────┐     │
│  │fab 20 │   │fab 24 │               │fab 46 │   │fab 48 │     │
│  │fab 21 │   │fab 25 │               │fab 47 │   │fab 49 │     │
│  │fab 22 │   │fab 26 │               │       │   │       │     │
│  │fab 23 │   │fab 27 │               │       │   │       │     │
│  └───────┘   └───────┘               └───────┘   └───────┘     │
│   4 fabs      4 fabs                  2 fabs      2 fabs        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

분배 공식: fabsPerWorker = ceil(50 / 14) = 4
마지막 워커들: 남은 fab 분배 (2개씩)
```

### 3.3 Worker 내부 구조

```
Worker Thread
└── SimulationEngine
    ├── config: SimulationConfig
    ├── fabContexts: Map<fabId, FabContext>
    │   ├── "fab_0_0" → FabContext
    │   ├── "fab_0_1" → FabContext
    │   └── ...
    └── loop() → 60 FPS
        ├── FabContext.update(delta)
        │   ├── checkCollisions()
        │   ├── updateMovement()
        │   └── autoRouting()
        └── (각 FabContext 순차 실행)
```

**자세한 내용**: [SimulationEngine & FabContext 개념 및 API](../src/shmSimulator/core/README.md)





---

## 4. FAB 시스템 아키텍처

### 4.1 시뮬레이션과 렌더링 분리

FAB 시스템은 **시뮬레이션**과 **렌더링**이 완전히 다른 방식으로 동작한다.

```
┌─────────────────────────────────────────────────────────────────┐
│                  시뮬레이션 (Worker) — 모든 fab 좌표 공유         │
│                                                                  │
│    fab_0_0           fab_0_1            fab_1_0                  │
│    ┌─────────┐       ┌─────────┐        ┌─────────┐              │
│    │ edges   │       │ edges   │        │ edges   │              │
│    │ nodes   │  ←→   │ nodes   │  ←→    │ nodes   │              │
│    │ (0,0)   │       │ (0,0)   │        │ (0,0)   │              │
│    └─────────┘       └─────────┘        └─────────┘              │
│         │                 │                  │                   │
│         └── 같은 SharedMapRef 참조 (메모리 1벌, edge_name 변환無)─┘
│                                                                  │
│    각 fab의 차량들은 좌표상 겹치지만 충돌 검사는 FabContext       │
│    안에서만 일어나므로 서로 인지하지 않음                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       렌더링 (Main Thread)                       │
│                                                                  │
│    차량 = Worker가 시뮬→렌더 버퍼 복사 시 + fabOffset             │
│    맵   = Main이 <group position={[offset, ...]}> 한 번 적용      │
│                                                                  │
│    원본 맵 1벌 + slots (max renderConfig.maxVisibleFabs)         │
│    ┌─────────┐       ┌─────┐ ┌─────┐ ┌─────┐                     │
│    │ edges   │  →    │fab5 │ │fab4 │ │fab6 │ ...                 │
│    │ nodes   │ slot  │+550 │ │+440 │ │+660 │ (카메라 가까운 순)   │
│    └─────────┘ offset└─────┘ └─────┘ └─────┘                     │
│                                                                  │
│    메모리 절약: 맵 데이터 1벌만 저장                              │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 Worker에서 맵 데이터 공유 (zero-copy)

`SimulationEngine.buildSharedMapRef()`가 `SharedMapRef` 1개를 만들어 **모든 FabContext에 동일 참조를 주입**한다. 옛 구조처럼 fab마다 edges/nodes를 복제하지 않음 — edge_name 변환(`edge1001`, `edge2001` 식)도 없음.

```
sharedMapData (init 시 1회 postMessage)
       │
       ▼
SimulationEngine.buildSharedMapRef()  ← 1회 호출
       │
       └─ SharedMapRef
          ├─ edges: Edge[]              ← 원본 그대로 (공유)
          ├─ nodes: Node[]              ← 원본 그대로 (공유)
          ├─ edgeNameToIndex: Map       ← 공유 lookup
          └─ stations: Station[]
                │
                ▼
       모든 FabContext가 같은 참조를 사용
       (fab_0_0, fab_0_1, fab_1_0, ... 전부 edges[5] === 같은 edge)
```

**시뮬 좌표는 원본 그대로**. 즉 모든 FAB의 차량들이 같은 좌표 공간 (0, 0) 근처에서 시뮬레이션됨. 충돌 검사는 각 FabContext의 `edgeVehicleQueue` 안에서만 일어나므로 fab 간 좌표가 겹쳐도 서로의 차량을 인지하지 않음.

### 4.3 FabContext 구조

```
FabContext ("fab_0_1")
├── fabId: "fab_0_1"
├── edges: Edge[]              ← sharedMapRef.edges 참조 (모든 fab 공유)
├── nodes: Node[]              ← sharedMapRef.nodes 참조
├── edgeNameToIndex: Map       ← sharedMapRef와 동일
├── fabOffset: { x, y }        ← 렌더 좌표 offset (렌더 버퍼 쓸 때만 적용)
│
├── store: EngineStore         ← 시뮬 버퍼 (fab별 region) 접근
│   └── vehicleDataArray       ← 이 FAB의 차량들 (원본 좌표)
│
├── edgeVehicleQueue           ← edge별 차량 목록 (충돌감지, FabContext 격리)
├── lockMgr: LockMgr           ← Merge 노드 잠금 (per-fab 독립 인스턴스)
├── transferMgr: TransferMgr   ← 차량 이동 명령
├── autoMgr: AutoMgr           ← 자동 라우팅
├── dispatchMgr: DispatchMgr   ← 배차
└── routingMgr: RoutingMgr     ← 명령 라우팅
```

**자세한 내용**: [FabContext API / step 흐름](../src/shmSimulator/core/README.md#6-fabcontext-api)

### 4.4 fab offset이 적용되는 두 경로

모든 fab이 같은 시뮬 좌표(fab_0_0의 공간)에서 돌고, 차량들도 좌표상 겹친다. 그런데 화면에서는 따로 떨어져 보여야 한다. **차량과 맵이 서로 다른 경로로 offset된다** — 동적 데이터와 정적 데이터의 처리가 갈림.

| 데이터 | 변환 시점 | 변환 방법 | 누가 함 |
|--------|----------|----------|---------|
| **차량** (동적, 매 프레임 변함) | 매 step 끝, 시뮬→렌더 버퍼 복사 시 | SAB에 `+fabOffsetX/Y` 적용한 값 기록 | Worker |
| **맵** (정적, 안 변함) | Three.js scene 빌드 시 | `<group position={[slot.offsetX, slot.offsetY, 0]}>` | Main |

#### 차량 경로 — 시뮬 vs 렌더 버퍼 2-layer

SAB이 총 6개 — **시뮬용 4개** (`vehicleBuffer` / `sensorBuffer` / `pathBuffer` / `checkpointBuffer`)는 Worker만 쓰고, **렌더용 2개** (`vehicleRenderBuffer` / `sensorRenderBuffer`)는 Worker가 쓰고 Main이 읽음.

| 버퍼 | 레이아웃 | 1차량당 크기 | 좌표계 |
|------|---------|------------|--------|
| **시뮬 버퍼** (`vehicleBuffer`, FAB별 region) | fab별 region 분리 | 22 floats | 원본 (offset 없음) |
| **렌더 버퍼** (`vehicleRenderBuffer`, 전역 연속) | 모든 fab 연속 | 4 floats (x, y, z, rotation) | `+fabOffset` 적용본 |

**Worker** — `FabContext.step()` 끝에 `writeToRenderRegion()` 호출. 매 step 마지막 단계에서 시뮬 좌표 → 렌더 좌표 변환 + 22 floats 중 4개만 추려서 복사:

```typescript
// src/shmSimulator/core/FabContext/render.ts
vehicleRenderData[i*4 + 0] = workerVehicleData[i*22 + MovementData.X] + fabOffsetX;
vehicleRenderData[i*4 + 1] = workerVehicleData[i*22 + MovementData.Y] + fabOffsetY;
vehicleRenderData[i*4 + 2] = workerVehicleData[i*22 + MovementData.Z];
vehicleRenderData[i*4 + 3] = workerVehicleData[i*22 + MovementData.ROTATION];
```

**Main** — `useFrame` 안에서 렌더 버퍼를 InstancedMesh attribute에 **그대로 한 줄로 복사**. fab offset도 좌표 변환도 다시 안 함:

```typescript
// src/components/three/entities/renderers/VehiclesRenderer/VehicleArrayRenderer.tsx
dataArr.set(data.subarray(0, actualNumVehicles * VEHICLE_RENDER_SIZE));
```

#### 맵 경로 — Slot 기반 group transform

맵은 정적이라 SAB을 안 거침. Main이 init 때 받은 **원본 맵 1벌**을 메모리에 보관하고, slot마다 다른 `position`을 가진 `<group>` 자식으로 N번 렌더한다. mesh geometry/material은 1벌 — Three.js scene graph가 group transform을 자식 draw call에 자동으로 곱함.

```
fabStore.slots (카메라 거리 기반 동적 할당, 최대 renderConfig.maxVisibleFabs 개)
  ├─ slot[0]: fabIndex=5,  offsetX=550, offsetY=0   ← 카메라에 가장 가까운 fab
  ├─ slot[1]: fabIndex=4,  offsetX=440, offsetY=0
  └─ ...

// EdgeRenderer / NodesRenderer / StationRenderer
{slots.map(slot => (
  <group key={slot.slotId} position={[slot.offsetX, slot.offsetY, 0]}>
    {/* 원본 mesh — 같은 geometry/material을 group 안에 다시 인스턴스화 */}
  </group>
))}
```

카메라 이동 시 `fabStore.updateSlots(cameraX, cameraY)`가 가장 가까운 fab N개를 다시 골라 slot에 재할당 — 전체 fab을 그리지 않고 가까운 것만 그려 draw call 절약.

#### 정리

- 시뮬: 모든 fab이 좌표상 겹친 채로 돈다 (FabContext 격리로 충돌 안 남)
- 매 step 끝: Worker가 위치+회전 4 floats만 fab offset 더해서 렌더 버퍼에 복사
- Main: 렌더 버퍼를 그대로 InstancedMesh로 한 번에 set, 맵은 slot group 한 번에 평행이동

**상세 문서**:
- [Three.js 렌더링 컴포넌트 개요](../src/components/three/README.md)
- [VehicleArrayMode (InstancedMesh + SAB 직접 read)](../src/components/three/entities/vehicle/vehicleArrayMode/README.md)
- [FabContext.step / writeToRenderRegion](../src/shmSimulator/core/README.md#step-흐름--7-단계)

---

## 5. 메모리 아키텍처

**자세한 메모리 구조 문서**: [Vehicle Memory Architecture](../src/common/vehicle/memory/README.md)

### 5.1 SharedArrayBuffer 레이아웃

```
┌─────────────────────────────────────────────────────────────────┐
│                    SharedArrayBuffer (전체)                      │
├─────────────────────────────────────────────────────────────────┤
│ FAB 0 영역          │ FAB 1 영역          │ FAB 2 영역    │ ... │
│ [0 ~ 21999]         │ [22000 ~ 43999]     │ [44000~65999] │     │
│ (1000 vehicles)     │ (1000 vehicles)     │ (1000 veh)    │     │
├─────────────────────┼─────────────────────┼───────────────┤     │
│ Worker 0 담당       │ Worker 0 담당       │ Worker 1 담당 │     │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 Vehicle 데이터 구조 (22 floats per vehicle)

**자세한 필드 설명**: [Memory Architecture - VehicleDataArray](../src/common/vehicle/memory/README.md#1-vehicledataarray-22-floats-per-vehicle)

```
Vehicle Data Layout (VEHICLE_DATA_SIZE = 22)
┌────────────────────────────────────────────────────────────────┐
│ Index │ Field           │ 설명                                 │
├───────┼─────────────────┼──────────────────────────────────────┤
│ 0-13  │ MovementData    │ 위치, 속도, edge 정보                │
│ 14-16 │ SensorData      │ 센서, 충돌 감지                      │
│ 17-21 │ LogicData       │ 상태, 경로, 목적지                   │
└────────────────────────────────────────────────────────────────┘
```

### 5.3 FAB별 메모리 영역 할당

```typescript
interface FabMemoryAssignment {
  fabId: string;
  vehicleStartIndex: number;  // 이 FAB의 첫 차량 index
  vehicleEndIndex: number;    // 이 FAB의 마지막 차량 index
  maxVehicles: number;        // 최대 차량 수
}

// 예: 50 FAB, FAB당 1000대
// fab_0_0: vehicleStartIndex=0,     vehicleEndIndex=999
// fab_0_1: vehicleStartIndex=1000,  vehicleEndIndex=1999
// fab_0_2: vehicleStartIndex=2000,  vehicleEndIndex=2999
```

### 5.4 SensorPoint 버퍼

충돌 감지용 센서 포인트를 별도 버퍼에 저장합니다.

**자세한 센서 구조**: [Memory Architecture - SensorPointArray](../src/common/vehicle/memory/README.md#2-sensorpointarray-36-floats-per-vehicle)
**센서 충돌 감지 시스템**: [Sensor-Based Collision Detection](../src/common/vehicle/collision/README.md)

```
SensorPointBuffer (차량당 36 floats = 3 zones × 6 points × 2 coords)
┌────────────────────────────────────────┐
│ Vehicle 0: Zone0(APPROACH), Zone1(BRAKE), Zone2(STOP) │
│ Vehicle 1: Zone0, Zone1, Zone2                          │
│ ...                                                     │
└────────────────────────────────────────┘
```

---

## 6. 데이터 흐름

### 6.1 초기화 흐름

```
┌─────────────┐     ┌─────────────────────┐     ┌─────────────┐
│   React     │────▶│ MultiWorkerController│────▶│   Worker    │
│ Component   │     │                     │     │             │
└─────────────┘     └─────────────────────┘     └─────────────┘
      │                      │                        │
      │ 1. init() 호출       │ 2. Worker 생성         │
      │                      │    SharedBuffer 할당   │
      │                      │                        │
      │                      │ 3. postMessage(INIT)   │
      │                      │ ──────────────────────▶│
      │                      │                        │ 4. SimulationEngine
      │                      │                        │    .init()
      │                      │                        │    - FabContext 생성
      │                      │                        │    - 차량 배치
      │                      │ 5. INITIALIZED        │
      │                      │◀────────────────────── │
      │                      │                        │
      ▼                      ▼                        ▼
```

### 6.2 시뮬레이션 루프 (60 FPS)

```
Worker Thread (매 프레임)
┌─────────────────────────────────────────────────────────────┐
│                                                              │
│  for (const [fabId, context] of fabContexts) {              │
│      context.update(delta);                                  │
│      │                                                       │
│      ├── 1. checkCollisions()                               │
│      │   └── 앞차와의 거리 체크, 정지/감속 결정              │
│      │                                                       │
│      ├── 2. updateMovement()                                │
│      │   └── 위치 업데이트, SharedBuffer에 쓰기             │
│      │                                                       │
│      └── 3. autoRouting()                                   │
│          └── 자동 경로 탐색 및 다음 목적지 설정             │
│  }                                                           │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 6.3 렌더링 루프 (requestAnimationFrame)

```
Main Thread (매 프레임)
┌─────────────────────────────────────────────────────────────┐
│                                                              │
│  useFrame(() => {                                           │
│      // SharedBuffer에서 읽기 (Zero-Copy)                    │
│      const data = shmStore.getVehicleData();                │
│                                                              │
│      for (let i = 0; i < numVehicles; i++) {                │
│          // FAB별 offset 적용                                │
│          const fabOffset = getFabOffset(i);                 │
│          position.x = data[i].x + fabOffset.x;              │
│          position.y = data[i].y + fabOffset.y;              │
│                                                              │
│          mesh.setMatrixAt(i, matrix);                       │
│      }                                                       │
│  });                                                         │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**자세한 렌더링 흐름**: [Three.js 렌더링 시스템 - 렌더링 루프](../src/components/three/README.md#렌더링-루프-전체-흐름)

### 6.4 명령 흐름 (MQTT → Worker)

```
┌────────┐    ┌──────────┐    ┌─────────────────────┐    ┌────────────┐
│  MQTT  │───▶│ mqttStore│───▶│ MultiWorkerController│───▶│   Worker   │
│ Broker │    │          │    │                     │    │            │
└────────┘    └──────────┘    └─────────────────────┘    └────────────┘
                   │                    │                       │
                   │ 1. onMessage       │                       │
                   │ (차량 이동 명령)   │                       │
                   │                    │ 2. sendCommand()      │
                   │                    │ ─────────────────────▶│
                   │                    │                       │ 3. FabContext
                   │                    │                       │    .handleCommand()
                   │                    │                       │    - TransferMgr
                   │                    │                       │      .startTransfer()
                   ▼                    ▼                       ▼
```


---

## 7. 렌더링 아키텍처

### 7.1 Slot 기반 렌더링 (맵)

화면에 보이는 FAB만 렌더링한다. 카메라 거리 기반으로 `renderConfig.maxVisibleFabs` 개 (default 9) 슬롯에 동적 할당.

```
fabStore.slots — 카메라 위치 기반 동적 재할당 (fabStore.updateSlots)
  ├─ slot[0]: fabIndex=5,  offsetX=550, offsetY=0    ← 카메라 최근접
  ├─ slot[1]: fabIndex=4,  offsetX=440, offsetY=0
  └─ ...

EdgeRenderer / NodesRenderer / StationRenderer:
  {slots.map(slot => (
    <group key={slot.slotId} position={[slot.offsetX, slot.offsetY, 0]}>
      {/* 원본 맵 데이터 — Three.js group transform 자동 적용 */}
    </group>
  ))}
```

slot에 할당되지 않은 fab은 **렌더링만** 생략 — 시뮬레이션은 모든 fab이 계속 돌고 있음 (Worker는 카메라를 모름).

차량은 별도 경로로 fab offset이 적용됨 — Worker가 시뮬→렌더 버퍼 복사 시점에 `+fabOffsetX/Y`. 자세한 설명: [§4.4 fab offset이 적용되는 두 경로](#44-fab-offset이-적용되는-두-경로)

**자세한 내용**: [Three.js 렌더링 컴포넌트](../src/components/three/README.md)

### 7.2 렌더러 구조

```
MapRenderer
├── EdgeRenderer          ← Edge 렌더링 (InstancedMesh)
├── NodesRenderer         ← Node 렌더링 (InstancedMesh)
└── StationRenderer       ← Station 렌더링 (InstancedMesh)

VehiclesRenderer
├── VehicleArrayRenderer  ← 차량 본체 (InstancedMesh)
└── SensorDebugRenderer   ← 센서 디버그 (선택적)
```

### 7.3 InstancedMesh 최적화

단일 draw call로 수천 개의 객체를 렌더링합니다.

**자세한 내용**: [Three.js 렌더링 시스템 - Shader 기반 Transform](../src/components/three/README.md#shader-기반-transform)

```typescript
// 나쁜 예: N개의 draw call
for (const vehicle of vehicles) {
  <mesh position={vehicle.position} />  // N draw calls
}

// 좋은 예: 1개의 draw call
<instancedMesh count={vehicles.length}>
  // 모든 차량을 한 번에 렌더링
</instancedMesh>
```

---

## 8. 핵심 컴포넌트 상세

### 8.1 Main Thread 컴포넌트

| 컴포넌트 | 위치 | 역할 |
|----------|------|------|
| `MultiWorkerController` | `shmSimulator/` | Worker 생성/관리, 메시지 라우팅 |
| `useShmSimulatorStore` | `store/vehicle/shmMode/` | Main Thread에서 SharedBuffer 접근 |
| `useFabStore` | `store/map/` | FAB 정보, 렌더링 slot 관리 |
| `VehicleArrayRenderer` | `components/three/` | 차량 렌더링 (Shader 기반 인스턴싱) |
| `MapRenderer` | `components/three/` | 맵 렌더링 (Slot 기반) |

**자세한 렌더링 시스템 문서**: [Three.js 렌더링 시스템](../src/components/three/README.md)

### 8.2 Worker Thread 컴포넌트

| 컴포넌트 | 위치 | 역할 |
|----------|------|------|
| `SimulationEngine` | `shmSimulator/core/` | FAB 총괄, 시뮬레이션 루프 |
| `FabContext` | `shmSimulator/core/` | 개별 FAB 시뮬레이션 |
| `EngineStore` | `shmSimulator/core/` | 메모리 접근, 차량 데이터 관리 |
| `LockMgr` | `common/vehicle/logic/LockMgr/` | Merge 노드 잠금 관리 - [상세 문서](../src/common/vehicle/logic/LockMgr/README.md) |
| `TransferMgr` | `shmSimulator/core/` | 차량 이동 명령 처리 |
| `AutoMgr` | `shmSimulator/core/` | 자동 라우팅 |
| `DispatchMgr` | `shmSimulator/core/` | 배차 관리 |

**자세한 API 문서**: [core/ 컴포넌트 가이드](../src/shmSimulator/core/README.md#코드-가이드-api-사용법)

### 8.3 공유 로직 (common/)

| 컴포넌트 | 역할 |
|----------|------|
| `collisionCheck` | 충돌 감지 로직 |
| `movementUpdate` | 이동 업데이트 로직 |
| `positionInterpolator` | Edge 위 위치 보간 |
| `sensorPoints` | 센서 포인트 계산 |
| `Dijkstra` | 경로 탐색 |

---

## 9. 외부 연동

### 9.1 MQTT 프로토콜

```
┌─────────────────────────────────────────────────────────────────┐
│                        MQTT Topics                               │
├─────────────────────────────────────────────────────────────────┤
│ Topic                    │ 방향        │ 내용                    │
├──────────────────────────┼─────────────┼─────────────────────────┤
│ vps/command/transfer     │ Broker→VPS │ 차량 이동 명령          │
│ vps/command/stop         │ Broker→VPS │ 차량 정지 명령          │
│ vps/status/vehicle/{id}  │ VPS→Broker │ 차량 상태 보고          │
│ vps/status/station/{id}  │ VPS→Broker │ 스테이션 상태 보고      │
└─────────────────────────────────────────────────────────────────┘
```

### 9.2 Transfer 명령 예시

```json
{
  "vehicleId": "VEH00001",
  "fabId": "fab_0_0",
  "fromStation": "STK001",
  "toStation": "EQ002",
  "priority": 1
}
```

---

## 10. 성능 고려사항

### 10.1 Zero-GC 설계

Worker 루프에서 GC를 피하기 위한 전략:

```typescript
// 나쁜 예: 매 프레임 객체 생성
function update() {
  const position = { x: 0, y: 0 };  // GC 대상
  const vector = new THREE.Vector3();  // GC 대상
}

// 좋은 예: 미리 할당된 객체 재사용
const tempPosition = { x: 0, y: 0 };
const tempVector = new THREE.Vector3();

function update() {
  tempPosition.x = data.x;
  tempPosition.y = data.y;
  // 객체 생성 없음
}
```

### 10.2 FAB별 경로탐색 최적화

```
전체 맵 다익스트라: O(E log V) where E = 전체 edge 수
FAB별 다익스트라:   O(E/N log V/N) where N = FAB 수

예: 50 FAB, 10000 edges
  - 전체: O(10000 log 10000) = O(133,000)
  - FAB별: O(200 log 200) × 50 = O(76,000)
  - 약 40% 성능 향상
```

### 10.3 메모리 사용량 예측

```
차량 1대: 22 floats × 4 bytes = 88 bytes
센서:     32 floats × 4 bytes = 128 bytes
합계:     216 bytes/vehicle

예: 50 FAB × 1000대 = 50,000대
  - Vehicle Buffer: 50,000 × 88 = 4.4 MB
  - Sensor Buffer:  50,000 × 128 = 6.4 MB
  - 총: ~11 MB (매우 경량)
```

---

## 11. Lock 시스템 (Merge Node 충돌 방지)

여러 edge가 하나의 node로 합류하는 지점에서 차량이 동시 진입하면 충돌이 발생한다.
**LockMgr**이 한 번에 한 대에게만 진입 허가(grant)를 부여하는 신호등 역할을 한다.

### 11.1 핵심 설계 — Checkpoint 기반 lazy 평가

10만대 × 60fps 환경에서 **매 프레임** 모든 차량에 대해 merge 탐색 / 거리 계산 /
lock 요청을 수행하면 너무 비싸다 (≈ 600만 호출/초). 대신 **경로 결정 시점**에
차량별 checkpoint 리스트를 미리 계산해 두고, 매 프레임은
`currentEdge === cpEdge && currentRatio >= cpRatio` 비교 2개만 한다.
99%는 여기서 조기 종료되고, 1%만 본격 lock 로직이 돌아간다.

```
Vehicle 경로: E10 → E11(merge) → E12

checkpoints = [
  { edge:10, ratio:0.70, flags:REQ,     target:E11 },  // 5.1m 전  → lock 요청
  { edge:10, ratio:0.85, flags:WAIT,    target:E11 },  // 1.89m 전 → grant 대기
  { edge:11, ratio:0.20, flags:RELEASE, target:E11 },  // merge 통과 후 → 해제
]
```

### 11.2 Deadlock Zone — 다이아몬드 교착 해결

두 분기점이 같은 합류점 쌍으로 모두 도달 가능한 다이아몬드 구조에서는 순수 FIFO로
영구 교착이 생길 수 있다 — FIFO 1번이 *물리적으로 즉시 통과 불가능한 차량*일 때
그 lock이 영원히 안 풀려서 *즉시 통과 가능한* 다른 차량이 무한 대기.

**검출 (정적 분석, 시뮬 시작 시 1회)**: Main thread의 `nodeStore.detectDeadlockZones()`가
맵을 훑어서 — 분기점 A·D 두 개가 같은 합류점 {B, C}로 모두 도달 가능하면 그
합류점들을 DZ로 마킹. reachable 판정은 **1-hop 직접** OR **2-hop curve-passthrough**
(변형 DZ 2 — 곡선 끼어 있는 형태도 포함).

**런타임 (DZ 마킹된 노드에 통합 적용되는 3종 메커니즘)**:

1. **Auto gate** — checkpoint 발화와 무관하게, edge 진입 직후 자동 REQ → grant 또는
   STOP, merge 통과 후 자동 RELEASE. checkpoint 처리 누락(타이밍 race)으로 stuck되는
   case를 막는 안전망.
2. **Approaching-edge priority grant** — 큐에서 head를 그대로 grant하지 않고,
   *지금 즉시 통과 가능한* 차량(`currentEdge.to_node === merge`)을 우선 grant.
3. **Stuck holder swap** — holder가 velocity=0으로 2초 이상 stuck이고 큐에 ready한
   차량이 있으면 holder 강제 이전. 최후의 안전망.

3종은 **개별 노드별로 다른 해결책이 아니라**, DZ로 마킹된 *모든* 노드에 같은 메커니즘이
자동 적용된다.

→ **상세 (checkpoint flags / 처리 흐름 / catch-up loop / DZ 메커니즘 코드 / 파일 맵)**:
[`../src/common/vehicle/logic/LockMgr/README.md`](../src/common/vehicle/logic/LockMgr/README.md)

---

## 12. 로그 / 관측 시스템

### 12.1 왜 OPFS + binary

브라우저 안에서 도는 시뮬레이션의 이벤트를 파일에 영구 저장해야 한다. 후보를
검토했을 때 hot path를 견디는 건 OPFS가 유일했다:

| 옵션 | 한계 |
|------|------|
| `localStorage` | 5MB, string only |
| `IndexedDB` | async + tx 오버헤드 → 60FPS × 수천 record/s 못 견딤 |
| File System Access API | 매번 사용자 권한 prompt |
| **OPFS** (`FileSystemSyncAccessHandle`) | Worker에서 sync raw byte write. 권한 불필요 |

포맷은 binary 고정 크기 record. text 로그가 차량 800대 × 하루 = ~100GB 쌓이는 걸
경험한 적 있어서 — 정상 동작 로그를 GB 단위로 들고 있을 이유 없고, 문제 구간만
잘라서 보면 된다는 판단. binary로 5~10배 압축 + Python `numpy.fromfile` 한 줄로 read.

### 12.2 두 layer

```
FabContext.step():
  ├─ 1. checkCollisions
  ├─ 2. lockMgr.updateAll()   ── onLockEvent ──┐
  ├─ 3. updateMovement        ── onEdgeTransit ─┤
  ├─ 4. autoMgr.update()      ── onPathFound ──┤   콜백 hook
  ├─ 4.5. path-change reconcile                │
  ├─ 5. ReplaySnapshot (0.5s)                  │
  ├─ 6. DebugSnapshot (100ms) ──┐              │
  ├─ 7. flushOrderStats (2s)    │              │
  └─ 8. writeToRenderRegion     │              │
                                ▼              ▼
            ┌────────────────────────┐  ┌─────────────────────────┐
            │ SnapshotLogger          │  │ SimLogger (event-driven)│
            │ - 가변 크기 block       │  │ - 고정 크기 record 10종 │
            │ - 100ms마다 전체 차량   │  │ - 16 ~ 44B/record       │
            │   + edge queue snapshot │  │ - 512 records buffer    │
            └───────────┬─────────────┘  └─────┬───────────┬───────┘
                        ▼                       ▼           ▼
                  OPFS (Worker sync write)             DbShipper
                  files: {sessionId}_{fabId}_*.bin    (선택, MQTT)
                                                       │
                                                       ▼
                                          PostgreSQL (ML dataset 적재)
```

- **SimLogger** — event-driven. `ML_ORDER_COMPLETE` / `ML_EDGE_TRANSIT` / `ML_LOCK` /
  `ML_REPLAY_SNAPSHOT` (학습용) + 6종 dev 이벤트 (디버그용). 모두 고정 크기 record.
- **SnapshotLogger** — 시간 주기 (100ms). 그 시점 전체 차량 상태 + 활성 edge queue를
  가변 크기 block으로. deadlock 추적 / replay 용도.
- **OPFS + MQTT 병행** — OPFS는 단일 세션 로컬 분석용. MQTT는 PostgreSQL 적재(ML dataset).
  둘은 독립이라 한쪽 끊겨도 다른 쪽 무사.

### 12.3 분석 워크플로우

```
Browser (OPFS)
   │ simLogUtils.downloadSimLogFile(fileName)
   ▼
Downloads/*.bin
   │ mv → logs/{sessionId}/
   ▼
scripts/log_parser/
   ├─ log_parser.py            # .bin → DataFrame
   ├─ analyze.py               # 이벤트별 분석
   └─ snapshot_streaming.py    # 큰 snapshot.bin (>200MB OOM 방지)
```

스키마는 write side (`SimLogger.ts` / `protocol.ts`)와 read side
(`scripts/log_parser/*.py`)에 양쪽 수동으로 같은 byte layout을 적어둠 — AI에게
양쪽 동시에 작성하게 하면 sync 비용이 거의 0이라 IDL을 따로 두지 않았다.
FlatBuffers 스키마 정의 + flatc codegen은 한 번 시도했지만 ML 파이프라인을
본격적으로 짤 때 다시 도입 예정 ([`schema/dev_log.fbs`](../schema/dev_log.fbs)).

**상세**: [`src/logger/README.md`](../src/logger/README.md)
