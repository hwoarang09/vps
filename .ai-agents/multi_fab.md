# Multi-Fab System - AI Context

## File Map
```yaml
src/utils/fab/fabUtils.ts:529
  exports:
    getNodeBounds(nodes): MapBounds
      - 노드 배열에서 xMin/xMax/yMin/yMax 계산

    createFabGrid(nodes, edges, gridX, gridY): { allNodes, allEdges }
      - 단일 맵을 X×Y 그리드로 복제 (렌더링용)
      - ID에 fabIndex * 1000 오프셋 적용

    createFabGridSeparated(nodes, edges, stations, gridX, gridY): FabData[]
      - 각 Fab별 분리된 데이터 반환 (멀티 워커용)

    createFabGridStations(stations, gridX, gridY, bounds): Station[]
      - 스테이션 복제 (edge 이름 오프셋 적용)

    createFabInfos(gridX, gridY, bounds, spacingPercent?): FabInfo[]
      - FabInfo 배열 생성 (bounds, center 계산)

    filterNodesByVisibleFabs(nodes, fabs, visibleFabIndices): Node[]
    filterEdgesByVisibleFabs(edges, fabs, visibleFabIndices): Edge[]
    filterStationsByVisibleFabs(stations, fabs, visibleFabIndices): Station[]
      - 카메라 기반 가시 Fab 필터링

  types:
    MapBounds: { xMin, xMax, yMin, yMax, width, height }
    FabData: { fabId, fabIndex, col, row, nodes, edges, stations }

src/store/map/fabStore.ts:275
  state:
    fabCountX, fabCountY: number  # 그리드 크기
    fabs: FabInfo[]               # 각 fab의 bounds/center
    activeFabIndex: number        # 현재 활성 fab
    originalMapData: OriginalMapData | null  # 복제 전 원본 데이터
    visibleFabIndices: Set<number>  # 카메라 기반 가시 fab
    slots: RenderSlot[]           # 렌더링 슬롯 (maxVisibleFabs개)
    slotsVersion: number          # 슬롯 변경 감지

  actions:
    setFabGrid(countX, countY, fabs)
    setOriginalMapData(data)
    updateVisibleFabs(cameraX, cameraY)  # 카메라 거리순 maxVisibleFabs개 선택
    initSlots()                          # 슬롯 초기화
    updateSlots(cameraX, cameraY)        # 슬롯 재할당

  utils:
    isMultiFab(): boolean
    isFabVisible(fabIndex): boolean
    findNearestFab(x, y): number

  types:
    FabInfo: { fabIndex, col, row, xMin, xMax, yMin, yMax, centerX, centerY }
    OriginalMapData: { nodes, edges, stations }
    RenderSlot: { slotId, fabIndex, offsetX, offsetY }

src/store/simulation/fabConfigStore.ts
  purpose: Fab별 시뮬레이션 파라미터 오버라이드

  state:
    baseConfig: BaseSimulationConfig  # 기본값 (simulationConfig에서 로드)
    fabOverrides: Record<number, FabConfigOverride>  # fabIndex → override

  actions:
    setFabOverride(fabIndex, override)
    removeFabOverride(fabIndex)
    getFabConfig(fabIndex): merged config
    getFabSensorPresets(fabIndex): SensorPreset[]  # base + override 병합
    hasOverride(fabIndex): boolean

  types:
    FabConfigOverride: { lock?, movement?, sensor? }
    LockConfigOverride: { waitDistanceFromMergingStr?, grantStrategy?, ... }
    MovementConfigOverride: { linear?: { maxSpeed?, ... }, curve?: { ... } }
    SensorConfigOverride: { presets?: Record<number, SensorPresetOverride> }

src/shmSimulator/core/FabContext.ts:564
  purpose: Fab 단위로 모든 매니저와 메모리를 묶어서 관리

  constructor(params: FabInitParams):
    - EngineStore 생성 (메모리 관리)
    - VehicleDataArrayBase, SensorPointArrayBase, EdgeVehicleQueue
    - LockMgr, TransferMgr, DispatchMgr, RoutingMgr, AutoMgr

  key fields:
    fabId: string
    fabOffset: FabRenderOffset  # { x, y } 렌더링 오프셋
    edges, nodes: 맵 데이터 (sharedMapRef 또는 개별 전달)
    config: SimulationConfig  # fab별 오버라이드 적용된 설정

  methods:
    init(params): 버퍼 설정, 맵 데이터 로드, 차량 초기화
    setRenderBuffer(...): 렌더 버퍼 연결 (Main Thread에서 SET_RENDER_BUFFER로 호출)
    step(clampedDelta, simulationTime): 충돌→라우팅→이동→렌더버퍼 쓰기
    writeToRenderRegion(): fabOffset 적용하여 렌더 버퍼에 복사

src/shmSimulator/types.ts
  SharedMapRef:
    edges, nodes: 원본 맵 데이터 (공유)
    edgeNameToIndex, nodeNameToIndex: 룩업 맵 (공유)
    stations: StationRawData[]

  SharedMapData (Main → Worker 전송용):
    originalEdges, originalNodes, originalStations
    gridX, gridY

  FabOffsetInfo: { fabIndex, col, row }
  FabRenderOffset: { x, y }

  FabMemoryAssignment:
    fabId: string
    vehicleRegion, sensorRegion, pathRegion: MemoryRegion

  MemoryRegion: { offset, size, maxVehicles }

src/components/three/entities/vehicle/vehicleSharedMode/VehicleSharedMemoryMode.tsx
  purpose: Multi-Fab 시뮬레이터 초기화 오케스트레이터

  key logic (L79-156):
    if (isMultiFab):
      - createFabGridSeparated로 각 fab 데이터 분리
      - fabConfigStore에서 fab별 configOverride 조회
      - sharedMapData (원본 1회 전송) + fabs (fab별 설정)
      - initMultiFab 호출
    else:
      - 단일 fab 모드: initSimulator 호출

src/shmSimulator/MemoryLayoutManager.ts
  purpose: 멀티 워커 환경에서 SharedArrayBuffer 메모리 레이아웃 관리

  constants:
    VEHICLE_RENDER_SIZE: 4  # x, y, z, rotation
    VEHICLE_DATA_SIZE: 24   # 전체 차량 데이터
    SENSOR_RENDER_SIZE: 28  # 7 sections × 4 floats

  exports:
    calculateMemoryLayout(fabConfigs): MemoryLayout
    calculateRenderLayout(fabVehicleCounts): RenderLayout
```

