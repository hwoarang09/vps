# Visualization System - AI Context

## File Map
```yaml
src/components/three/entities/renderers/VehiclesRenderer/VehiclesRenderer.tsx:39
  purpose: 렌더러 라우터 컴포넌트

  modes:
    VehicleSystemType.RapierDict → VehicleRapierRenderer
    VehicleSystemType.ArraySingle → VehicleArrayRenderer
    VehicleSystemType.SharedMemory → VehicleArrayRenderer

src/components/three/entities/renderers/VehiclesRenderer/VehicleArrayRenderer.tsx
  purpose: InstancedMesh 기반 차량 렌더링 (ArraySingle + SharedMemory 공용)

  key refs:
    bodyMeshRef: InstancedMesh
    instanceDataRef: InstancedBufferAttribute (vec4: x, y, z, rotation_deg)

  useFrame logic:
    SharedMemory 모드:
      → shmSimulatorStore.vehicleRenderBuffer 직접 참조
      → instanceData.array.set(vehicleRenderBuffer) - zero-copy
    ArraySingle 모드:
      → vehicleDataArray.getData() 순회
      → 개별 값 복사

  shader modification:
    mat3 rotateZ(angle) - Z축 회전 행렬
    transformed = rotateZ(rotation) * transformed + instanceData.xyz

src/components/three/entities/renderers/VehiclesRenderer/SensorDebugRenderer.tsx
  purpose: 센서 영역 시각화 (디버그용)

  buffer layout (섹션별 연속):
    Section 0: zone0_startEnd - [FL_x, FL_y, FR_x, FR_y] × numVehicles
    Section 1: zone0_other    - [SL_x, SL_y, SR_x, SR_y] × numVehicles
    Section 2-5: zone1, zone2 동일
    Section 6: body_other     - [BL_x, BL_y, BR_x, BR_y] × numVehicles

  useFrame logic:
    → shmSimulatorStore.sensorRenderBuffer 참조
    → LineSegments geometry position 업데이트

src/store/vehicle/shmMode/shmSimulatorStore.ts
  purpose: SharedMemory 시뮬레이터 상태 관리

  state:
    vehicleRenderBuffer: SharedArrayBuffer | null
    sensorRenderBuffer: SharedArrayBuffer | null
    actualNumVehicles: number  # 모든 fab 합산

  methods:
    init/initMultiFab: 버퍼 생성 및 Worker 전달
    getVehicleRenderData(): Float32Array view

src/shmSimulator/MemoryLayoutManager.ts
  purpose: 메모리 레이아웃 계산

  constants:
    VEHICLE_RENDER_SIZE: 4      # x, y, z, rotation (floats)
    SENSOR_ATTR_SIZE: 4         # 2 points × 2 coords (floats)
    SENSOR_SECTION_COUNT: 7     # 3 zones × 2 + body_other
    SENSOR_RENDER_SIZE: 28      # 7 × 4 floats per vehicle

  SensorSection:
    ZONE0_STARTEND: 0  # FL, FR
    ZONE0_OTHER: 1     # SL, SR
    ZONE1_STARTEND: 2
    ZONE1_OTHER: 3
    ZONE2_STARTEND: 4
    ZONE2_OTHER: 5
    BODY_OTHER: 6      # BL, BR

src/shmSimulator/core/FabContext.ts
  writeToRenderRegion():
    - Worker에서 매 프레임 호출
    - fabOffset 적용하여 렌더 버퍼에 복사
    - 센서 데이터는 섹션별 연속 레이아웃으로 변환

src/common/vehicle/memory/VehicleDataArrayBase.ts
  VEHICLE_DATA_SIZE: 24  # 전체 차량 데이터 크기

  MovementData offsets:
    X: 0, Y: 1, Z: 2, ROTATION: 4
    VELOCITY: 5, EDGE_RATIO: 6, OFFSET: 7
    DECELERATION: 8, MOVING_STATUS: 10

src/common/vehicle/memory/SensorPointArrayBase.ts
  SENSOR_DATA_SIZE: 36  # 3 zones × 12 floats
  SENSOR_POINT_SIZE: 12  # 6 points × 2 coords

  SensorPoint:
    FL_X: 0, FL_Y: 1, FR_X: 2, FR_Y: 3
    BL_X: 4, BL_Y: 5, BR_X: 6, BR_Y: 7
    SL_X: 8, SL_Y: 9, SR_X: 10, SR_Y: 11
```

## Logic Flow

### Render Buffer Flow (SharedMemory Mode)
```
Worker Thread:
  SimulationEngine.step()
  → FabContext.step()
  → FabContext.writeToRenderRegion()
     workerVehicleData[ptr + MovementData.X/Y/Z/ROTATION]
     → vehicleRenderData[renderPtr + 0/1/2/3] + fabOffset

Main Thread:
  VehicleArrayRenderer.useFrame()
  → shmSimulatorStore.vehicleRenderBuffer 참조
  → instanceDataRef.current.array.set(buffer.subarray(...))
  → instanceDataRef.current.needsUpdate = true
  → InstancedMesh 자동 렌더링
```

