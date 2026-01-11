# Three.js 렌더링 시스템

Main Thread에서 실행되는 Three.js 기반 3D 렌더링 시스템입니다. Worker에서 계산된 시뮬레이션 결과를 읽어 화면에 표시합니다.

## 개념 (왜 이렇게 설계했나)

### Main Thread 역할 분리

```
Main Thread                     Worker Thread
┌─────────────────┐            ┌─────────────────────┐
│ Three.js        │            │ SimulationEngine    │
│ - 맵 렌더링      │            │ - 충돌 감지          │
│ - 차량 렌더링    │            │ - 이동 계산          │
│ - UI 렌더링     │            │ - 경로 탐색          │
│                 │            │                     │
│ READ ONLY       │            │ WRITE               │
│     ↓           │            │     ↓               │
│ SharedBuffer ◀──┼────────────┼─────────────────────│
└─────────────────┘            └─────────────────────┘
```

**역할:**
- **Main Thread**: SharedArrayBuffer를 **읽기만** 하고 Three.js로 렌더링
- **Worker Thread**: 시뮬레이션 계산 후 SharedArrayBuffer에 **쓰기**

**이유:**
- Main Thread가 계산 부담 없이 60 FPS 렌더링 유지
- 시뮬레이션 프레임(Worker)과 렌더링 프레임(Main)이 독립적으로 동작
- UI 반응성 보장 (계산 부하가 UI를 블로킹하지 않음)

### InstancedMesh 기반 렌더링

수천~수십만 개의 객체를 **단일 draw call**로 렌더링합니다.

```typescript
// 나쁜 예: 차량 1000대 = 1000 draw calls
for (const vehicle of vehicles) {
  <mesh position={vehicle.position} />  // N draw calls
}

// 좋은 예: 차량 1000대 = 1 draw call
<instancedMesh count={1000}>
  {/* GPU가 1000개 인스턴스를 한 번에 렌더링 */}
</instancedMesh>
```

**이유:**
- Draw call 수를 획기적으로 감소 (성능 향상)
- GPU 인스턴싱 활용 (병렬 처리)
- 수십만 대 차량도 부드럽게 렌더링 가능

### Shader 기반 Transform

InstancedMesh의 기본 instanceMatrix 대신 **Custom Shader**로 transform 수행합니다.

```typescript
// Custom vertex shader
attribute vec3 instancePosition;  // 차량 위치
attribute float instanceRotation; // 차량 회전

void main() {
  // Shader에서 직접 위치/회전 계산
  vec3 transformed = rotateZ(instanceRotation) * position;
  transformed += instancePosition;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
}
```

**기존 방식 (instanceMatrix) vs Shader 방식:**

| 방식 | CPU 부담 | 메모리 | GC |
|------|---------|--------|-----|
| instanceMatrix | 매 프레임 Matrix4 계산 (무거움) | Matrix4 × N (176 bytes/차량) | 객체 생성 발생 |
| Shader | Float 복사만 (가벼움) | Float × 4 (16 bytes/차량) | Zero-GC |

**이유:**
- CPU 계산 최소화 (Matrix4 생성/연산 없음)
- 메모리 사용량 1/11 감소
- GC 압력 제거 (Zero-GC)
- GPU가 병렬로 transform 수행

### Slot 기반 맵 렌더링

**원본 맵 데이터 1개**만 저장하고, **slot offset**으로 여러 FAB을 렌더링합니다.

```
원본 맵 데이터 (1개)        Slot 기반 렌더링 (최대 25개)
┌─────────┐               ┌─────┐ ┌─────┐ ┌─────┐
│edge0001 │               │fab0 │ │fab1 │ │fab2 │ ...
│node0001 │    →          │+0,0 │ │+110 │ │+220 │
└─────────┘    offset     └─────┘ └─────┘ └─────┘
                적용
```

**동작:**
1. 카메라 위치 변화 감지 (100 단위 이상 이동 시)
2. 가장 가까운 25개 FAB 선택
3. 각 FAB의 offset 계산
4. slot offset으로 렌더링

**이유:**
- 맵 데이터 메모리를 1/N로 절약 (50개 FAB → 원본 1개만)
- 화면에 보이는 FAB만 렌더링 (성능 최적화)
- 카메라 이동 시에만 slot 업데이트 (불필요한 계산 방지)

---

## 코드 가이드 (API, 사용법)

### 렌더링 계층 구조

