# Three.js Rendering System - AI Context

## 역할
Three.js 씬 구성, Node/Edge/Station/Text 렌더러, useFrame 패턴, 셰이더, 카메라 제어, 차량 선택 등 Main Thread 렌더링 전반을 담당한다.
(차량 렌더 버퍼/센서 버퍼 메모리 레이아웃은 `/visualization` 에이전트 관할)

## File Map

### 씬 구성
```yaml
src/components/three/ThreeMain.tsx
  purpose: Three.js Canvas 진입점
  renders:
    - Canvas (background: #1a1a1a, camera: Z-up)
    - OrbitControls (makeDefault, zoomSpeed:3, maxDistance:2000)
    - CameraController
    - ambientLight + directionalLight (castShadow)
    - Floor, AxisHelper
    - MapRenderer (edges, nodes, stations)
    - TextRenderer (node/edge/station/vehicle labels)
    - VehicleSystemRenderer (조건부: isTestActive && testMode)
    - Perf (r3f-perf, bottom-right)
    - PerformanceMonitorUI (5초 평균 CPU)
```

### 카메라
```yaml
src/components/three/scene/Camera/cameraController.tsx
  purpose: 카메라 위치/회전/팔로잉 관리

  stores:
    useCameraStore: position, target, shouldUpdateCamera, rotateZDeg, followingVehicleId, followOffset
    useMenuStore: activeMainMenu, activeSubMenu (Bay Builder 감지용)

  기능:
    1. 초기화: store에서 position/target 읽어 OrbitControls 설정
    2. Bay Builder 모드: Top View 전환, Y-up, rotate 비활성, WSAD 이동
    3. store 업데이트: shouldUpdateCamera 시 camera.position/target 변경
    4. Z축 회전: rotateZDeg → applyAxisAngle 공전
    5. Vehicle Following: useFrame에서 lerp(CAMERA_LERP_FACTOR=0.08) 보간
    6. Fine Zoom: +/- 키 5% 조절
    7. 유저 조작 감지: OrbitControls 'start' 이벤트 → stopFollowingVehicle

  Zero-GC:
    모듈 레벨 scratch: _scratchZAxis, _scratchOffset, _scratchTargetPos, _scratchTargetTarget
```

### Map 오케스트레이터
```yaml
src/components/three/entities/renderers/MapRenderer.tsx
  purpose: Edge/Node/Station 렌더링 오케스트레이터

  data routing:
    single-fab: storeEdges, storeNodes, storeStations (store 직접 사용)
    multi-fab: originalMapData (fabStore에서 원본 데이터)

  useFrame:
    - multi-fab일 때 카메라 이동 감지 (CAMERA_MOVE_THRESHOLD=100)
    - 임계값 초과 시 updateSlots(cx, cy) 호출

  renders:
    - NodesRenderer (nodeIds 전달)
    - EdgeRenderer (edges 전달)
    - StationRenderer (stations 전달)
    - ambientLight + directionalLight
```

### Node 렌더러
```yaml
src/components/three/entities/renderers/NodesRenderer.tsx
  purpose: InstancedMesh 기반 노드 렌더링

  구조:
    NodesRenderer: slot 분기 (단일 fab → NodesCore, 멀티 fab → slot별 offset group)
    NodesCore: 실제 렌더링

  InstancedMesh 3개:
    1. 메인 노드: SphereGeometry(0.2, 16, 16), ShaderMaterial (pulse 효과)
    2. 일반 마커: SphereGeometry(NORMAL.RADIUS), MeshBasicMaterial(NORMAL.COLOR)
    3. TMP_ 마커: SphereGeometry(TMP.RADIUS), MeshBasicMaterial(TMP.COLOR)

  node 분류:
    TMP_ 접두사 → tmpNodeIds (회색, 작은 마커)
    나머지 → normalNodeIds (분홍, 큰 마커)

  초기화:
    initInstancedMesh() → Matrix4.compose(position, quaternion, scale) → setMatrixAt()
    메인: useNodeZ=true, useDynamicScale=true (node.size)
    마커: MARKER_Z 고정, scale 1 고정

  실시간 업데이트:
    useNodeStore.subscribe → node 변경 시 matrix 재계산 → needsUpdate

  useFrame:
    uTime uniform만 업데이트 (pulse 애니메이션)

  config:
    getNodeConfig() → selectedColor, selectedSize
    getMarkerConfig() → Z, SEGMENTS, NORMAL/TMP radius/color
```

