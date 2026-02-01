# React UI System - AI Context

## File Map
```yaml
src/components/react/menu/MenuContainer.tsx:112
  purpose: 전체 메뉴 레이아웃 오케스트레이터

  renders:
    - MqttStatusIndicator (top-left)
    - IndividualControlPanel (left, when vehicle selected)
    - MenuLevel1 (bottom)
    - MenuLevel2 (appears when lv1 active)
    - RightPanel (right: 10px 여백, when rightPanelOpen)
    - ConfigDataPanel (when DataPanel menu active)
    - MenuTooltip
    - MapLoader
    - VehicleTest

src/components/react/menu/MenuLevel1.tsx
  purpose: 하단 메인 메뉴 (아이콘 버튼 그룹)

  data source: MenuLevel1Config.tsx → menuLevel1Groups
  store: useMenuStore.activeMainMenu

src/components/react/menu/MenuLevel2.tsx
  purpose: Lv1 클릭 시 나타나는 서브메뉴

  data source: menuLevel2Config.tsx → menuLevel2Config[activeMainMenu]
  store: useMenuStore.activeSubMenu

src/components/react/menu/RightPanel.tsx:237
  purpose: 오른쪽 상세 패널

  content routing:
    - MapBuilder → 부품 목록 표시
    - devtools-lock → LockInfoPanel
    - search-vehicle → IndividualControlPanel
    - search-edge → EdgeControlPanel
    - 기타 → 샘플 콘텐츠

src/components/react/menu/data/MenuLevel1Config.tsx:148
  exports:
    menuLevel1Groups: MenuLevel1Item[][]

  groups:
    1: MapLoader (Folder icon)
    2: Statistics (ChartPie icon)
    3: Vehicle (Car), Operation (ShipWheel)
    4: MapBuilder (TrainTrack), LayoutBuilder (Building)
    5: DataPanel (Table)
    6: DevTools (Wrench)

src/components/react/menu/data/menuLevel2Config.tsx:428
  exports:
    menuLevel2Config: Record<MainMenuType, MenuLevel2Item[]>

  menus:
    MapLoader: Load CFG, Import, Export
    Statistics: Realtime, Daily, Weekly, Monthly, Performance
    Vehicle: Overall Status, History
    Operation: Routes, Schedule, Monitor, Alerts, Logs
    MapBuilder: Straight, 90° Curve, 180° Curve, S Curve, H/R Shape, Junction, Bridge, Custom
    LayoutBuilder: Bay Builder, Station Builder, Equipment Builder
    Search: Vehicle Search, Edge Search, Node Search, Station Search
    DevTools: Lock

src/components/test/VehicleTest/VehicleTest.tsx
  purpose: 상단 테스트 세팅 영역 (차량 테스트 제어)

  state:
    selectedSettingId → 선택된 테스트 설정 ID
    customNumVehicles → 차량 수
    fabCountX/Y → 멀티 fab 그리드 크기
    isTestCreated → 테스트 생성 여부
    activeLogDropdown → 'logs' | 'devlogs' | null (드롭다운 중복 열림 방지)

  data source:
    testSettingConfig.ts → getTestSettings()
    fabConfigStore → fab별 설정 오버라이드

  key actions:
    loadTestSetting(settingId) → 맵 로드 + 차량 생성
    handlePlay/Pause → vehicleTestStore.setPaused()

  log components:
    LogFileManager → OPFS 로그 파일 관리 (props: isOpen, onToggle)
    DevLogFileManager → 개발용 로그 파일 관리 (props: isOpen, onToggle)

src/components/test/VehicleTest/SimulationParamsModal.tsx
  purpose: Fab별 시뮬레이션 파라미터 설정 모달

  data source:
    fabConfigStore.baseConfig → 기본값
    fabConfigStore.fabOverrides → fab별 오버라이드

  sections:
    - Lock Parameters (거리, 전략)
    - Movement Parameters (속도, 가속도)
    - Sensor Presets (각 zone별 각도/길이/감속값)

src/components/react/menu/panels/LockInfoPanel.tsx
  purpose: Lock 정보 실시간 표시

  data source:
    shmSimulatorStore → requestLockTable()
    arrayMode: getLockMgr()

src/components/react/menu/panels/IndividualControlPanel.tsx
  purpose: 개별 차량 제어 패널 (Ctrl+Click 시)

  data source:
    vehicleControlStore.selectedVehicleId

src/components/react/menu/panels/EdgeControlPanel.tsx
  purpose: Edge 검색 및 카메라 이동 패널

  features:
    - Fab 선택 드롭다운 (multi-fab일 때만 표시)
    - Edge 드롭다운 (그룹별 정렬, BAY 또는 접두사 기준)
    - 검색 (이름/인덱스, Enter로 실행)
    - 카메라 자동 이동 (선택/검색 시 해당 Edge로 이동)
    - Edge 선택 시 3D 뷰에서 하이라이트 (빨간색, config에서 설정)
    - Multi-fab에서 선택한 fab에서만 하이라이트

  state:
    selectedFabIndex: number        # 선택된 Fab (local)
    foundEdgeIndex: number | null   # 찾은 Edge 인덱스
    isEdgeDropdownOpen: boolean     # 드롭다운 열림 상태

  dependencies:
    useFabStore:
      - fabs: FabInfo[]             # Fab 목록
      - isMultiFab()                # 멀티팹 여부
    useEdgeStore:
      - edges: Edge[]               # Edge 목록
      - edgeNameToIndex: Map        # 이름→인덱스 조회
    useEdgeControlStore:
      - selectedEdgeIndex           # 선택된 Edge (store)
      - selectedFabIndex            # 선택된 Fab (store)
      - selectEdge(index, fabIndex) # Edge+Fab 선택 → EdgeRenderer로 전달
    useNodeStore:
      - getNodeByName()             # Edge 좌표 계산용
    useCameraStore:
      - setCameraView()             # 카메라 이동

  camera navigation:
    - Edge의 from_node, to_node 중간점 계산
    - Multi-fab일 경우 fab offset 적용
    - cameraHeight: 15, cameraOffset: 8

  highlight flow:
    handleEdgeSelect/handleSearch → selectEdge(index, fabIndex)
    → EdgeRenderer가 store 구독 (selectedEdgeIndex, selectedFabIndex)
    → Multi-fab: slotIndex === selectedFabIndex일 때만 하이라이트
    → 해당 Edge의 InstancedMesh 색상 변경 (GPU only)
```