```
ThreeMain.tsx
├── MapRenderer                    ← 맵 전체 렌더링
│   ├── EdgeRenderer               ← Edge 렌더링 (InstancedMesh)
│   ├── NodesRenderer              ← Node 렌더링 (InstancedMesh)
│   └── StationRenderer            ← Station 렌더링 (InstancedMesh)
│
└── VehiclesRenderer               ← 차량 렌더링 라우터
    ├── VehicleArrayRenderer       ← array/shm 모드 (InstancedMesh + Shader)
    └── VehicleRapierRenderer      ← rapier 모드 (실험용)
```

---

### MapRenderer

**역할:** 맵 전체를 렌더링하고, 카메라 위치에 따라 slot을 업데이트합니다.

#### Slot 업데이트 로직

```typescript
// MapRenderer.tsx
const CAMERA_MOVE_THRESHOLD = 100;  // 100 단위 이상 이동 시 업데이트

useFrame(({ camera }) => {
  if (fabs.length <= 1) return;  // 단일 FAB은 스킵

  const { x: cx, y: cy } = camera.position;
  const { x: lastX, y: lastY } = lastCameraPosRef.current;

  // 임계값 이상 이동했을 때만 업데이트
  const dx = cx - lastX;
  const dy = cy - lastY;
  if (dx * dx + dy * dy > CAMERA_MOVE_THRESHOLD * CAMERA_MOVE_THRESHOLD) {
    lastCameraPosRef.current = { x: cx, y: cy };
    updateSlots(cx, cy);  // fabStore의 slot 갱신
  }
});
```

#### 단일 FAB vs 멀티 FAB

```typescript
// 단일 FAB: store 데이터 직접 사용
if (fabs.length <= 1 || slots.length === 0) {
  return (
    <group>
      <EdgeRenderer edges={storeEdges} />
      <NodesRenderer nodeIds={nodeIds} />
      <StationRenderer stations={storeStations} />
    </group>
  );
}

// 멀티 FAB: 원본 데이터 + slot offset
return (
  <group>
    {slots.map((slot) => (
      <group key={slot.slotId} position={[slot.offsetX, slot.offsetY, 0]}>
        <EdgeRenderer edges={originalMapData.edges} />
        <NodesRenderer nodeIds={nodeIds} />
        <StationRenderer stations={originalMapData.stations} />
      </group>
    ))}
  </group>
);
```

**slot 구조:**

```typescript
interface FabSlot {
  slotId: string;       // 슬롯 ID
  fabIndex: number;     // FAB 인덱스
  offsetX: number;      // X offset (fab 위치)
  offsetY: number;      // Y offset (fab 위치)
}
```

---

### VehicleArrayRenderer

**역할:** SharedArrayBuffer를 읽어 차량을 렌더링합니다. InstancedMesh + Shader 기반으로 고성능 렌더링을 수행합니다.

#### 데이터 소스 선택

```typescript
// mode에 따라 적절한 store에서 데이터 가져오기
const isSharedMemory = mode === VehicleSystemType.SharedMemory;

const arrayActualNumVehicles = useVehicleArrayStore((state) => state.actualNumVehicles);
const shmTotalVehicles = useShmSimulatorStore((state) => {
  const total = Object.values(state.fabVehicleCounts).reduce((sum, count) => sum + count, 0);
  return total > 0 ? total : state.actualNumVehicles;
});

const actualNumVehicles = isSharedMemory ? shmTotalVehicles : arrayActualNumVehicles;
```

#### Shader 기반 인스턴싱 설정

```typescript
// 1. Geometry에 instanced attributes 추가
const bodyGeometry = useMemo(() => {
  const geo = new THREE.BoxGeometry(bodyLength, bodyWidth, bodyHeight);

  const positionAttr = new THREE.InstancedBufferAttribute(
    new Float32Array(initialCount * 3), 3
  );
  positionAttr.setUsage(THREE.DynamicDrawUsage);

  const rotationAttr = new THREE.InstancedBufferAttribute(
    new Float32Array(initialCount), 1
  );
  rotationAttr.setUsage(THREE.DynamicDrawUsage);

  geo.setAttribute('instancePosition', positionAttr);
  geo.setAttribute('instanceRotation', rotationAttr);

  return geo;
}, [bodyLength, bodyWidth, bodyHeight, actualNumVehicles]);

// 2. Material에 custom shader 주입
const bodyMaterial = useMemo(() => {
  const mat = new THREE.MeshStandardMaterial({ color: vehicleColor });

  mat.onBeforeCompile = (shader) => {
    // Vertex shader에 instanced attributes 추가
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
      attribute vec3 instancePosition;
      attribute float instanceRotation;

      mat3 rotateZ(float angle) {
        float c = cos(angle);
        float s = sin(angle);
        return mat3(c, -s, 0.0, s, c, 0.0, 0.0, 0.0, 1.0);
      }`
    );

    // Transform 로직 주입
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      transformed = rotateZ(instanceRotation) * transformed;
      transformed += instancePosition;`
    );
  };

  return mat;
}, [vehicleColor]);
```