### Edge 렌더러
```yaml
src/components/three/entities/renderers/EdgeRenderer.tsx
  purpose: InstancedMesh 기반 Edge 렌더링 (타입별 그룹화)
  (상세 문서: visualization.md 참조)

  핵심 구조:
    EdgeRenderer → EdgeTypeRenderer (타입별 InstancedMesh)
    edgeToInstanceMap: Map<originalIndex, { start, count }>
    LINEAR: 1 edge = 1 instance
    CURVE: 1 edge = N segments

  selection:
    aSelected attribute (0.0/1.0) → GPU-only 하이라이트

src/components/three/entities/edge/points_calculator/EdgePointsCalculator.ts
  purpose: vos_rail_type별 3D 렌더링 포인트 계산 라우터

  분기:
    CURVE_90 / CURVE_180 / CURVE_CSC → SimpleCurveEdgePointsCalculator
    S_CURVE → SCurvePointsCalculator
    LINEAR / default → StraightPointsCalculator

  의존: useNodeStore.getState().nodes (node 좌표 참조)
```

### Station 렌더러
```yaml
src/components/three/entities/renderers/StationRenderer.tsx
  purpose: InstancedMesh 기반 Station 렌더링

  구조:
    StationRenderer: slot 분기 + 타입별 그룹화
    StationTypeRenderer: 특정 타입의 InstancedMesh 렌더링

  타입별 그룹화:
    OHB, STK, EQ, OTHER → 각각 별도 InstancedMesh (색상 분리)

  geometry: BoxGeometry(WIDTH, DEPTH, 0.1)
  material: MeshStandardMaterial (metalness:0.3, roughness:0.7)

  초기화:
    station.position (x, y, z)
    station.barcode_r → Z축 회전 (degree → radian)
    Matrix4.compose → setMatrixAt

  config:
    getStationTypeConfig(type) → COLOR
    getStationBoxConfig() → WIDTH, DEPTH
```

### Text 렌더러
```yaml
src/components/three/entities/renderers/TextRenderer.tsx
  purpose: Map Text + Vehicle Text 라우터

  renders:
    MapTextRenderer: node/edge/station 라벨
    VehicleTextRenderer: 차량 ID 라벨 (SharedMemory + isTestActive 시만)

  visibility: vehicleConfig.text.visible && shmActualNumVehicles > 0

src/components/three/entities/text/instanced/MapTextRenderer.tsx
  purpose: Node/Edge/Station 텍스트 (InstancedText 기반)

  multi-fab 처리:
    useFrame에서 findNearestFab(camera.x, camera.y)
    fab 전환 시 fabOffsetRef 업데이트 (React re-render 없음)
    InstancedText에 fabOffsetRef 전달 → useFrame에서 offset 적용

  data:
    textStore → nodeTextsArray, edgeTextsArray, stationTextsArray
    textToDigits() → 문자열을 digit 배열로 변환

src/components/three/entities/text/instanced/VehicleTextRenderer.tsx
  purpose: 차량 ID 텍스트 (VEH00001 형식)

  LABEL_LENGTH: 8
  LOD_DIST_SQ: 20² (가까운 차량만 표시)
  CAM_HEIGHT_CUTOFF: 50 (고도 컬링)

  useFrame:
    SharedMemory → shmSimulatorStore.getVehicleData()
    Array → vehicleDataArray.getData()
    applyHighAltitudeCulling → updateVehicleTextTransforms

src/components/three/entities/text/instanced/InstancedText.tsx
  purpose: 범용 InstancedText (Map Text용)

  최적화:
    Spatial Grid: buildSpatialGrid() → LOD 기반 가시 영역 필터링
    고도 컬링: applyHighAltitudeCulling()
    Grid-based LOD: getVisibleGroupsFromGrid() → 근처 셀만 체크

  useFrame:
    fab offset → 카메라 좌표를 fab 0 기준으로 변환
    visibleGroups 계산 → newlyCulled 감지 → hideGroupCharacters
    billboard rotation → renderVisibleGroups → updateInstanceMatrices

  Zero-GC: visibleGroupsRef, prevVisibleSetRef, newlyCulledRef 재사용

src/components/three/entities/text/instanced/BaseInstancedText.tsx
  purpose: InstancedMesh 생성 공통 컴포넌트

src/components/three/entities/text/instanced/useDigitMaterials.ts
  purpose: 문자별 Canvas2D 텍스처 생성, CHAR_COUNT 정의
```