## Store Map
```yaml
src/store/ui/menuStore.ts:177
  state:
    activeMainMenu: MainMenuType | null   # 현재 Lv1 메뉴
    activeSubMenu: string | null          # 현재 Lv2 메뉴
    activeThirdMenu: string | null        # Lv3 메뉴 (if any)
    rightPanelOpen: boolean               # 오른쪽 패널 열림 여부
    lastSubMenuByMainMenu: Record<...>    # Lv1별 마지막 Lv2 기억
    hoveredMenuId, tooltipMessage, ...    # 툴팁 상태

  actions:
    setActiveMainMenu(menu) → Lv1 변경, Lv2/3 리셋
    setActiveSubMenu(menu) → Lv2 변경, Lv3 리셋
    switchToMainMenuWithMemory(menu) → Shift+키로 전환 시 마지막 Lv2 복원
    showTooltip/hideTooltip

src/store/ui/vehicleControlStore.ts:20
  state:
    selectedVehicleId: number | null
    isPanelOpen: boolean

  actions:
    selectVehicle(id) → 차량 선택 + 패널 열기
    closePanel() → 패널 닫기

src/store/vehicle/vehicleTestStore.ts:63
  state:
    isTestActive: boolean
    testMode: VehicleSystemType | null
    numVehicles: number
    isPaused: boolean              # 시뮬레이션 일시정지
    useVehicleConfig: boolean      # vehicles.cfg 사용 여부

  actions:
    startTest(mode, numVehicles, useVehicleConfig)
    stopTest()
    setPaused(paused)

src/store/simulation/fabConfigStore.ts
  state:
    baseConfig: BaseSimulationConfig     # 기본 설정
    fabOverrides: Record<number, FabConfigOverride>  # fab별 오버라이드

  actions:
    setFabOverride(fabIndex, override)
    getFabConfig(fabIndex) → base + override 병합
    getFabSensorPresets(fabIndex) → 센서 프리셋 배열

src/store/ui/cameraStore.ts
  state:
    position, target: [x, y, z]

  actions:
    setCameraView(position, target)

src/store/ui/edgeControlStore.ts
  state:
    selectedEdgeIndex: number | null  # 선택된 Edge 인덱스
    selectedFabIndex: number          # 선택된 Fab 인덱스 (multi-fab용)
    isPanelOpen: boolean

  actions:
    selectEdge(index, fabIndex)       # Edge+Fab 선택, 패널 열기
    openPanel()
    closePanel()                      # 패널 닫기, selectedEdgeIndex 리셋
    togglePanel()
```

