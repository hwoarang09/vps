# Three.js Rendering System

Three.js 기반 3D 렌더링 시스템입니다. React Three Fiber(R3F)를 사용하여 대규모 차량 시뮬레이션을 실시간으로 렌더링합니다.

## 불변조건 (Invariants)

### 렌더링 원칙
- **엔티티 독립성**: 각 Entity는 자신의 geometry/material만 관리한다
- **상태 읽기 전용**: Renderer는 Vehicle 상태를 읽기만 하며, 절대 수정하지 않는다
- **Shader 기반 업데이트**: 대량 렌더링(10k+ objects)은 항상 Shader 사용 필수
- **메모리 참조**: Vehicle 상태는 `src/store/vehicle/`에서만 읽는다

### 성능 제약
- **FAB 수 제한**: 한 번에 보이는 FAB(Floating Action Button) 수는 설정값 이하여야 함
- **InstancedMesh 사용**: 동일한 geometry는 InstancedMesh로 묶어야 함
- **LOD 적용**: 카메라 거리에 따라 디테일 단계 조절
- **불필요한 렌더링 방지**: `useFrame` 내에서 변경사항 없으면 스킵

### Three.js 규칙
- **Dispose 필수**: 컴포넌트 언마운트 시 geometry, material, texture dispose 필수
- **메모리 누수 방지**: BufferGeometry, Texture 등은 사용 후 반드시 정리
- **즉시 업데이트**: Matrix 변경 후 `instancedMesh.instanceMatrix.needsUpdate = true` 호출

## 폴더 구조

```
src/components/three/
├── entities/                   # 렌더링할 엔티티들
│   ├── renderers/              # 렌더러 컴포넌트
│   │   ├── VehiclesRenderer/   # 차량 렌더러
│   │   │   ├── VehiclesRenderer.tsx       # 모드별 렌더러 선택
│   │   │   ├── BaseVehicleRenderer.tsx    # 공통 렌더링 로직
│   │   │   ├── VehicleArrayRenderer.tsx   # arrayMode 전용
│   │   │   ├── VehicleRapierRenderer.tsx  # rapierMode 전용
│   │   │   └── SensorDebugRenderer.tsx    # 센서 디버그 렌더러
│   │   ├── MapRenderer.tsx                # 맵 전체 렌더러
│   │   ├── EdgeRenderer.tsx               # Edge 렌더러
│   │   ├── NodesRenderer.tsx              # Node 렌더러
│   │   ├── StationRenderer.tsx            # Station 렌더러
│   │   └── TextRenderer.tsx               # 텍스트 렌더러
│   │
│   ├── vehicle/                # 차량 시스템
│   │   ├── VehicleSystem.tsx              # 차량 시스템 진입점
│   │   ├── vehicleArrayMode/              # arrayMode 구현
│   │   ├── vehicleRapierMode/             # rapierMode 구현
│   │   └── vehicleSharedMode/             # shmMode 구현
│   │       └── VehicleSharedMemoryMode.tsx
│   │
│   ├── edge/                   # Edge 엔티티
│   ├── node/                   # Node 엔티티
│   ├── station/                # Station 엔티티
│   └── text/                   # 텍스트 엔티티
│       └── instanced/          # InstancedText (대량 텍스트)
│
├── scene/                      # Three.js 씬 설정
│   └── SceneSetup.tsx          # 카메라, 조명, 컨트롤 등
│
├── interaction/                # 마우스 상호작용
│   ├── Raycaster.tsx           # 오브젝트 클릭 감지
│   └── CameraControls.tsx      # 카메라 조작
│
└── performance/                # 성능 최적화
    ├── LOD.tsx                 # Level of Detail
    └── Culling.tsx             # Frustum Culling
```

## 핵심 렌더러

### 1. `VehiclesRenderer` - 차량 렌더링

#### 구조
```
VehiclesRenderer (모드 선택)
    ├─ VehicleArrayRenderer (arrayMode)
    ├─ VehicleRapierRenderer (rapierMode)
    └─ (shmMode는 VehicleSharedMemoryMode가 직접 렌더링)
```