### 차량 선택
```yaml
src/components/three/interaction/VehicleSelector.tsx
  purpose: Ctrl+Click 기반 차량 선택

  원리:
    invisible planeGeometry(10000, 10000) at MARKER_Z
    onClick → Ctrl 체크 → findNearestVehicle(point.x, point.y)

  findNearestVehicle:
    render buffer 순회 (VEHICLE_RENDER_SIZE=4, [x,y,z,rotation])
    거리² < SELECTION_THRESHOLD_SQ (20²=400) → 가장 가까운 차량

  multi-fab index 변환:
    convertRenderToWorkerIndex():
    renderIndex → fabRenderAssignments에서 fab 찾기 → workerLayout에서 workerStartIndex 계산
    render buffer offset (bytes) → index 변환: offset / (RENDER_SIZE * 4)

  store:
    vehicleControlStore.selectVehicle(workerIndex)
```

### 셰이더
```yaml
src/components/three/entities/node/shaders/nodeVertex.glsl
  uniforms: uTime
  효과: pulse = sin(uTime * 2.0) * 0.05 + 1.0 (크기 맥동)
  varyings: vPosition, vNormal, vUv

src/components/three/entities/node/shaders/nodeFragment.glsl
  uniforms: uColor, uOpacity
  출력: vec4(uColor, uOpacity)

src/components/three/entities/edge/shaders/edgeVertex.glsl
  attributes: aSelected (0.0 / 1.0)
  z-fighting fix: instancePosition.z += aSelected * 0.025
  varyings: vSelected

src/components/three/entities/edge/shaders/edgeFragment.glsl
  uniforms: uColor, uSelectedColor, uOpacity
  출력: mix(uColor, uSelectedColor, vSelected)

src/components/three/entities/vehicle/shaders/
  (vehicleVertex.glsl, vehicleFragment.glsl)
  rotateZ(angle) 함수: mat3 Z축 회전
  instanceData attribute: vec4 (x, y, z, rotation_deg)
```

## Config
```yaml
src/config/renderConfig.ts
  RenderConfig 인터페이스:
    nodes: defaultSize, selectedColor, selectedSize, markerColor/Radius, text{visible,color,scale}
    edges: colors{LINEAR,CURVE_90,CURVE_180,CURVE_CSC,S_CURVE,DEFAULT}, lineWidth, selectedColor, text
    vehicles: defaultColor, showSensorEdges, text{visible,zOffset,color,scale}
    stations: types{OHB,STK,EQ...}, text, box{width,depth}
    map: markersZ, scale

  로딩: /public/config/renderConfig.json → async fetch

src/config/stationConfig.ts
  getStationTypeConfig(type) → { COLOR, description }
  getStationBoxConfig() → { WIDTH, DEPTH }
  getStationTextConfig() → { COLOR }

src/config/cameraConfig.ts
  getBayBuilderCameraPosition() → [x, y, z]
  getBayBuilderCameraTarget() → [x, y, z]
```

## Store Map
```yaml
src/store/map/nodeStore.ts
  state: nodes, getNodeByName(name)
  subscribe: node 변경 시 NodesRenderer 업데이트

src/store/map/edgeStore.ts
  state: edges, edgeNameToIndex
  EdgeRenderer가 참조

src/store/map/stationStore.ts
  state: stations
  StationRenderer가 참조

src/store/map/fabStore.ts
  state: fabs, slots, originalMapData
  actions: updateSlots(cx, cy), findNearestFab(x, y)
  multi-fab 렌더링의 핵심

src/store/map/textStore.ts
  state: nodeTexts, edgeTexts, stationTexts (Dict)
         nodeTextsArray, edgeTextsArray, stationTextsArray (Array)
         updateTrigger
  MapTextRenderer가 참조

src/store/ui/cameraStore.ts
  state: position, target, shouldUpdateCamera, rotateZDeg, followingVehicleId, followOffset
  actions: setCameraView, stopFollowingVehicle, _resetCameraUpdate, _resetRotateZ

src/store/ui/vehicleControlStore.ts
  state: selectedVehicleId, isPanelOpen
  actions: selectVehicle(id), closePanel()
```