## Logic Flow

### Multi-Fab Initialization
```
VehicleSharedMemoryMode.tsx
→ fabStore.isMultiFab() 확인
→ createFabGridSeparated(nodes, edges, stations, gridX, gridY)
   → 각 fab별 FabData 생성 (fabId, fabIndex, col, row)

→ 각 fab에 대해:
   fabConfigStore.getFabConfig(fabIndex)     # lock/movement 설정
   fabConfigStore.getFabSensorPresets(fabIndex)  # 센서 프리셋
   → configOverride 생성

→ initMultiFab({
     fabs: [{ fabId, configOverride, ... }],
     config: baseConfig,
     sharedMapData: { originalEdges, originalNodes, originalStations, gridX, gridY }
   })

Worker 측:
→ SimulationEngine.initWithPayload()
→ 각 fab에 대해:
   fabOffset 계산 (col, row 기반)
   FabContext 생성 (sharedMapRef, fabOffset, config)
```

### Fab Offset Calculation
```
gridX=2, gridY=2 예시:
  fab_0_0 (fabIndex=0): offset (0, 0)
  fab_1_0 (fabIndex=1): offset (width*1.1, 0)
  fab_0_1 (fabIndex=2): offset (0, height*1.1)
  fab_1_1 (fabIndex=3): offset (width*1.1, height*1.1)

ID 오프셋:
  fabIndex=0: node_name 그대로 (N0001)
  fabIndex=1: +1000 (N0001 → N1001)
  fabIndex=2: +2000 (N0001 → N2001)
```