## Menu Hierarchy Flow
```
MenuLevel1 (하단)
├── MapLoader → Load CFG, Import, Export
├── Statistics → Realtime, Daily, Weekly, Monthly, Performance
├── Vehicle → Overall Status, History
├── Operation → Routes, Schedule, Monitor, Alerts, Logs
├── MapBuilder → Straight, Curves, Junction, etc. → RightPanel (부품 목록)
├── LayoutBuilder → Bay, Station, Equipment
├── DataPanel → ConfigDataPanel 표시
├── Search → Vehicle, Edge, Node, Station → RightPanel (각 패널)
└── DevTools → Lock → RightPanel (LockInfoPanel)

클릭 흐름:
1. MenuLevel1 버튼 클릭 → setActiveMainMenu(id)
2. MenuLevel2 나타남 (if activeMainMenu)
3. MenuLevel2 버튼 클릭 → setActiveSubMenu(id)
4. RightPanel 또는 특정 기능 활성화
```

## VehicleTest Flow
```
VehicleTest.tsx 렌더링 위치: MenuContainer 내부

UI 구성:
┌──────────────────────────────────────────────────────────────────────┐
│ [Setting▼] [Mode▼] VEHICLES:[___]/max [Create][Delete] │ FAB:[X]×[Y] │
│ [▶Play][⏸Pause] │ [📋Logs][📝DevLogs]                                │
└──────────────────────────────────────────────────────────────────────┘

로그 드롭다운 상태:
- activeLogDropdown으로 통합 관리
- Logs 열면 DevLogs 닫힘, 반대도 동일

데이터 흐름:
1. Test Setting 선택 → loadTestSetting(settingId)
   → loadCFGFiles(mapName) → edgeStore, nodeStore 업데이트
   → createFabGrid if multi-fab
   → vehicleTestStore.startTest()

2. Play 버튼 → setPaused(false)
   → shmSimulatorStore.resumeSimulator()

3. Settings 버튼 → SimulationParamsModal 열기
   → fabConfigStore.setFabOverride()

4. Logs/DevLogs 버튼 → 드롭다운으로 OPFS 파일 목록 관리
```

## Config Files
```yaml
src/config/testSettingConfig.ts
  exports:
    getTestSettings(): TestSetting[]
    getDefaultSetting(): string

  TestSetting:
    id, name, description: string
    mapName: string              # CFG 파일명
    numVehicles: number
    transferMode?: TransferMode
    camera?: { position, target }
    fabSensorOverrides?: Record<number, SensorConfigOverride>

  renderConfig:
    maxVisibleFabs: 9

/public/config/testSettingConfig.json
  - 런타임에 fetch로 로드
  - TEST_SETTINGS 배열, DEFAULT_SETTING
```

## Critical Rules

**메뉴 상태 관리:**
- `activeMainMenu` 변경 시 `activeSubMenu`, `activeThirdMenu` 자동 리셋
- `lastSubMenuByMainMenu`로 Lv1별 마지막 Lv2 선택 기억
- Shift+키 단축키는 `switchToMainMenuWithMemory` 사용

**테스트 생성 순서:**
1. 기존 시뮬레이터 정리 (`disposeShmSimulator`, `resetLockMgr`)
2. 맵 로드 (`loadCFGFiles`)
3. 800ms 대기 (renderingPoints 계산 시간)
4. 차량 생성 (`setIsTestCreated(true)`, `setTestKey`)

**Fab 설정 오버라이드:**
- `SimulationParamsModal`에서 fab별 설정 변경
- `fabConfigStore.setFabOverride` 호출
- 시뮬레이터 재시작 시 `VehicleSharedMemoryMode`에서 configOverride로 반영

**개별 차량 선택:**
- Ctrl+Click → `vehicleControlStore.selectVehicle(id)`
- `IndividualControlPanel` 표시
- 패널 닫기 → `closePanel()`