## Critical Rules

**Multi-Fab 렌더링 패턴:**
- 단일 fab: store 데이터 직접 사용
- 멀티 fab: originalMapData + slot offset (group position)
- 각 렌더러가 동일한 패턴: `if (fabs.length <= 1) → 직접, else → slots.map(slot => <group position={offset}>)`
- 텍스트는 예외: fabOffsetRef로 동적 offset (React re-render 없이)

**InstancedMesh 패턴:**
- geometry/material은 useMemo로 캐싱
- Matrix4.compose(position, quaternion, scale) → setMatrixAt()
- 변경 후 반드시 `instanceMatrix.needsUpdate = true`
- frustumCulled={false} (대규모 맵에서 잘못된 컬링 방지)

**useFrame 규칙:**
- GPU 업데이트는 반드시 useFrame 내부에서
- React re-render 없이 ref 기반으로 업데이트
- Zero-GC: 모듈 레벨 scratch 객체 재사용 (매 프레임 new 금지)

**셰이더 수정 시:**
- vertex에서 varying 선언 → fragment에서 받기
- InstancedBufferAttribute 추가 시 needsUpdate 패턴 확인
- z-fighting: 선택된 요소 Z += 0.025

**카메라:**
- 기본: Z-up (camera.up = 0,0,1)
- Bay Builder: Y-up 전환, rotate 비활성
- lerp factor 0.08 (너무 높으면 끊김, 너무 낮으면 느림)

**차량 선택:**
- Ctrl+Click 필수 (일반 클릭은 무시)
- render index → worker index 변환 필수 (multi-fab)

## Impact Map

| 수정 | 확인 필요 |
|------|-----------|
| ThreeMain.tsx 변경 | Canvas 설정, 전체 씬 구성 |
| CameraController 변경 | cameraStore, Bay Builder 모드, vehicle following |
| MapRenderer 변경 | EdgeRenderer, NodesRenderer, StationRenderer, fabStore |
| NodesRenderer 변경 | nodeStore, nodeShaders, renderConfig (node) |
| EdgeRenderer 변경 | edgeStore, edgeShaders, renderConfig (edge), edgeControlStore |
| StationRenderer 변경 | stationStore, stationConfig |
| TextRenderer 변경 | MapTextRenderer, VehicleTextRenderer |
| InstancedText 변경 | MapTextRenderer, instancedTextUtils, useDigitMaterials |
| VehicleTextRenderer 변경 | shmSimulatorStore, vehicleDataArray, renderConfig (vehicle) |
| VehicleSelector 변경 | vehicleControlStore, shmSimulatorStore, MemoryLayoutManager |
| EdgePointsCalculator 변경 | EdgeRenderer (renderingPoints), nodeStore |
| renderConfig.json 변경 | 모든 렌더러 색상/크기/가시성 |
| fabStore slots 변경 | MapRenderer, 모든 slot 기반 렌더러 |

## Debugging

### 카메라 상태 확인
```typescript
const cam = useCameraStore.getState();
console.log('[Camera]', {
  pos: cam.position,
  target: cam.target,
  following: cam.followingVehicleId,
});
```

### InstancedMesh 확인
```typescript
// NodesRenderer 등에서
const mesh = instancedMeshRef.current;
console.log('[Nodes]', {
  count: mesh?.count,
  visible: mesh?.visible,
  matrixNeedsUpdate: mesh?.instanceMatrix.needsUpdate,
});
```

### Multi-Fab Slot 확인
```typescript
const fabState = useFabStore.getState();
console.log('[Fab]', {
  fabs: fabState.fabs.length,
  slots: fabState.slots.map(s => ({ id: s.slotId, offset: [s.offsetX, s.offsetY] })),
});
```

### 텍스트 LOD 확인
```typescript
// InstancedText useFrame 내
console.log('[Text]', {
  visibleGroups: visibleGroups.length,
  totalGroups: groups.length,
  camHeight: cz,
});
```

### 차량 선택 디버깅
```typescript
// VehicleSelector
console.log('[Select]', {
  renderIndex: nearestRenderIndex,
  workerIndex: convertRenderToWorkerIndex(nearestRenderIndex),
  distSq: minDistSq,
});
```
