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

FAB 시스템은 **시뮬레이션**과 **렌더링**이 완전히 다른 방식으로 동작합니다.

```
┌─────────────────────────────────────────────────────────────────┐
│                        시뮬레이션 (Worker)                       │
│                                                                  │
│    fab_0 (원본)        fab_1 (offset)       fab_2 (offset)      │
│    ┌─────────┐        ┌─────────┐          ┌─────────┐         │
│    │edge0001 │        │edge1001 │          │edge2001 │         │
│    │node0001 │        │node1001 │          │node2001 │         │
│    │(0,0)    │        │(110,0)  │          │(220,0)  │         │
│    └─────────┘        └─────────┘          └─────────┘         │
│         │                  │                    │               │
│    각 fab은 자신만의 offset된 맵 복사본을 가지고                  │
│    그 위에서 이동, 충돌감지, 경로탐색 수행                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        렌더링 (Main Thread)                      │
│                                                                  │
│    원본 맵 데이터 1개 + 슬롯 offset으로 25개 fab 표시             │
│                                                                  │
│    originalMapData          slots (max 25)                       │
│    ┌─────────┐              ┌─────┐ ┌─────┐ ┌─────┐             │
│    │edge0001 │      →       │fab0 │ │fab1 │ │fab2 │ ...         │
│    │node0001 │    offset    │+0,0 │ │+110 │ │+220 │             │
│    └─────────┘      적용    └─────┘ └─────┘ └─────┘             │
│                                                                  │
│    메모리 절약: 맵 데이터 1벌만 저장                              │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 Worker에서 FAB별 맵 복사

`SimulationEngine.calculateFabData()`가 각 FAB에 맞게 맵을 복사/변환합니다.

| FAB | Edge 이름 | 좌표 offset | 설명 |
|-----|-----------|-------------|------|
| fab_0 | edge0001 | (0, 0) | 원본 그대로 |
| fab_1 | edge1001 | (110, 0) | ID + 1000, 좌표 + xOffset |
| fab_2 | edge2001 | (220, 0) | ID + 2000, 좌표 + 2*xOffset |
| fab_N | edgeN001 | (N*110, 0) | ID + N*1000, 좌표 + N*xOffset |

**각 FabContext는 자신만의 offset된 맵 위에서 독립적으로 시뮬레이션합니다.**

### 4.3 FabContext 구조

```
FabContext ("fab_0_1")
├── fabId: "fab_0_1"
├── edges: Edge[]              ← offset된 맵 데이터 (edge1001, edge1002...)
├── nodes: Node[]              ← offset된 좌표 (x+110, y+0)
├── edgeNameToIndex: Map       ← edge1001 → 0
│
├── store: EngineStore         ← SharedBuffer 접근
│   └── vehicleDataArray       ← 이 FAB의 차량들 (offset된 좌표)
│
├── edgeVehicleQueue           ← edge별 차량 목록 (충돌감지용)
├── lockMgr: LockMgr           ← Merge 노드 잠금
├── transferMgr: TransferMgr   ← 차량 이동 명령
└── autoMgr: AutoMgr           ← 자동 라우팅
```

**자세한 내용**: [FabContext 설계 개념](../src/shmSimulator/core/README.md#개념-왜-이렇게-설계했나)

### 4.4 Main Thread 렌더링 (Slot 기반)

Main Thread는 메모리 절약을 위해 **원본 맵 데이터 1개만 저장**하고, **슬롯 offset**으로 여러 FAB을 표시합니다.

```
┌─────────────────────────────────────────────────────────────────┐
│                     카메라 위치 기반 슬롯 할당                    │
│                                                                  │
│    카메라가 fab_5 근처에 있으면:                                  │
│    → 가장 가까운 25개 fab을 슬롯에 할당                          │
│    → 각 슬롯은 fab 위치까지의 offset 값을 가짐                   │
│                                                                  │
│    slot[0]: fabIndex=5,  offsetX=550, offsetY=0                 │
│    slot[1]: fabIndex=4,  offsetX=440, offsetY=0                 │
│    slot[2]: fabIndex=6,  offsetX=660, offsetY=0                 │
│    ...                                                           │
│                                                                  │
│    EdgeRenderer:                                                 │
│    {slots.map((slot) => (                                       │
│      <group position={[slot.offsetX, slot.offsetY, 0]}>         │
│        {/* 원본 edge 데이터를 이 위치에 렌더링 */}               │
│      </group>                                                    │
│    ))}                                                           │
└─────────────────────────────────────────────────────────────────┘
```

### 4.5 차량 렌더링

차량은 Worker에서 **이미 offset된 좌표**로 SharedBuffer에 저장되므로, 렌더러는 그대로 읽어서 표시합니다.

```typescript
// VehicleArrayRenderer - 슬롯 offset 없이 그대로 렌더링
posArr[i3] = data[ptr + MovementData.X];      // 이미 fab offset 적용됨
posArr[i3 + 1] = data[ptr + MovementData.Y];  // 이미 fab offset 적용됨
```

| 구분 | 맵 렌더링 | 차량 렌더링 |
|------|----------|------------|
| 데이터 | 원본 1개 | fab별 offset된 좌표 |
| offset 적용 | 렌더러에서 slot offset | 이미 적용됨 (그대로) |
| 메모리 | 원본 × 1 | 전체 차량 수 × 22 floats |

### 4.6 디버깅 시 주의사항

차량 클릭 시 표시되는 edge 정보가 헷갈릴 수 있습니다.

```
┌─────────────────────────────────────────────────────────────────┐
│  차량 정보 표시 (UI)                                             │
│                                                                  │
│  실제 저장값:  currentEdgeIndex = 5                              │
│  UI 표시:      "E5" (index 그대로)                               │
│                                                                  │
│  ⚠️ 주의:                                                        │
│  - fab_0 차량: E5 → 실제 edge0005                               │
│  - fab_1 차량: E5 → 실제 edge1005                               │
│  - fab_2 차량: E5 → 실제 edge2005                               │
│                                                                  │
│  모든 fab에서 "E5"로 보이지만, 실제 edge 이름은 fab마다 다름!     │
│  edge index는 각 fab의 edges[] 배열 내 순서                      │
└─────────────────────────────────────────────────────────────────┘
```

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

### 7.1 Slot 기반 렌더링

화면에 보이는 FAB만 렌더링하여 성능 최적화합니다.

**자세한 내용**: [Three.js 렌더링 시스템 - Slot 기반 렌더링](../src/components/three/README.md#slot-기반-맵-렌더링)

```
┌─────────────────────────────────────────────────────────────────┐
│                     카메라 뷰포트                                │
│                                                                  │
│    ┌─────────────────────────────────────────────────────┐      │
│    │  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐           │      │
│    │  │ S0  │ │ S1  │ │ S2  │ │ S3  │ │ S4  │           │      │
│    │  │fab_0│ │fab_1│ │fab_2│ │fab_3│ │fab_4│           │      │
│    │  └─────┘ └─────┘ └─────┘ └─────┘ └─────┘           │      │
│    │  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐           │      │
│    │  │ S5  │ │ S6  │ │ S7  │ │ S8  │ │ S9  │  ...      │      │
│    │  │fab_5│ │fab_6│ │fab_7│ │fab_8│ │fab_9│           │      │
│    │  └─────┘ └─────┘ └─────┘ └─────┘ └─────┘           │      │
│    │                                                     │      │
│    │  maxVisibleFabs = 25 (설정값)                       │      │
│    │  카메라에서 가장 가까운 25개 FAB만 렌더링            │      │
│    └─────────────────────────────────────────────────────┘      │
│                                                                  │
│    나머지 FAB들은 시뮬레이션만 (렌더링 안 함)                   │
└─────────────────────────────────────────────────────────────────┘
```

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
| `LockMgr` | `common/vehicle/logic/` | Merge 노드 잠금 관리 - [상세 문서](../src/common/vehicle/logic/README.md) |
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