## Impact Map

| 수정 | 확인 필요 |
|------|-----------|
| MenuLevel1Config 변경 | MenuLevel1, menuLevel2Config 매핑 |
| menuLevel2Config 변경 | MenuLevel2, RightPanel 라우팅 |
| menuStore 상태 변경 | MenuContainer, 모든 메뉴 컴포넌트 |
| vehicleTestStore 변경 | VehicleTest, VehicleTestRunner |
| fabConfigStore 변경 | SimulationParamsModal, VehicleSharedMemoryMode |
| testSettingConfig 변경 | VehicleTest dropdown |
| EdgeControlPanel 변경 | RightPanel, useFabStore, useCameraStore |
| cameraStore 변경 | EdgeControlPanel, IndividualControlPanel |

## Styling System

### CVA (Class Variance Authority) 기반 스타일
```yaml
src/components/react/menu/shared/menuStyles.ts
  exports:
    menuButtonVariants:
      - active: true/false (버튼 활성화 상태)
      - size: small/large (Level 1/2 크기)

    menuContainerVariants:
      - level: 1/2 (메뉴 레벨)
      - 자동 glow 효과 (shadow-menu-container-glow)

    menuDividerClass: 메뉴 구분선
    bottomLabelVariants: 버튼 라벨 텍스트

src/components/react/menu/shared/panelStyles.ts
  exports:
    panelContainerVariants:
      - position: right/top/floating
      - padding: none/sm/md/lg

    panelHeaderVariants, panelTitleVariants:
      - size: sm/md/lg
      - color: white/orange/muted/cyan

    panelInputVariants:
      - size: sm/md/lg
      - width: auto/full/fixed

    panelSelectVariants:
      - accent: cyan/orange/purple/default
      - size: sm/md

    panelButtonVariants:
      - variant: primary/success/danger/warning/purple/ghost/glow-*
      - size: sm/md/lg

    panelCardVariants:
      - variant: default/interactive/highlight/glow-*
      - padding: sm/md/lg

    panelTextVariants, panelLabelVariants, panelBadgeVariants
```

### Tailwind 커스텀 설정 (tailwind.config.js)
```yaml
colors:
  menu:
    active-bg: rgba(94, 197, 255, 0.85)
    inactive-bg: #262C3F
    container-bg: #353948
    container-bg-lv2: #464959
    border-*: 메뉴 테두리 색상들

  panel:
    bg: rgba(30, 40, 60, 0.95)
    bg-solid: #1e283c
    bg-light: rgba(40, 50, 70, 0.9)
    border: rgba(100, 130, 160, 0.5)

  accent-*: orange/cyan/green/red/purple/yellow

boxShadow:
  menu-glow: 활성 버튼 glow
  menu-hover: 호버 시 glow
  menu-container-glow: 메뉴 컨테이너 glow
  glow-*: 패널 카드용 (orange/cyan/blue/green/purple/red)
  glow-*-strong: 강조 상태용
```

### 사용 예시
```tsx
// 메뉴 버튼
<button className={menuButtonVariants({ active: isActive, size: "large" })}>

// 메뉴 컨테이너
<div className={menuContainerVariants({ level: 1 })}>

// 패널 카드 (glow 효과)
<div className={panelCardVariants({ variant: "glow-cyan", padding: "md" })}>

// 패널 버튼
<button className={panelButtonVariants({ variant: "primary", size: "sm" })}>

// 클래스 병합 (twMerge 사용)
<input className={twMerge(panelInputVariants({ size: "md" }), "w-full")} />
```

## Debugging

### 메뉴 상태 확인
```typescript
// 개발자 콘솔에서
const menuState = useMenuStore.getState();
console.log('[Menu]', {
  main: menuState.activeMainMenu,
  sub: menuState.activeSubMenu,
  rightPanel: menuState.rightPanelOpen
});
```

### 테스트 상태 확인
```typescript
const testState = useVehicleTestStore.getState();
console.log('[Test]', {
  active: testState.isTestActive,
  mode: testState.testMode,
  paused: testState.isPaused
});
```

### Fab 설정 확인
```typescript
const fabConfig = useFabConfigStore.getState();
console.log('[FabConfig]', {
  base: fabConfig.baseConfig,
  overrides: fabConfig.fabOverrides
});
```
