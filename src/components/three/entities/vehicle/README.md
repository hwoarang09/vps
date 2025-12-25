# Vehicle System

3가지 방식의 Vehicle 시스템 구현 및 성능 비교

## 📁 파일 구조

```
src/
├── store/
│   └── vehicleRapierStore.ts          # Rapier용 store (Array/Dict 모드)
├── components/three/
│   ├── entities/vehicle/
│   │   ├── VehicleRapierArrayMode.tsx    # Rapier + Array 방식
│   │   ├── VehicleRapierDictMode.tsx     # Rapier + Dict 방식
│   │   ├── VehicleSharedMemoryMode.tsx   # SharedMemory 방식
│   │   ├── VehicleSystem.tsx             # 통합 컴포넌트
│   │   └── VehicleSystemTest.tsx         # 테스트/비교 컴포넌트
│   └── renderers/
│       └── VehiclesRenderer.tsx          # InstancedMesh 렌더러
```

## 🎯 3가지 모드

### 1. **Rapier Array Mode** (`rapier-array`)
- **데이터 구조**: `Float32Array` (일렬 배열)
- **특징**: 
  - 공유메모리와 동일한 구조
  - 캐시 친화적, 메모리 효율적
  - 인덱스 계산으로 직접 접근
- **장점**: 빠른 순차 접근, 메모리 효율
- **단점**: 동적 추가/삭제 어려움

### 2. **Rapier Dict Mode** (`rapier-dict`)
- **데이터 구조**: `Map<number, VehicleRefData>` (딕셔너리)
- **특징**:
  - Vehicle마다 개별 객체
  - 동적 추가/삭제 용이
  - 객체 기반 접근
- **장점**: 유연한 관리, 직관적
- **단점**: 메모리 오버헤드, 캐시 미스 가능

### 3. **Shared Memory Mode** (`shared-memory`)
- **데이터 구조**: `SharedArrayBuffer` + `Float32Array`
- **특징**:
  - Worker와 공유 가능
  - 직접 메모리 접근
  - 멀티스레드 준비
- **장점**: Worker 사용 가능, 최고 성능
- **단점**: 브라우저 지원 필요

## 🚀 사용법

### 기본 사용

```tsx
import VehicleSystem from './components/three/entities/vehicle/VehicleSystem';

function App() {
  return (
    <Canvas>
      <VehicleSystem
        mode="rapier-array"  // or "rapier-dict" or "shared-memory"
        numVehicles={100}
        maxVehicles={200000}
        vehicleSize={1.5}
        vehicleColor="#4ecdc4"
      />
    </Canvas>
  );
}
```

### 테스트 컴포넌트 사용

```tsx
import VehicleSystemTest from './components/three/entities/vehicle/VehicleSystemTest';

function App() {
  return (
    <Canvas>
      <VehicleSystemTest />
    </Canvas>
  );
}
```

## 📊 성능 비교

각 모드의 성능을 비교하려면:

1. `VehicleSystemTest` 컴포넌트 사용
2. 브라우저 DevTools의 Performance 탭 열기
3. 각 모드로 전환하며 FPS 측정
4. Vehicle 수를 늘려가며 테스트

### 예상 성능 순위
1. **Shared Memory** - 가장 빠름 (직접 메모리 접근)
2. **Rapier Array** - 빠름 (캐시 친화적)
3. **Rapier Dict** - 보통 (객체 오버헤드)

## 🔧 구조 설명

### 역할 분리

1. **Entity 컴포넌트** (VehicleRapierArrayMode 등)
   - 경로 계산만 담당
   - 위치/회전 업데이트
   - 렌더링 안 함

2. **Renderer 컴포넌트** (VehiclesRenderer)
   - InstancedMesh로 렌더링만 담당
   - 모든 모드 지원
   - 경로 계산 안 함

### 데이터 흐름

```
Entity Component (useFrame)
  ↓ 경로 계산
  ↓ 위치/회전 업데이트
Store (vehicleRapierStore or vehicleSharedMovement)
  ↓ 데이터 저장
Renderer Component (useFrame)
  ↓ 데이터 읽기
  ↓ InstancedMesh 업데이트
GPU Rendering
```

## 🎨 커스터마이징

### Vehicle 색상 변경

```tsx
<VehicleSystem
  mode="rapier-array"
  vehicleColor="#ff6b6b"  // 빨간색
/>
```

### Vehicle 크기 변경

```tsx
<VehicleSystem
  mode="rapier-array"
  vehicleSize={2.0}  // 더 큰 vehicle
/>
```

### Vehicle 수 동적 변경

```tsx
const [count, setCount] = useState(100);

<VehicleSystem
  mode="rapier-array"
  numVehicles={count}
/>
```

## 📝 TODO

- [ ] Rapier 물리 엔진 실제 통합
- [ ] 충돌 감지 구현
- [ ] Worker 기반 계산 (Shared Memory 모드)
- [ ] 성능 프로파일링 도구
- [ ] Vehicle 간 거리 유지 로직

