# VPS UI Micro-Patch 작업지시서

목표: 1일컷. UI 전면 개편 아님. 기존 메뉴 구조 100% 보존하면서 우상단/좌상단에 빠른 접근 영역 추가.

## 0. 컨텍스트 (꼭 읽고 시작)

- 기존 LV1/LV2/LV3 하단 메뉴는 **그대로 둔다**. 절대 삭제하거나 갈아엎지 않음.
- 새 컴포넌트는 기존 zustand store를 공유한다 — 새 state 만들지 말 것.
- 디자인 토큰은 `src/components/react/menu/shared/menuStyles.ts`의 `menuButtonVariants`, `menuContainerVariants` 그대로 사용. 새 스타일 만들지 않는다.
- 모든 새 컴포넌트는 `position: fixed` 기반으로 3D 뷰포트 위에 떠 있음.

## Phase 1: QuickViewToolbar (우상단 세로 토글)

### 위치
- `LogIndicator` 바로 아래 (LogIndicator는 `fixed top-4 right-4 z-50`에 있음)
- 새 컴포넌트는 `fixed top-16 right-4 z-50` 정도로 (LogIndicator 높이 + gap)

### 포함할 토글 (3개로 시작)
현재 `visualizationStore`에 실제로 wire 된 것만 노출. 미구현 항목은 메뉴에만 두고 quick toggle에 넣지 않음.

| 아이콘 | 라벨 (tooltip) | store action | store boolean |
|---|---|---|---|
| Activity (lucide) | Performance | `togglePerfLeft` + `togglePerfRight` | `showPerfLeft` |
| Radar (lucide) | Sensor Box | `toggleSensorBox` | `showSensorBox` |
| Tag (lucide) | Fab Labels | `toggleFabLabels` | `showFabLabels` |

> 주의: `MenuLevel2.tsx`의 `vis-performance` 핸들러는 `togglePerfLeft()`와 `togglePerfRight()`를 **둘 다** 호출함. 이 동작 그대로 복제할 것.

### 컴포넌트 스펙
- 파일: `src/components/react/menu/QuickViewToolbar.tsx`
- 구조: vertical flex container, 버튼 3개 세로 배치
- 각 버튼:
  - 정사각형 (~36x36px)
  - 아이콘만 (라벨 없음)
  - hover 시 tooltip 표시 (`useMenuStore`의 `showTooltip`/`hideTooltip` 활용 — `TopControlBar.tsx` 패턴 참고)
  - active 상태 (store boolean이 true) 일 때 배경/색 변경 — `menuButtonVariants({ active: isActive })` 사용
  - onClick → 해당 store action 호출

### 마운트
- `src/components/react/menu/MenuContainer.tsx`에 `<QuickViewToolbar />`를 `<LogIndicator />` 아래 import & 마운트

### 검증
- [ ] 우상단에 세로 3개 버튼이 LogIndicator 아래에 보인다
- [ ] 버튼 클릭 시 해당 시각화가 토글된다
- [ ] 하단 메뉴(Visualization → Performance/Sensor Box/Fab Labels)에서 토글 시 우상단 아이콘 색상이 동기화된다 (같은 store 보므로 자동)
- [ ] hover 시 tooltip 정상 표시

### TODO 코멘트로 남길 것
```tsx
// TODO: vis-heatmap, vis-traffic-flow, vis-deadlock-zone are not yet wired in
// visualizationStore. When implemented, add corresponding toggle buttons here.
```

---

## Phase 2: KPI HUD (좌상단 active fab 기반)

### 위치
- `MqttStatusIndicator`는 좌상단에 이미 있음 (위치 확인 후 충돌 안 나게 배치)
- KPI HUD는 그 아래 또는 옆: `fixed top-4 left-16 z-50` 정도부터 시작 (실제 위치는 `MqttStatusIndicator` 크기에 맞춰 조정)

### 표시 데이터 (active fab 1개에 대해서만)
- Fab 이름 / 인덱스 (dropdown으로 전환 가능)
- Vehicle count (현재 / 최대)
- Throughput (반송/시간) — 시간당 carries
- Avg speed (m/s)
- (선택) Lock contention rate %

### Active fab source
- **`fabStore.activeFabIndex`를 그대로 사용**. 이미 있음. 새 state 만들지 않는다.
- `fabStore`의 `setActiveFabIndex(index)` setter도 이미 있음. dropdown 변경 시 호출.

### KPI 데이터 source
- 기존 `FabStatsPanel`이 이미 fab별 stats를 보여주고 있음 → 같은 데이터 source를 추적해서 그대로 사용
- 코드 베이스에서 fab별 vehicle count / avg speed 등을 어디서 가져오는지 먼저 확인 (`FabStatsPanel` 구현 파일을 추적)
- 같은 selector/hook을 HUD에서 호출

