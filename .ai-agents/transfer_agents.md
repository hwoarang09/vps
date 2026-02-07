# Transfer System - AI Context

## 상태: Checkpoint 기반 NEXT_EDGE 관리 (2026-02-08)

---

## 1. 역할

TransferMgr는 차량의 **경로(pathBuffer) 관리**, **NEXT_EDGE 초기화/shift**, **Checkpoint 생성/저장**을 담당합니다.

### 핵심 원칙
- **NEXT_EDGE를 수정하는 놈은 LockMgr 한 놈만!** (handleMovePrepare)
- TransferMgr는 **경로 시작 시 초기 NEXT_EDGE만** 설정 (initNextEdgesForStart)
- Edge 전환 시 **shift만** 수행 (refill은 하지 않음)

### 역할 분리
| 컴포넌트 | 역할 |
|----------|------|
| **AutoMgr** | Dijkstra 경로 계산 → pathBuffer 설정 → TransferMgr.assignCommand() 호출 |
| **TransferMgr** | pathBuffer 관리, Checkpoint 생성/저장, 초기 NEXT_EDGE 설정 |
| **LockMgr** | Checkpoint 기반으로 NEXT_EDGE 채우기 (handleMovePrepare) |
| **edgeTransition** | Edge 전환 시 NEXT_EDGE shift + pathBuffer shift |

---

## 2. 파일 위치

| 파일 | 역할 |
|------|------|
| `src/common/vehicle/logic/TransferMgr.ts` | Transfer 시스템 메인 |
| `src/common/vehicle/logic/AutoMgr.ts` | 자동 경로 설정 (Dijkstra) |
| `src/common/vehicle/logic/LockMgr.ts` | Checkpoint 기반 Lock 처리 |
| `src/common/vehicle/logic/checkpoint/builder.ts` | Checkpoint 생성 로직 |
| `src/common/vehicle/logic/checkpoint/types.ts` | Checkpoint 타입 정의 |
| `src/common/vehicle/logic/checkpoint/utils.ts` | Checkpoint 유틸리티 |
| `src/common/vehicle/logic/checkpoint/index.ts` | Checkpoint 모듈 export |
| `src/common/vehicle/movement/edgeTransition.ts` | Edge 전환 + NEXT_EDGE shift |
| `src/common/vehicle/initialize/constants.ts` | 상수, 메모리 레이아웃 정의 |
| `src/shmSimulator/core/FabContext.ts` | step() 메인 루프 |
| `.ai-agents/transfer_agents.md` | 이 문서 |

---

## 3. 데이터 구조

### 3.1 PathBuffer (Int32Array)

차량별 경로 저장. `AutoMgr.assignCommand()` → `TransferMgr.processPathCommand()`에서 기록.

```typescript
MAX_PATH_LENGTH = 100;  // vehicle당 할당 크기
PATH_LEN = 0;           // index 0 = 남은 경로 길이
PATH_EDGES_START = 1;   // index 1~ = edge indices (1-based)

// 접근
const pathPtr = vehId * MAX_PATH_LENGTH;
const len = pathBuffer[pathPtr + PATH_LEN];
const firstEdge = pathBuffer[pathPtr + PATH_EDGES_START];  // 1-based edge ID
```

**특성:**
- Edge 전환 성공 시 실제로 shift (맨 앞 제거)
- shift는 `edgeTransition.ts:shiftPathBuffer()`에서 수행

### 3.2 Checkpoint Buffer (Float32Array)

차량별 checkpoint 리스트 저장. 경로 설정 시 한 번 생성.

```typescript
MAX_CHECKPOINTS_PER_VEHICLE = 100;
CHECKPOINT_FIELDS = 3;  // edge, ratio, flags
CHECKPOINT_SECTION_SIZE = 1 + 100 * 3;  // = 301

// 접근
const vehicleOffset = 1 + vehicleId * CHECKPOINT_SECTION_SIZE;
const count = checkpointBuffer[vehicleOffset];  // checkpoint 개수
const cpOffset = vehicleOffset + 1 + cpIdx * CHECKPOINT_FIELDS;
const edge  = checkpointBuffer[cpOffset + 0];   // 1-based edge ID
const ratio = checkpointBuffer[cpOffset + 1];   // 0.0 ~ 1.0
const flags = checkpointBuffer[cpOffset + 2];   // CheckpointFlags bitmask
```