### Sensor Render Buffer Layout
```
전체 버퍼: 7 sections × totalVehicles × 4 floats

섹션별 연속 레이아웃 (GPU-friendly):
  Section 0: [Veh0_FL,FR | Veh1_FL,FR | ... | VehN_FL,FR]
  Section 1: [Veh0_SL,SR | Veh1_SL,SR | ... | VehN_SL,SR]
  ...
  Section 6: [Veh0_BL,BR | Veh1_BL,BR | ... | VehN_BL,BR]

장점: set()으로 한번에 복사 가능, cache-friendly
```

### InstancedMesh Rendering
```
Three.js InstancedMesh 구조:
  - instanceMatrix: 기본 변환 (identity로 고정)
  - instanceData attribute: vec4 (x, y, z, rotation_deg)
  - shader에서 rotation 적용

Shader 흐름:
  1. transformed = rotateZ(rotation * DEG2RAD) * transformed
  2. transformed += instanceData.xyz
  3. normal도 동일하게 회전 적용
```

### Multi-Fab Rendering
```
Worker 측 (각 FabContext):
  writeToRenderRegion()
  → 각 fab의 차량을 전체 버퍼 내 자기 영역에 기록
  → fabOffset (x, y) 적용

버퍼 레이아웃:
  [Fab0 vehicles | Fab1 vehicles | Fab2 vehicles | ...]
  vehicleStartIndex로 각 fab의 시작 위치 결정

Main Thread:
  → 전체 버퍼를 하나의 InstancedMesh로 렌더링
  → 차량 수 = sum(모든 fab의 actualNumVehicles)
```

## Critical Rules

**Zero-Copy 원칙:**
- Main Thread에서 Worker 버퍼 직접 참조 (복사 X)
- SharedArrayBuffer를 통한 무잠금 공유
- set() 메서드로 배열 블록 복사 (개별 복사 X)

**Render vs Worker 버퍼 분리:**
- Worker 버퍼: VEHICLE_DATA_SIZE (24) - 전체 시뮬레이션 데이터
- Render 버퍼: VEHICLE_RENDER_SIZE (4) - x, y, z, rotation만

**GPU-friendly 레이아웃:**
- 센서 데이터는 섹션별 연속 배치
- InstancedBufferAttribute에 DynamicDrawUsage 설정

**fabOffset 적용 위치:**
- Worker의 writeToRenderRegion()에서만 적용
- Main Thread는 offset 인식 불필요

**needsUpdate 호출:**
- 버퍼 수정 후 반드시 needsUpdate = true
- useFrame 내에서만 호출 (React lifecycle 외부)

## Config

### Vehicle Render Data Layout
```yaml
index 0: x (+ fabOffset.x)
index 1: y (+ fabOffset.y)
index 2: z
index 3: rotation (degree)
```

### Sensor Render Data Layout
```yaml
# Per vehicle, per section: 4 floats
startEnd section: [FL_x, FL_y, FR_x, FR_y]
other section: [SL_x, SL_y, SR_x, SR_y]  (zones)
               [BL_x, BL_y, BR_x, BR_y]  (body)
```

## Impact Map

| 수정 | 확인 필요 |
|------|-----------|
| VEHICLE_RENDER_SIZE 변경 | MemoryLayoutManager, FabContext, VehicleArrayRenderer |
| SensorSection 순서 변경 | FabContext.writeToRenderRegion, SensorDebugRenderer |
| instanceData attribute 변경 | shader, buffer 업데이트 로직 |
| fabOffset 로직 변경 | 렌더링 위치, multi-fab 정렬 |
| 버퍼 크기 계산 | calculateRenderLayout, shmSimulatorStore |

## Performance Tips

**InstancedMesh 활용:**
- 10만+ 차량도 단일 draw call로 렌더링
- GPU instancing으로 CPU 부하 최소화

**버퍼 사전 할당:**
- 최대 차량 수 기준으로 미리 할당
- 동적 resize 최소화

**needsUpdate 최적화:**
- 변경된 속성만 needsUpdate = true
- 불필요한 업데이트 방지

**센서 디버그 렌더러:**
- 개발 시에만 활성화
- 프로덕션에서는 비활성화 권장

## Debugging

### 렌더 버퍼 확인
```typescript
// VehicleArrayRenderer.tsx useFrame 내
const data = shmSimulatorStore.getState().vehicleRenderBuffer;
if (data) {
  const view = new Float32Array(data);
  console.log('[Render]', { veh0: [view[0], view[1], view[2], view[3]] });
}
```

### 센서 렌더 확인
```typescript
// SensorDebugRenderer.tsx
console.log('[Sensor]', { section0: sensorData.subarray(0, 16) });
```

### fab별 렌더 영역 확인
```typescript
// FabContext.ts writeToRenderRegion()
console.log('[FabRender]', {
  fabId: this.fabId,
  startIndex: this.vehicleStartIndex,
  count: this.actualNumVehicles,
  offset: this.fabOffset
});
```