#### `BaseVehicleRenderer.tsx` - 공통 로직
```typescript
// InstancedMesh 기반 렌더링
const BaseVehicleRenderer = ({ vehicleData, count }) => {
  const meshRef = useRef<InstancedMesh>(null);
  const tempMatrix = useMemo(() => new Matrix4(), []);
  const tempQuat = useMemo(() => new Quaternion(), []);
  const tempPos = useMemo(() => new Vector3(), []);

  useFrame(() => {
    if (!meshRef.current) return;

    // 모든 차량의 Matrix 업데이트
    for (let i = 0; i < count; i++) {
      const [x, y, z] = vehicleData.getPosition(i);
      const [qx, qy, qz, qw] = vehicleData.getRotation(i);

      tempPos.set(x, y, z);
      tempQuat.set(qx, qy, qz, qw);
      tempMatrix.compose(tempPos, tempQuat, SCALE);

      meshRef.current.setMatrixAt(i, tempMatrix);
    }

    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[null, null, count]}>
      <boxGeometry args={[1.2, 0.6, 0.3]} />
      <meshStandardMaterial color="blue" />
    </instancedMesh>
  );
};
```

#### Shader 기반 렌더링 (대량 차량용)
```typescript
// Custom Shader로 Instance 색상 개별 제어
const vertexShader = `
  attribute vec3 instanceColor;
  varying vec3 vColor;

  void main() {
    vColor = instanceColor;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = `
  varying vec3 vColor;

  void main() {
    gl_FragColor = vec4(vColor, 1.0);
  }
`;

// InstancedBufferAttribute로 색상 전달
const colors = useMemo(() => {
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const [r, g, b] = vehicleData.getColor(i);
    arr[i * 3 + 0] = r;
    arr[i * 3 + 1] = g;
    arr[i * 3 + 2] = b;
  }
  return arr;
}, [count]);

<instancedMesh>
  <bufferGeometry>
    <instancedBufferAttribute
      attach="attributes-instanceColor"
      args={[colors, 3]}
    />
  </bufferGeometry>
  <shaderMaterial
    vertexShader={vertexShader}
    fragmentShader={fragmentShader}
  />
</instancedMesh>
```

---

### 2. `VehicleSharedMemoryMode` - shmMode 렌더링

SharedArrayBuffer를 직접 읽어서 렌더링합니다.

```typescript
const VehicleSharedMemoryMode = ({ fabId }) => {
  const sharedBufferRef = useRef<SharedArrayBuffer | null>(null);
  const vehicleDataRef = useRef<Float32Array | null>(null);

  useEffect(() => {
    // MultiWorkerController로부터 SharedArrayBuffer 획득
    const buffer = controller.getVehicleData(fabId);
    sharedBufferRef.current = buffer;
    vehicleDataRef.current = new Float32Array(buffer);

    return () => {
      // Cleanup (Worker는 별도로 정리)
    };
  }, [fabId]);

  useFrame(() => {
    if (!vehicleDataRef.current || !meshRef.current) return;

    const data = vehicleDataRef.current;
    const count = data.length / 22;

    for (let i = 0; i < count; i++) {
      const offset = i * 22;
      const x = data[offset + 0];
      const y = data[offset + 1];
      const z = data[offset + 2];
      const qx = data[offset + 3];
      const qy = data[offset + 4];
      const qz = data[offset + 5];
      const qw = data[offset + 6];

      tempPos.set(x, y, z);
      tempQuat.set(qx, qy, qz, qw);
      tempMatrix.compose(tempPos, tempQuat, SCALE);

      meshRef.current.setMatrixAt(i, tempMatrix);
    }

    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[null, null, count]}>
      <boxGeometry args={[1.2, 0.6, 0.3]} />
      <meshStandardMaterial />
    </instancedMesh>
  );
};
```

---

### 3. `MapRenderer` - 맵 렌더링

Edge, Node, Station을 한번에 렌더링합니다.

```typescript
const MapRenderer = () => {
  const edges = useEdgeStore((state) => state.edges);
  const nodes = useNodeStore((state) => state.nodes);
  const stations = useStationStore((state) => state.stations);

  return (
    <>
      <EdgeRenderer edges={edges} />
      <NodesRenderer nodes={nodes} />
      <StationRenderer stations={stations} />
    </>
  );
};
```

---

### 4. `InstancedText` - 대량 텍스트 렌더링

Troika-three-text를 사용한 instanced 텍스트입니다.

```typescript
import { Text } from "@react-three/drei";