### 3.3 VehicleDataArray 관련 필드

| 필드 | 오프셋 | 용도 | 누가 씀 |
|------|--------|------|---------|
| `CURRENT_EDGE` | 9 | 현재 edge (1-based) | Movement |
| `NEXT_EDGE_0~4` | 10~14 | 다음 edge들 | TransferMgr(초기), LockMgr(refill) |
| `NEXT_EDGE_STATE` | 15 | EMPTY/PENDING/READY | TransferMgr, LockMgr |
| `TARGET_RATIO` | 16 | 목표 진행률 | TransferMgr, LockMgr |
| `EDGE_RATIO` | 7 | 현재 진행률 | Movement |
| `CHECKPOINT_HEAD` | 26 | 다음 로드할 checkpoint 인덱스 | LockMgr |
| `CURRENT_CP_EDGE` | 27 | 현재 checkpoint edge | LockMgr |
| `CURRENT_CP_RATIO` | 28 | 현재 checkpoint ratio | LockMgr |
| `CURRENT_CP_FLAGS` | 29 | 현재 checkpoint flags (mutable) | LockMgr |

### 3.4 NEXT_EDGE 관리 방식

```
NEXT_EDGE가 없으면 → 현재 edge의 TARGET_RATIO까지
NEXT_EDGE가 있으면 → 마지막 edge의 TARGET_RATIO까지 (중간은 1.0)

예시: curEdge + nextN0 + nextN1, TARGET_RATIO=0.7
  → curEdge: 1.0까지 쭉
  → nextN0: 1.0까지 쭉
  → nextN1: 0.7까지
```

---

## 4. 핵심 함수

### 4.1 TransferMgr

| 함수 | 역할 | 호출 시점 |
|------|------|-----------|
| `assignCommand(vehId, command, ...)` | 외부 API. 경로 검증 → pathBuffer 저장 → checkpoint 생성 → 초기 NEXT_EDGE 설정 | AutoMgr에서 호출 |
| `processPathCommand(vehId, path, ...)` | path 연결성 검증 → pathBuffer 기록 → buildCheckpoints → initNextEdgesForStart | assignCommand 내부 |
| `buildCheckpoints(vehId, edgeIndices, ...)` | checkpoint builder 호출 → saveCheckpoints | processPathCommand 내부 |
| `saveCheckpoints(vehId, checkpoints, ...)` | checkpoint 배열에 저장 + 첫 번째 CP를 CURRENT_CP_*에 로드 | buildCheckpoints 내부 |
| `initNextEdgesForStart(data, ptr, vehId)` | 첫 번째 checkpoint edge까지만 NEXT_EDGE 채움 | processPathCommand 내부 |
| `processTransferQueue(...)` | 전환 큐 처리 (LOOP 모드용) | FabContext.step() |
| `fillNextEdgesFromLoopMap(...)` | LOOP 모드에서 loopMap 기반 NEXT_EDGE 채움 | processTransferQueue 내부 |
| `getFullReservedPath(vehId)` | pathBuffer에서 전체 잔여 경로 조회 | 곡선 감속, merge 거리 계산 |
| `findDistanceToNextCurve(...)` | 다음 곡선까지 거리 계산 | 곡선 사전 감속 |
| `findDistanceToNextMerge(...)` | 다음 merge까지 거리 계산 | Lock 시스템 |
| `hasPendingCommands(vehId)` | 경로 또는 예약이 남아있는지 | AutoMgr에서 idle 체크 |
| `onEdgeTransition(vehId, passedEdgeName)` | reservedNextEdges 큐에서 제거 | edge 전환 시 |

### 4.2 edgeTransition.ts

| 함수 | 역할 |
|------|------|
| `handleEdgeTransition(params)` | edge 전환 메인 로직. ratio >= 1이면 다음 edge로 이동 |
| `shiftNextEdges(data, ptr, vehId, pathBuffer)` | NEXT_EDGE 배열 shift (한 칸 앞으로) + pathBuffer shift |
| `shiftPathBuffer(pathBuffer, vehId)` | pathBuffer에서 맨 앞 edge 제거 (실제 shift) |