#### 매 프레임 업데이트 (Zero-GC)

```typescript
useFrame(() => {
  const positionAttr = positionAttrRef.current;
  const rotationAttr = rotationAttrRef.current;
  if (!positionAttr || !rotationAttr) return;

  // SharedArrayBuffer에서 직접 읽기 (Zero-Copy)
  const data = isSharedMemory
    ? useShmSimulatorStore.getState().getVehicleData()
    : vehicleDataArray.getData();
  if (!data) return;

  const posArr = positionAttr.array as Float32Array;
  const rotArr = rotationAttr.array as Float32Array;

  // Float 배열에 직접 복사 (객체 생성 없음 = Zero-GC)
  for (let i = 0; i < actualNumVehicles; i++) {
    const ptr = i * VEHICLE_DATA_SIZE;
    const i3 = i * 3;

    // 위치
    posArr[i3]     = data[ptr + MovementData.X];
    posArr[i3 + 1] = data[ptr + MovementData.Y];
    posArr[i3 + 2] = data[ptr + MovementData.Z];

    // 회전 (도 → 라디안)
    rotArr[i] = data[ptr + MovementData.ROTATION] * DEG_TO_RAD;
  }

  // GPU에 업데이트 알림
  positionAttr.needsUpdate = true;
  rotationAttr.needsUpdate = true;
});
```

**Zero-GC 달성 방법:**
- `new THREE.Vector3()` 없음
- `new THREE.Matrix4()` 없음
- 객체 리터럴 `{ x, y, z }` 없음
- Float 배열에 직접 쓰기만 수행

---

### EdgeRenderer

**역할:** Edge를 타입별로 그룹화하여 InstancedMesh로 렌더링합니다.

#### Edge 타입별 그룹화

```typescript
const edgesByType = useMemo(() => {
  const grouped: Record<string, Edge[]> = {
    [EdgeType.LINEAR]: [],
    [EdgeType.CURVE_90]: [],
    [EdgeType.CURVE_180]: [],
    [EdgeType.CURVE_CSC]: [],
    [EdgeType.S_CURVE]: [],
  };

  for (const edge of edges) {
    if (edge.rendering_mode === "preview") continue;

    if (edge.renderingPoints && edge.renderingPoints.length > 0) {
      const type = edge.vos_rail_type || EdgeType.LINEAR;
      if (grouped[type]) {
        grouped[type].push(edge);
      }
    }
  }

  return grouped;
}, [edges]);
```

#### 단일 FAB vs 멀티 FAB (Slot)

```typescript
// 단일 FAB: offset 없이 렌더링
if (fabs.length <= 1 || slots.length === 0) {
  return (
    <group>
      <EdgeTypeRenderer edges={edgesByType[EdgeType.LINEAR]} ... />
      <EdgeTypeRenderer edges={edgesByType[EdgeType.CURVE_90]} ... />
      ...
    </group>
  );
}

// 멀티 FAB: 각 slot마다 offset 적용
return (
  <group>
    {slots.map((slot) => (
      <group key={slot.slotId} position={[slot.offsetX, slot.offsetY, 0]}>
        <EdgeTypeRenderer edges={edgesByType[EdgeType.LINEAR]} ... />
        <EdgeTypeRenderer edges={edgesByType[EdgeType.CURVE_90]} ... />
        ...
      </group>
    ))}
  </group>
);
```

---

## 렌더링 루프 (전체 흐름)

```
Main Thread (requestAnimationFrame)
     │
     ├─ useFrame() 콜백 호출 (React Three Fiber)
     │       │
     │       ├─ MapRenderer
     │       │       │
     │       │       ├─ 카메라 위치 확인
     │       │       ├─ 임계값 초과 시 updateSlots()
     │       │       │       └─ fabStore.updateSlots(cx, cy)
     │       │       │           ├─ 카메라에서 가까운 25개 FAB 선택
     │       │       │           └─ slot[] 업데이트
     │       │       │
     │       │       └─ EdgeRenderer, NodesRenderer, StationRenderer
     │       │           └─ InstancedMesh 렌더링 (slot offset 적용)
     │       │
     │       └─ VehicleArrayRenderer
     │               │
     │               ├─ SharedArrayBuffer 읽기 (Zero-Copy)
     │               │       └─ useShmSimulatorStore.getState().getVehicleData()
     │               │
     │               ├─ instancePosition[] 업데이트
     │               │   posArr[i3]   = data[ptr + X]
     │               │   posArr[i3+1] = data[ptr + Y]
     │               │   posArr[i3+2] = data[ptr + Z]
     │               │
     │               ├─ instanceRotation[] 업데이트
     │               │   rotArr[i] = data[ptr + ROTATION] * DEG_TO_RAD
     │               │
     │               ├─ needsUpdate = true (GPU에 알림)
     │               │
     │               └─ GPU가 Shader로 transform + 렌더링
     │
     └─ Three.js가 화면에 렌더링
```

