# LOOP 모드 (Bay 순환) 구현 컨텍스트

## 상태: 코드 구현 완료, 빌드 에러 없음 (2026-03-08)

---

## 1. 목표

testSetting에서 LOOP 모드 선택 시, 각 차량이 자기 bay의 2개 edge를 Dijkstra 기반으로 왕복 순환하도록 구현.

### 동작 흐름
```
차량 초기 위치 edge → bay_name 확인
  → loops.map에서 해당 bay의 [edge1, edge2] 조회
  → 초기 위치 → edge1 (Dijkstra)
  → edge1.to_node → edge2.from_node (Dijkstra)
  → edge2.to_node → edge1.from_node (Dijkstra)
  → 무한 반복
```

---

## 2. 변경 파일 목록

| # | 파일 | 변경 내용 | 완료 |
|---|------|----------|------|
| 1 | `constants.ts` | SIMPLE_LOOP 추가, 기존 LOOP 유지 | ✅ |
| 2 | `cfgStore.ts` | loops.map 파싱 (parseLoopsMap) + BayLoopEntry 타입 + store 저장 | ✅ |
| 3 | `shmSimulator/types.ts` | FabInitData에 bayLoopEntries 필드 추가 | ✅ |
| 4 | `shmSimulatorStore.ts` | init params에 bayLoopEntries 전달 | ✅ |
| 5 | `MultiWorkerController.ts` | MultiFabInitParams + createFabInitData에 bayLoopEntries 전달 | ✅ |
| 6 | `shmSimulator/index.ts` | FabInitParams + init/addFab에 bayLoopEntries 전달 | ✅ |
| 7 | `SimulationEngine.ts` | FabInitParams 생성 시 bayLoopEntries 전달 (3곳) | ✅ |
| 8 | `FabContext/types.ts` | FabInitParams에 bayLoopEntries 추가 | ✅ |
| 9 | `FabContext/index.ts` | vehicleBayLoopMap 추가 + buildVehicleBayLoopMap 호출 + step에 전달 | ✅ |
| 10 | `FabContext/loop-mode.ts` | buildVehicleBayLoopMap 함수 추가 (bay→edge 매핑) | ✅ |
| 11 | `FabContext/simulation-step.ts` | vehicleBayLoopMap 컨텍스트 추가 + autoMgr.update에 전달 | ✅ |
| 12 | `TransferMgr/types.ts` | VehicleBayLoop 타입 추가 | ✅ |
| 13 | `TransferMgr/index.ts` | LOOP→command 기반, SIMPLE_LOOP→기존 loop 기반 분기 + VehicleBayLoop export | ✅ |
| 14 | `AutoMgr.ts` | LOOP 모드 분기 + checkAndAssignLoopRoute 메서드 추가 | ✅ |
| 15 | `VehicleSharedMemoryMode.tsx` | cfgStore에서 bayLoopEntries 읽어서 init에 전달 | ✅ |
| 16 | `TopControlBar.tsx` | SIMPLE_LOOP 라벨 추가 | ✅ |
| 17 | `EngineStore.ts` | 기본값 SIMPLE_LOOP | ✅ |
| 18 | `vehicleArrayMode/initializeVehicles.ts` | 기본값 SIMPLE_LOOP | ✅ |

---

## 3. 핵심 구조

### TransferMode 변경
```typescript
SIMPLE_LOOP  // 기존: nextEdgeIndices[0] 추적 (checkpoint 미사용)
LOOP         // 신규: bay 순환, Dijkstra 경로, checkpoint 기반 (AUTO_ROUTE와 동일 메커니즘)
```

### 데이터 흐름
```
loops.map (파일)
  → cfgStore.parseLoopsMap() → BayLoopEntry[]
  → VehicleSharedMemoryMode → shmSimulatorStore.init({ bayLoopEntries })
  → MultiWorkerController → FabInitData.bayLoopEntries
  → Worker: SimulationEngine → FabContext({ bayLoopEntries })
  → buildVehicleBayLoopMap() → vehicleBayLoopMap: Map<vehId, VehicleBayLoop>
  → simulation-step → autoMgr.update(vehicleBayLoopMap)
  → AutoMgr.checkAndAssignLoopRoute() → Dijkstra → applyPathToVehicle()
```

### VehicleBayLoop 구조
```typescript
{
  bayName: string;       // "BAY01"
  edge1Idx: number;      // 1-based
  edge2Idx: number;      // 1-based
  phase: 'INIT' | 'TO_E1' | 'TO_E2';  // 현재 목적지 상태
}
```

### Phase 전환 로직 (AutoMgr.checkAndAssignLoopRoute)
```
INIT → edge1으로 경로 할당 → phase = TO_E2
TO_E2 → edge2로 경로 할당 → phase = TO_E1
TO_E1 → edge1으로 경로 할당 → phase = TO_E2
(반복)
```

---

## 4. 미완료 / 확인 필요

- [ ] **실제 동작 테스트** - LOOP 모드로 시뮬레이션 돌려보기
- [ ] edge.bay_name 필드가 실제 edges.cfg에 제대로 들어있는지 확인
- [ ] bay에 소속 안 된 차량 처리 (현재: loopInfo 없으면 skip → 제자리)
- [ ] 기존 LOOP 모드 사용처가 SIMPLE_LOOP으로 올바르게 전환됐는지 UI 확인
- [ ] testSettingConfig.json에서 transferMode가 "LOOP"인 항목 동작 확인

---

## 5. 관련 파일 경로

| 분류 | 파일 |
|------|------|
| loops.map | `public/railConfig/y_short/loops.map` |
| 파싱 | `src/store/system/cfgStore.ts` |
| 타입 | `src/shmSimulator/types.ts`, `src/common/vehicle/logic/TransferMgr/types.ts` |
| Worker 전달 | `src/shmSimulator/MultiWorkerController.ts`, `src/shmSimulator/index.ts` |
| Worker 초기화 | `src/shmSimulator/core/SimulationEngine.ts`, `src/shmSimulator/core/FabContext/` |
| Bay 매핑 | `src/shmSimulator/core/FabContext/loop-mode.ts` |
| 경로 할당 | `src/common/vehicle/logic/AutoMgr.ts` |
| UI | `src/components/test/VehicleTest/TopControlBar.tsx` |