### 4.3 Checkpoint Builder

| 함수 | 파일 | 역할 |
|------|------|------|
| `buildCheckpoints(ctx, opts)` | `builder.ts` | 전체 경로에 대해 checkpoint 생성 |
| `findRequestPoint(targetIdx, ...)` | `builder.ts` | Request Point 위치 찾기 (역순 탐색) |
| `findWaitPoint(targetIdx, ...)` | `builder.ts` | Wait Point 위치 찾기 (역순 탐색) |
| `buildCheckpointsFromPath(params)` | `index.ts` | TransferMgr용 간소화 wrapper |
| `isCurveEdge(edge)` | `utils.ts` | 곡선 여부 확인 |
| `sortCheckpointsByRatioWithinEdge(cps)` | `utils.ts` | 같은 edge 내 ratio 정렬 |

---

## 5. 경로 설정 흐름 (Auto Route)

```
AutoMgr.update()
  └─ checkAndAssignRoute(vehId)
       └─ assignRandomDestination(vehId, currentEdgeIdx, ...)
            ├─ findShortestPath(from, to)  ← Dijkstra
            └─ applyPathToVehicle(ctx)
                 ├─ cancelObsoleteLocks()     ← 이전 경로 lock 취소
                 ├─ constructPathCommand()    ← pathIndices → {edgeId, targetRatio}[]
                 └─ transferMgr.assignCommand(vehId, command, ...)
                      └─ processPathCommand(vehId, path, ...)
                           ├─ validatePathConnectivity()  ← 연결성 검증
                           ├─ pathBuffer에 edgeIndices 기록
                           ├─ buildCheckpoints()
                           │    ├─ buildCheckpointsFromPath()
                           │    │    └─ builder.buildCheckpoints(ctx, opts)
                           │    │         ├─ findRequestPoint()  → MOVE_PREPARE (+ LOCK_REQUEST)
                           │    │         └─ findWaitPoint()     → LOCK_WAIT
                           │    └─ saveCheckpoints()
                           │         ├─ checkpointBuffer에 저장
                           │         └─ 첫 CP → CURRENT_CP_* 로드
                           └─ initNextEdgesForStart()
                                └─ 첫 checkpoint edge까지만 NEXT_EDGE 채움
```

---

## 6. Edge 전환 흐름

```
Movement (ratio >= 1.0)
  └─ handleEdgeTransition(params)
       ├─ checkCanTransitionToNextEdge()  ← NEXT_EDGE_0, NEXT_EDGE_STATE 체크
       ├─ store.moveVehicleToEdge()       ← 실제 이동
       ├─ shiftNextEdges()
       │    ├─ shiftPathBuffer()          ← pathBuffer 맨 앞 제거
       │    └─ NEXT_EDGE 한 칸 shift      ← [1,2,3,4,0] → [2,3,4,0,0]
       └─ TARGET_RATIO 설정
```

**중요:** shiftNextEdges에서는 **refill 하지 않음**. 빈 슬롯은 LockMgr.handleMovePrepare()에서 checkpoint 도달 시 채움.

---

## 7. Checkpoint 생성 규칙

### 경로의 2번째 edge부터 각 edge에 대해:

**1. Request Point (MOVE_PREPARE + optional LOCK_REQUEST):**
- target edge의 from_node에서 역순으로 거슬러 올라감
- 직선 target: **5.1m 전**에서 요청
- 곡선 target: **1.0m 전**에서 요청
- 역순 탐색 중 곡선 만나면 → ratio 0.5
- path 시작까지 도달 → 첫 edge ratio 0
- fromNode가 merge → LOCK_REQUEST 플래그 추가

**2. Wait Point (LOCK_WAIT) - merge일 때만:**
- merge로 들어가는 edge (incomingEdge)의 `waiting_offset` 사용
- 곡선 합류 → incomingEdge의 ratio 0 (곡선 시작점)
- 직선 합류 → waiting_offset 거리 전
- 같은 edge 내에서 ratio 오름차순 정렬

### CheckpointFlags (Bitmask)