const InstancedText = ({ texts, positions }) => {
  return (
    <>
      {texts.map((text, i) => (
        <Text
          key={i}
          position={positions[i]}
          fontSize={0.5}
          color="white"
        >
          {text}
        </Text>
      ))}
    </>
  );
};
```

---

## 성능 최적화

### InstancedMesh 사용

```typescript
// ❌ 개별 Mesh (10k 차량 = 10k draw calls)
{vehicles.map((veh, i) => (
  <mesh key={i} position={veh.position}>
    <boxGeometry />
    <meshStandardMaterial />
  </mesh>
))}

// ✅ InstancedMesh (10k 차량 = 1 draw call)
<instancedMesh args={[null, null, 10000]}>
  <boxGeometry />
  <meshStandardMaterial />
</instancedMesh>
```

### LOD (Level of Detail)

```typescript
import { Lod } from "@react-three/drei";

<Lod distances={[0, 50, 100]}>
  {/* 가까이: 고해상도 모델 */}
  <mesh geometry={highPolyGeometry} material={detailedMaterial} />

  {/* 중간: 중간 모델 */}
  <mesh geometry={midPolyGeometry} material={simpleMaterial} />

  {/* 멀리: 단순 박스 */}
  <mesh geometry={boxGeometry} material={flatMaterial} />
</Lod>
```

### Frustum Culling

```typescript
// useFrame 내에서 카메라 절두체 체크
useFrame(({ camera }) => {
  const frustum = new Frustum();
  frustum.setFromProjectionMatrix(
    new Matrix4().multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse
    )
  );

  for (let i = 0; i < count; i++) {
    const [x, y, z] = vehicleData.getPosition(i);
    const isVisible = frustum.containsPoint(new Vector3(x, y, z));

    if (!isVisible) {
      // 보이지 않는 차량은 업데이트 스킵
      continue;
    }

    // 렌더링 로직
  }
});
```

### 메모리 관리

```typescript
useEffect(() => {
  const geometry = new BoxGeometry(1, 1, 1);
  const material = new MeshStandardMaterial();

  return () => {
    // 필수: dispose로 메모리 해제
    geometry.dispose();
    material.dispose();
  };
}, []);
```

---

## 사용 예시

### 기본 렌더링 설정

```typescript
// App.tsx 또는 Scene.tsx
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { VehiclesRenderer } from "./entities/renderers";
import { MapRenderer } from "./entities/renderers";

const Scene = () => {
  return (
    <Canvas camera={{ position: [0, 50, 50], fov: 60 }}>
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 10, 5]} intensity={1} />

      <MapRenderer />
      <VehiclesRenderer />

      <OrbitControls />
    </Canvas>
  );
};
```

### 차량 색상 동적 변경

```typescript
// 속도에 따라 색상 변경
useFrame(() => {
  for (let i = 0; i < count; i++) {
    const speed = vehicleData.getSpeed(i);
    const r = speed / 5.0;  // maxSpeed 5.0 기준
    const g = 1.0 - r;
    const b = 0.0;

    vehicleData.setColor(i, r, g, b);
  }
});
```

### 마우스 클릭으로 차량 선택

```typescript
import { useThree } from "@react-three/fiber";
import { Raycaster } from "three";