**핵심:**
- `useFrame()`: 매 프레임마다 실행 (60 FPS 목표)
- SharedArrayBuffer 읽기: Worker가 쓴 데이터를 읽기만 (Zero-Copy)
- Instanced Attributes 업데이트: Float 배열에 직접 쓰기 (Zero-GC)
- GPU Shader: 위치/회전 transform을 GPU에서 병렬 수행

---

## 최적화 기법 정리

### 1. InstancedMesh

**문제:** 차량 10만 대 = 10만 draw calls → GPU 병목
**해결:** InstancedMesh로 1 draw call → GPU 인스턴싱

### 2. Shader 기반 Transform

**문제:** Matrix4 계산 + 복사 → CPU 병목 + GC 발생
**해결:** Shader에서 직접 transform → CPU 부담 ↓, Zero-GC

### 3. Zero-GC

**문제:** 매 프레임 객체 생성 → GC 스파이크 → 프레임 드롭
**해결:** Float 배열 재사용 → GC 압력 제거

### 4. Slot 기반 렌더링

**문제:** 50개 FAB 전체 렌더링 → 메모리 + GPU 부담
**해결:** 가까운 25개만 렌더링 → 성능 향상

### 5. 카메라 임계값

**문제:** 매 프레임 slot 업데이트 → 불필요한 계산
**해결:** 100 단위 이상 이동 시만 업데이트 → CPU 절약

---

## 성능 프로파일링

### useFrame 측정

```typescript
useFrame(() => {
  const start = performance.now();

  // ... 렌더링 로직

  const elapsed = performance.now() - start;
  if (elapsed > 16.67) {  // 60 FPS 기준
    console.warn(`[VehicleArrayRenderer] Slow frame: ${elapsed.toFixed(2)}ms`);
  }
});
```

### 메모리 사용량 추정

```typescript
// InstancedMesh 메모리 (Shader 방식)
const instanceMemory = actualNumVehicles * (
  3 * 4 +  // instancePosition (vec3)
  1 * 4    // instanceRotation (float)
);  // = 16 bytes/차량

// 예: 10만 대 차량
// 100,000 × 16 bytes = 1.6 MB (매우 경량)

// 비교: instanceMatrix 방식
// 100,000 × 16 floats × 4 bytes = 6.4 MB (4배 무거움)
```

---

## 주의사항

### SharedArrayBuffer 읽기만

Main Thread는 **절대 SharedArrayBuffer에 쓰지 않습니다**.

```typescript
// ✅ 올바른 사용
const data = useShmSimulatorStore.getState().getVehicleData();
const x = data[ptr + MovementData.X];  // 읽기만

// ❌ 금지 - Worker 데이터 손상
data[ptr + MovementData.X] = newX;  // 쓰기 금지!
```

### useFrame 내 객체 생성 금지

```typescript
// ❌ 잘못된 예 - GC 발생
useFrame(() => {
  const position = new THREE.Vector3(x, y, z);  // 매 프레임 생성
  const matrix = new THREE.Matrix4();           // 매 프레임 생성
});

// ✅ 올바른 예 - Zero-GC
const tempVector = useMemo(() => new THREE.Vector3(), []);  // 1회만 생성
useFrame(() => {
  tempVector.set(x, y, z);  // 재사용
});
```

### Slot 업데이트 임계값 조정

```typescript
// 임계값이 너무 작으면: 불필요한 업데이트 많음 (CPU 낭비)
const CAMERA_MOVE_THRESHOLD = 10;  // 너무 민감

// 임계값이 너무 크면: 화면에 FAB이 늦게 나타남 (사용자 경험 ↓)
const CAMERA_MOVE_THRESHOLD = 1000;  // 너무 둔감

// 적절한 값: 100 (FAB 간격의 1/10 정도)
const CAMERA_MOVE_THRESHOLD = 100;
```

---

## 관련 문서

- [시스템 아키텍처](../../doc/SYSTEM_ARCHITECTURE.md)
- [Worker 시뮬레이션 엔진](../shmSimulator/README.md)
- [Worker 핵심 컴포넌트](../shmSimulator/core/README.md)