```typescript
NONE: 0
LOCK_REQUEST: 1 << 0   // 0x01 - merge lock 요청
LOCK_WAIT: 1 << 1      // 0x02 - lock grant 대기
LOCK_RELEASE: 1 << 2   // 0x04 - lock 해제 (현재 미사용)
MOVE_PREPARE: 1 << 3   // 0x08 - 다음 edge NEXT_EDGE 채우기
MOVE_SLOW: 1 << 4      // 0x10 - 감속 구간 (현재 미사용)
```

---

## 8. TransferMode별 동작

| 모드 | pathBuffer | Checkpoint | NEXT_EDGE 방식 |
|------|-----------|------------|----------------|
| `AUTO_ROUTE` | O | O | checkpoint 기반 (initNextEdgesForStart + handleMovePrepare) |
| `MQTT_CONTROL` | O | O | checkpoint 기반 (동일) |
| `LOOP` | X | X | fillNextEdgesFromLoopMap (loopMap 기반) |
| `RANDOM` | X | X | getNextEdgeRandomly (랜덤) |

---

## 9. 1-based / 0-based 정리

| 데이터 | 인덱싱 | 비고 |
|--------|--------|------|
| Edge ID (CURRENT_EDGE, NEXT_EDGE) | **1-based** | 0 = invalid sentinel |
| pathBuffer 내 edge indices | **1-based** | edgeArray[edgeIdx - 1]로 접근 |
| Checkpoint.edge | **1-based** | pathBuffer와 동일 |
| edgeArray 접근 | **0-based** | edgeArray[edgeIdx - 1] |
| vehicleId | **0-based** | 0부터 시작 |
| pathBuffer 레이아웃 | `vehId * MAX_PATH_LENGTH` | [0]=len, [1~]=edges |
| checkpointBuffer 레이아웃 | `1 + vehId * SECTION_SIZE` | [0]=meta, 이후 vehicle별 section |

---

## 10. 곡선 사전 감속

TransferMgr는 곡선 사전 감속 상태도 관리합니다.

| 함수 | 역할 |
|------|------|
| `getCurveBrakeState(vehId)` | 감속 상태 조회 |
| `startCurveBraking(vehId, targetCurveEdge)` | 감속 시작 |
| `clearCurveBrakeState(vehId)` | 감속 상태 초기화 |
| `findDistanceToNextCurve(vehId, ...)` | 다음 곡선까지 거리 계산 |

---

## 11. 관련 시스템 연동

### LockMgr 연동
- `ILockMgrForNextEdge` 인터페이스로 연결
- `isMergeNode(nodeName)`: merge 여부 확인
- `checkGrant(nodeName, vehId)`: grant 확인 (legacy stub)
- Checkpoint 생성 시 `lockMgr.isMergeNode()` 사용

### AutoMgr → TransferMgr
- `assignCommand()` 호출로 경로 적용
- `hasPendingCommands()` 호출로 idle 체크
- `constructPathCommand()`: pathIndices → VehicleCommand 변환

### edgeTransition → TransferMgr
- `shiftNextEdges()`: pathBuffer shift + NEXT_EDGE shift
- `consumeNextEdgeReservationFromPathBuffer()`: reservedNextEdges 큐 소비

---

## 12. step() 내에서의 호출 순서

```
FabContext.step():
  1. Collision Check
  2. Lock (lockMgr.updateAll)
     └─ processCheckpoint() → handleMovePrepare() → NEXT_EDGE 채움
  3. Movement
     ├─ transferMgr.processTransferQueue()  ← LOOP 모드용
     └─ for each vehicle:
          └─ edge 전환 시 → shiftNextEdges()  ← NEXT_EDGE shift
  4. AutoRouting
     └─ autoMgr.update()
          └─ transferMgr.assignCommand()  ← pathBuffer + checkpoint 생성
  5. Render
```

---

## 13. 다음 작업

### 미완료
- [ ] FabContext에서 LockMgr.init() 호출 시 pathBuffer 전달 확인
- [ ] LOCK_REQUEST/LOCK_WAIT에서 TARGET_RATIO 설정 (grant 못 받으면 waitRatio, 받으면 1.0)
- [ ] 실제 동작 테스트 (단일 차량, merge 통과, 다중 차량 lock 경쟁)

### 성능 최적화 (우선순위 낮음)
- [ ] Ratio 정수 변환 (Float → Int 0~10000)
- [ ] LOCK_RELEASE checkpoint 구현 (현재 미사용)