const VehicleSelector = () => {
  const { camera, scene } = useThree();
  const raycaster = useMemo(() => new Raycaster(), []);

  const handleClick = useCallback((event: MouseEvent) => {
    const mouse = new Vector2(
      (event.clientX / window.innerWidth) * 2 - 1,
      -(event.clientY / window.innerHeight) * 2 + 1
    );

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(scene.children, true);

    if (intersects.length > 0) {
      const instanceId = intersects[0].instanceId;
      console.log("Selected vehicle:", instanceId);
    }
  }, [camera, scene, raycaster]);

  useEffect(() => {
    window.addEventListener("click", handleClick);
    return () => window.removeEventListener("click", handleClick);
  }, [handleClick]);

  return null;
};
```

---

## 개발 가이드

### 새로운 Entity 추가

1. `entities/` 폴더에 새 폴더 생성
2. Renderer 컴포넌트 작성
3. `MapRenderer` 또는 상위 컴포넌트에서 import

```typescript
// entities/custom/CustomEntity.tsx
export const CustomEntity = ({ data }) => {
  return (
    <mesh position={data.position}>
      <sphereGeometry args={[1, 32, 32]} />
      <meshStandardMaterial color="red" />
    </mesh>
  );
};

// MapRenderer.tsx
import { CustomEntity } from "./entities/custom/CustomEntity";

<MapRenderer>
  <CustomEntity data={customData} />
</MapRenderer>
```

### Shader 작성 시 주의사항

```typescript
// ✅ Uniform 업데이트는 useFrame 외부에서
const uniforms = useMemo(() => ({
  uTime: { value: 0 }
}), []);

useFrame(({ clock }) => {
  uniforms.uTime.value = clock.getElapsedTime();
});

// ❌ 매 프레임 새 객체 생성 (성능 저하)
useFrame(() => {
  const uniforms = { uTime: { value: performance.now() } };  // 나쁨
});
```

### 디버깅 도구

```typescript
// Stats 표시 (FPS, 메모리 등)
import { Stats } from "@react-three/drei";

<Canvas>
  <Stats />
  {/* ... */}
</Canvas>

// 메모리 사용량 체크
import { useFrame } from "@react-three/fiber";

useFrame(({ gl }) => {
  const info = gl.info;
  console.log({
    geometries: info.memory.geometries,
    textures: info.memory.textures,
    programs: info.programs.length,
    calls: info.render.calls,
  });
});
```

---

## 주의사항

### 상태 관리
- **Renderer는 읽기 전용**: Vehicle 상태를 절대 수정하지 않음
- **Store에서만 읽기**: `useVehicleStore()` 또는 SharedArrayBuffer에서만 데이터 획득
- **불필요한 리렌더링 방지**: `useMemo`, `useCallback` 활용

### 메모리 누수 방지
```typescript
// ✅ useEffect cleanup에서 dispose
useEffect(() => {
  const tex = new TextureLoader().load("/texture.png");
  material.map = tex;

  return () => {
    tex.dispose();
    material.dispose();
  };
}, []);

// ❌ dispose 누락 (메모리 누수)
useEffect(() => {
  const tex = new TextureLoader().load("/texture.png");
  material.map = tex;
  // return cleanup 없음
}, []);
```

### 반복문 규칙 (CLAUDE.md)
```typescript
// ❌ forEach 금지
meshes.forEach((mesh) => scene.add(mesh));

// ✅ for...of 사용
for (const mesh of meshes) {
  scene.add(mesh);
}
```

---

## 관련 문서
- [시스템 전체 아키텍처](../../doc/README.md)
- [shmSimulator 사용법](../shmSimulator/README.md)
- [Vehicle 비즈니스 로직](../common/vehicle/README.md)
- [Store 모드별 구현](../store/vehicle/README.md)

## 외부 라이브러리
- [React Three Fiber](https://docs.pmnd.rs/react-three-fiber)
- [Three.js Docs](https://threejs.org/docs/)
- [Drei (Helpers)](https://github.com/pmndrs/drei)