### Render Buffer Flow
```
Worker FabContext.writeToRenderRegion():
  for each vehicle:
    vehicleRenderData[i] = workerData[i] + fabOffset.x
    sensorRenderData[section][i] = workerSensorData[i] + fabOffset

Main Thread VehicleArrayRenderer.useFrame():
  → shmSimulatorStore.vehicleRenderBuffer 직접 참조
  → instanceData attribute 업데이트
  → InstancedMesh 렌더링
```

### Camera-based Visibility
```
useFabStore.updateVisibleFabs(cameraX, cameraY):
  → 모든 fab을 카메라 거리순 정렬
  → 가장 가까운 maxVisibleFabs개 선택
  → visibleFabIndices Set 업데이트

렌더링 시:
  filterNodesByVisibleFabs(nodes, fabs, visibleFabIndices)
  filterEdgesByVisibleFabs(edges, fabs, visibleFabIndices)
```

## Critical Rules

**Fab ID 네이밍:**
- `fab_${col}_${row}` 형식 (예: fab_0_0, fab_1_2)
- fabIndex = row * gridX + col

**ID 오프셋:**
- 노드/엣지 이름의 마지막 4자리 숫자에 fabIndex * 1000 더함
- 예: N0001 + 2000 = N2001

**메모리 분리:**
- Worker 계산용 버퍼 (VehicleDataArray, SensorPointArray)
- 렌더링용 버퍼 (VehicleRenderBuffer, SensorRenderBuffer) - 별도
- SET_RENDER_BUFFER 메시지로 렌더 버퍼 연결

**fabOffset 적용:**
- Worker에서 렌더 버퍼에 쓸 때만 fabOffset 적용
- 내부 시뮬레이션은 원본 좌표 기준
- 각 fab은 "평행우주" - 같은 맵에서 시뮬레이션하지만 fab 간 충돌 없음

**config 오버라이드:**
- fabConfigStore에서 fab별 override 설정
- Worker에 전달 시 configOverride로 병합
- baseConfig + configOverride = 최종 config

## Config

### renderConfig (testSettingConfig.ts)
```yaml
maxVisibleFabs: 25  # 동시에 렌더링할 최대 fab 수
```

### fabStore.slots
```yaml
# 25개 고정 슬롯, 원본 데이터 + offset으로 각 fab 위치 표시
RenderSlot:
  slotId: number     # 0-24
  fabIndex: number   # 현재 표시 중인 fab
  offsetX, offsetY: number  # fab 위치로 이동하기 위한 offset
```

## Impact Map

| 수정 | 확인 필요 |
|------|-----------|
| fabUtils ID 오프셋 로직 | 노드/엣지 이름 충돌, 경로 탐색 오류 |
| fabStore 상태 | VehicleSharedMemoryMode, 렌더링 컴포넌트들 |
| FabContext fabOffset | writeToRenderRegion, 렌더링 위치 |
| fabConfigStore override | VehicleSharedMemoryMode configOverride 생성 |
| maxVisibleFabs 변경 | 슬롯 초기화, 메모리 사용량 |
| SharedMapData 구조 | SimulationEngine, FabContext 초기화 |

## Debugging

### Fab 생성 확인
```typescript
// fabUtils.ts createFabGridSeparated()
console.log('[FabGrid]', { fabDataList: fabDataList.map(f => ({ fabId: f.fabId, nodeCount: f.nodes.length })) });
```

### Fab별 config 확인
```typescript
// VehicleSharedMemoryMode.tsx
console.log('[FabConfig]', { fabId, configOverride });
```

### fabOffset 확인
```typescript
// FabContext.ts writeToRenderRegion()
console.log('[FabOffset]', { fabId: this.fabId, offset: this.fabOffset });
```