### 컴포넌트 스펙
- 파일: `src/components/react/menu/KpiHud.tsx`
- 상단 라인: `[Fab: 01 ▼]` dropdown — 클릭 시 fab list 펼침, 선택 시 `setActiveFabIndex` 호출
- 본문: KPI 칩 4~5개 (각 칩은 라벨 + 값)
- 디자인: `menuContainerVariants` 적용, 반투명 배경, 작은 padding
- 폰트: 모노스페이스 (숫자 정렬)

### 업데이트 주기
- 기존 FabStatsPanel과 동일한 메커니즘 (zustand subscription 또는 `useFrame` 등)
- 절대 별도 polling 만들지 말 것 — 이미 있는 데이터 흐름에 hook만 걸기

### 마운트
- `MenuContainer.tsx`에 `<KpiHud />` 추가

### 검증
- [ ] 좌상단 MqttStatusIndicator 아래에 HUD 보인다
- [ ] Dropdown으로 fab 전환 시 숫자 즉시 갱신
- [ ] 3D 뷰포트에서 fab 라벨 LOD와 무관하게 HUD active fab은 dropdown 기준
- [ ] 시뮬 일시정지 시 마지막 값 유지, 재개 시 갱신

### 작업 시 주의
- FabStatsPanel 코드를 먼저 읽고 데이터 source 파악 → 그 후 KPI HUD 구현
- 만약 fab별 throughput 계산이 FabStatsPanel 내부에서만 이뤄지고 있다면, 계산 로직을 selector 또는 util 함수로 추출해서 양쪽에서 공유

---

## Phase 3 (시간 남으면): Cmd+K Command Palette

1일 안에 못 들어가면 **Phase 1, 2 끝내고 Phase 3는 다음 작업으로 넘김**. 무리하지 말 것.

### 라이브러리
- `cmdk` (npm install cmdk)

### 기능
- Cmd+K (Mac) / Ctrl+K (Windows) 단축키로 모달 오픈
- 검색 가능한 명령 리스트:
  - 모든 LV1/LV2/LV3 menu 항목 (flat list로 펼침) — `menuLevel2Config`, `menuLevel3Config`에서 추출
  - Fab switcher: "Switch to Fab 01", "Switch to Fab 02" ...
  - Visualization toggles: "Toggle Performance", "Toggle Sensor Box", ...
- Enter로 실행, Esc로 닫기

### 컴포넌트 스펙
- 파일: `src/components/react/menu/CommandPalette.tsx`
- 전역 키 리스너로 열고 닫음
- `MenuContainer.tsx`에 마운트

### 명령 등록 방식
- `commands.ts` 파일에 명령 배열 정의:
  ```ts
  export interface Command {
    id: string;
    label: string;
    keywords?: string[];
    section: 'navigation' | 'visualization' | 'fab' | 'simulation';
    run: () => void;
  }
  ```
- 메뉴 config에서 자동 생성 + 수동 추가 (fab switcher 등)

### 검증
- [ ] Cmd+K로 모달 열림
- [ ] 검색 시 fuzzy match 동작
- [ ] 명령 선택 시 실제 동작 실행
- [ ] Esc로 닫힘
- [ ] 하단 메뉴와 충돌 없음

---

## Phase 3 (시간 남으면): Cmd+K Command Palette

1일 안에 못 들어가면 **Phase 1, 2 끝내고 Phase 3는 다음 작업으로 넘김**. 무리하지 말 것.

---

## 절대 하지 말 것 (Out of scope)

- 하단 LV1/LV2/LV3 메뉴 구조 변경/삭제
- 색상 팔레트 변경 (CSS variable 그대로)
- visualizationStore 새 boolean 추가
- 새 zustand store 생성
- 모드 분리 (sim/build mode toggle 등)
- 사이드바 형태 전환

## 변경하는 파일 요약

신규:
- `src/components/react/menu/QuickViewToolbar.tsx`
- `src/components/react/menu/KpiHud.tsx`
- (Phase 3) `src/components/react/menu/CommandPalette.tsx`
- (Phase 3) `src/components/react/menu/data/commands.ts`

수정:
- `src/components/react/menu/MenuContainer.tsx` — import & 마운트만 추가

기존 store/컴포넌트는 **수정하지 않는다** (FabStatsPanel에서 selector 추출이 필요한 경우만 예외).

## 완료 기준

1. UI 데모 시 다음이 가능:
   - 좌상단 HUD에서 fab 전환하며 실시간 KPI 확인
   - 우상단 quick toggle로 시각화 즉시 ON/OFF
   - (Phase 3 들어가면) Cmd+K로 모든 명령 키보드 검색
2. 기존 하단 메뉴 동작 100% 보존
3. 코드 변경량 최소화 — 기존 store/패턴 재사용
