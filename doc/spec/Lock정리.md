# Lock 시스템 (Checkpoint 기반)

Merge Node(합류점)에서 차량 충돌을 방지하는 시스템입니다.
경로 결정 시점에 checkpoint 리스트를 미리 생성하고, 매 프레임 단순 비교(2개)만으로 동작합니다.

> **최종 업데이트: 2026-02-08** — Deadlock Zone Priority 추가

---

## 1. 핵심 개념

### 문제: Merge Node에서 충돌

여러 edge가 하나의 node로 합류하는 지점에서 차량이 동시에 진입하면 충돌이 발생합니다.

```
       Edge A
  VEH0 ────►╲
              ╲  Merge Node
       Edge B  ╲    ●──► Next Edge
  VEH1 ────────►╱
              ╱
       Edge C╱
  VEH2 ────►

❌ VEH0, VEH1, VEH2가 동시 진입 → 충돌!
```

### 해결: Lock Manager

LockMgr이 **진입 허가(Grant)**를 한 번에 한 대에게만 부여합니다.

```
  VEH0 ────► 🟢 GRANTED  → 진입
  VEH1 ────► 🔴 WAITING  → 대기
  VEH2 ────► 🔴 WAITING  → 대기
```

### 설계 원칙

| 원칙 | 설명 |
|------|------|
| **한 번에 한 대** | Merge Node당 동시 1대만 진입 |
| **FIFO 기본** | 먼저 요청한 차량이 먼저 진입 |
| **Zone Priority** | Deadlock zone 내부 차량은 최우선 |
| **Checkpoint 기반** | 매 프레임 비교 2개 (edge+ratio)로 99% 조기 종료 |

---

## 2. Checkpoint 시스템

### 왜 Checkpoint인가?

**기존 방식의 문제:**
매 프레임 전체 차량에 대해 merge 탐색, 거리 계산, lock 요청/확인을 수행.
10만대 × 60fps = **600만 번/초** 복잡한 계산.

**새 방식:**
경로가 결정되는 순간 모든 checkpoint를 미리 계산. 매 프레임은 `currentEdge === cpEdge && currentRatio >= cpRatio` 비교만 수행.
99%는 여기서 끝나고, 1%만 복잡한 로직 실행.

### Checkpoint 구조

```typescript
interface Checkpoint {
  edge: number;       // Edge ID (1-based)
  ratio: number;      // 0.0~1.0 (도달 지점)
  flags: number;      // CheckpointFlags bitmask
  targetEdge: number; // 관련 target edge (1-based)
}
```

### CheckpointFlags (Bitmask)

```typescript
LOCK_REQUEST  = 1 << 0  // 0x01 - merge lock 요청
LOCK_WAIT     = 1 << 1  // 0x02 - lock grant 대기
LOCK_RELEASE  = 1 << 2  // 0x04 - lock 해제
MOVE_PREPARE  = 1 << 3  // 0x08 - NEXT_EDGE 채우기
```

### 경로별 Checkpoint 예시

```
출발 → E10 → E11(직선,merge N5) → E12 → E13(곡선,merge N8) → 도착

checkpoints = [
  {edge:10, ratio:0.70, flags:REQ|PREP, target:E11},  // merge N5 lock 요청 + NEXT_EDGE 준비
  {edge:10, ratio:0.85, flags:WAIT,     target:E11},  // merge N5 대기 지점
  {edge:11, ratio:0.20, flags:RELEASE,  target:E11},  // merge N5 lock 해제
  {edge:11, ratio:0.80, flags:REQ,      target:E13},  // merge N8 lock 요청
  {edge:12, ratio:0.50, flags:PREP,     target:E13},  // 곡선 진입 전 NEXT_EDGE 준비
  {edge:12, ratio:0.95, flags:WAIT,     target:E13},  // merge N8 대기 지점
  {edge:13, ratio:0.20, flags:RELEASE,  target:E13},  // merge N8 lock 해제
]
```

### 처리 흐름 (processCheckpoint)

```
매 프레임, 차량마다:

1. currentEdge !== cpEdge → SKIP (99%)
2. currentRatio < cpRatio → SKIP
3. HIT! → flag별 처리:
   ├─ MOVE_PREPARE → NEXT_EDGE 채우기
   ├─ LOCK_RELEASE → lock 해제 + 다음 차량 grant
   ├─ LOCK_REQUEST → lock 요청 + auto-release 등록
   └─ LOCK_WAIT    → grant 확인 (BLOCKED or PASS)
4. flags == 0 → 다음 checkpoint 로드
```

---

## 3. Lock 요청~해제 전체 흐름

### 3.1 LOCK_REQUEST (lock 요청)

```
handleLockRequest(vehicleId):
  1. targetEdge = CURRENT_CP_TARGET (builder가 세팅)
  2. nodeName = targetEdge.from_node (= merge node)
  3. requestLockInternal(nodeName, vehId)
     └─ queues[nodeName].push(vehId)
     └─ 큐 길이 1이면 즉시 grant
  4. pendingReleases에 등록: {nodeName, releaseEdgeIdx=targetEdgeIdx}
     └─ 이 edge에 도달하면 자동 해제
```

### 3.2 LOCK_WAIT (lock 대기)

매 프레임 체크. grant 받을 때까지 차량을 정지시킵니다.

```
handleLockWait(vehicleId):
  holder = locks[nodeName]

  IF holder 있고 holder ≠ 나:
    ├─ Deadlock Zone Preemption 체크:
    │   IF 나=zone-internal AND holder=zone-external:
    │     → holder의 lock 회수 → 나에게 grant → PASS
    │
    └─ ELSE: 강제 정지
        → VELOCITY = 0
        → MOVING_STATUS = STOPPED
        → STOP_REASON |= LOCKED
        → return false

  ELSE (lock 없거나 내가 holder):
    → MOVING_STATUS = MOVING
    → return true (통과)
```

### 3.3 LOCK_RELEASE (lock 해제)

```
handleLockRelease(vehicleId):
  1. nodeName = currentEdge.to_node
  2. releaseLockInternal(nodeName, vehId)
     └─ locks.delete(nodeName) + 큐에서 제거
  3. grantNextInQueue(nodeName)
     └─ zone-internal 차량 우선, 없으면 FIFO
```

### 3.4 Auto-release (자동 해제)

```
매 프레임 checkAutoRelease():
  for each pendingRelease:
    IF currentEdge === releaseEdgeIdx:
      ├─ holder === vehId → release + grantNext (정상)
      └─ holder !== vehId → cancelFromQueue (큐에서만 제거)
```

---

## 4. Deadlock Zone

### 4.1 데드락 존이란?

분기점(branchNode)과 합류점(mergeNode)으로 이루어진 다이아몬드 형태의 교차 구간.
2개 경로가 분기했다가 합류하는 구간에서, FIFO 큐 순서와 물리적 제약이 충돌하면 교착이 발생합니다.

### 4.2 다이아몬드 구조

```
        N248 (분기) ← E285 진입
       ↙           ↘
  E286(직선)      E549(곡선)     ← zone-internal edges
     ↓               ↓
   N249(합류)      N346(합류)
     ↓               ↓
   E287            E398

        N345 (분기) ← E396 진입
       ↙           ↘
  E722(곡선)      E397(직선)     ← zone-internal edges
     ↓               ↓
   N249(합류)      N346(합류)
```

### 4.3 교착 시나리오

```
1. veh:125 → E285(zone 외부)에서 N249 lock 요청 → FIFO 1번
2. veh:14  → E722(zone 내부)에서 N249 lock 요청 → FIFO 2번
3. veh:125 → FIFO 1번이므로 grant 받음
4. BUT veh:125는 아직 E285에 있어서 물리적으로 N249에 접근 못함
5. veh:14 → zone 내부에서 빠져나갈 수 없음 → 영구 교착!
```

### 4.4 해법: Zone-Internal 우선순위

**Edge 플래그:**
| 플래그 | 의미 | 예시 |
|--------|------|------|
| `isDeadlockZoneInside` | 분기→합류 edge (존 내부) | E286, E549, E397, E722 |
| `isDeadlockZoneEntry` | 존 진입 edge | E285, E396 |

**우선순위 규칙:**
1. zone-internal 차량 = **최우선** (존을 빠져나가야 하므로)
2. zone-external 차량 = 일반 우선순위
3. zone-internal 끼리는 기존 FIFO 유지

**적용 지점 2곳:**

| 지점 | 메서드 | 동작 |
|------|--------|------|
| grant 시점 | `grantNextInQueue()` | 큐에서 zone-internal 차량 먼저 선택 |
| 대기 시점 | `handleLockWait()` | zone-internal 차량이 zone-external holder 선점 |

**선점(Preemption) 안전성:**
- holder가 zone-external → 아직 merge 통과 안 함 → lock 회수 안전
- 회수된 holder는 큐에 잔류 → 나중에 재grant
- zone-internal 끼리는 선점 안 함

---

## 5. 합류 유형별 Checkpoint 배치

### 5.1 직선 합류 (직선 → merge)

```
E10(직선, 긴 edge) → E11(target, fn=merge)

checkpoints:
  E10@0.xxx [REQ|PREP]  ← merge 5.1m 전
  E10@0.xxx [WAIT]      ← merge 1.89m 전 (waiting_offset)
  E11@0.200 [RELEASE]   ← merge 통과 후
```

### 5.2 곡선 합류 (곡선 → merge)

```
E10(직선) → E11(곡선, tn=merge)

checkpoints:
  E10@0.xxx [REQ]       ← 곡선 fn 1m 전 (직전 직선에서)
  E11@0.000 [WAIT]      ← 곡선 시작점 (fn에서 대기)
  E11@0.500 [PREP]      ← 곡선 중간 (NEXT_EDGE 준비)
  E12@0.200 [RELEASE]   ← merge 통과 후
```

### 5.3 직선 합류 + 곡선 target

```
E10(직선) → E11(짧은 직선) → E12(곡선 target, fn=merge)

checkpoints:
  E10 or E11@0.xxx [REQ]   ← merge 5.1m 전 (강제)
  E11@0.xxx [WAIT]         ← merge 1.89m 전
  E11@0.xxx [PREP]         ← 곡선 target 1.0m 전
  E12@0.200 [RELEASE]      ← merge 통과 후
```

**주의:** REQ와 PREP는 분리됨 (Bug #5 수정). REQ는 5.1m 전, PREP는 1.0m 전.

---

## 6. 놓친 Checkpoint 처리 (Catch-up)

짧은 edge(~1.5m)에서 한 프레임에 checkpoint를 건너뛸 수 있습니다.

```
프레임 N: E354@0.946 → CP는 E354@0.980 → SKIP (아직 미도달)
Movement: 0.946 + Δ = 1.014 → E355로 전환
프레임 N+1: E355 !== E354 → edge mismatch → ???
```

**해결:**
- `isCpEdgeBehind()`: cpEdge가 pathBuffer에 없으면 이미 지나감
- `handleMissedCheckpoint()`: PREP/REQ/RELEASE는 실행, WAIT는 스킵
- catch-up loop 최대 10개 연속 처리

---

## 7. 데이터 구조

### LockMgr 내부 상태

```typescript
locks: Map<string, number>          // nodeName → holder vehId
queues: Map<string, number[]>       // nodeName → 대기 큐 (FIFO + zone priority)
pendingReleases: Map<number, Array<{
  nodeName: string;
  releaseEdgeIdx: number;
}>>                                  // vehId → 자동 해제 목록
```

### VehicleDataArray 관련 필드

| 필드 | 역할 |
|------|------|
| `CURRENT_EDGE` | 현재 edge (1-based) |
| `EDGE_RATIO` | edge 진행률 (0.0~1.0) |
| `VELOCITY` | 현재 속도 |
| `MOVING_STATUS` | MOVING / STOPPED / PAUSED |
| `STOP_REASON` | 정지 사유 bitmask |
| `CURRENT_CP_EDGE` | 현재 CP edge (1-based, 0=없음) |
| `CURRENT_CP_RATIO` | 현재 CP ratio |
| `CURRENT_CP_FLAGS` | 현재 CP flags (mutable) |
| `CURRENT_CP_TARGET` | 현재 CP target edge |
| `CHECKPOINT_HEAD` | 다음 로드할 CP 인덱스 |

### Checkpoint 배열 구조

```
checkpointArray[0] = MAX_CHECKPOINTS_PER_VEHICLE (50)

Vehicle N section (offset: 1 + N * CHECKPOINT_SECTION_SIZE):
  [0]: count (실제 CP 개수)
  [1]: cp0_edge
  [2]: cp0_ratio
  [3]: cp0_flags
  [4]: cp0_targetEdge
  [5]: cp1_edge
  ...
```

---

## 8. 버그 수정 히스토리

| # | 증상 | 원인 | 수정 |
|---|------|------|------|
| 1 | 곡선 합류 시 WAIT가 REQ 앞에 배치 | REQ+PREP 합쳐서 곡선@0.5에 배치 | REQ/PREP 분리, REQ를 직전 직선에 배치 |
| 2 | 다른 edge의 CP 순서 보장 안됨 | 같은 edge 내부만 정렬 | `sortCheckpointsByPathOrder` 도입 |
| 3 | 직선 합류 시 WAIT 누락 | waiting_offset undefined | 기본값 1.89m 적용 |
| 4 | lock 영구 보유 | auto-release가 holder 미확인 | holder 체크 + `cancelFromQueue` 추가 |
| 5 | 직선합류+곡선target에서 REQ/PREP 역전 | PREP 1.0m < WAIT 1.89m | REQ/PREP 분리 (REQ=5.1m, PREP=1.0m) |
| 6 | 짧은 edge에서 CP 미스 → 영구 정지 | edge mismatch로 SKIP 무한 반복 | `isCpEdgeBehind` + catch-up loop |
| 7 | FIFO 교착 (zone-external이 차단) | 물리적 접근 불가 차량이 FIFO 선점 | zone-internal 우선순위 + preemption |

---

## 9. 파일 맵

| 파일 | 역할 |
|------|------|
| `src/common/vehicle/logic/LockMgr.ts` | Lock 시스템 메인 (checkpoint 처리, grant, release, deadlock zone) |
| `src/common/vehicle/logic/checkpoint/builder.ts` | Checkpoint 리스트 생성 (경로→CP 변환) |
| `src/common/vehicle/logic/checkpoint/utils.ts` | CP 정렬, 유틸리티 |
| `src/common/vehicle/logic/TransferMgr.ts` | pathBuffer 관리, checkpoint 저장 |
| `src/common/vehicle/logic/AutoMgr.ts` | 자동 경로 설정 (Dijkstra) |
| `src/common/vehicle/movement/edgeTransition.ts` | edge 전환, NEXT_EDGE shift |
| `src/common/vehicle/initialize/constants.ts` | CheckpointFlags, StopReason, MovementData 등 |
| `src/store/map/edgeStore.ts` | `updateDeadlockZoneFlags()` (zone 플래그 설정) |
| `src/components/react/menu/panels/LockInfoPanel.tsx` | Lock 상태 UI 표시 |

---

## 10. 디버그 로그 태그

| 태그 | 의미 |
|------|------|
| `[processCP] HIT!` | Checkpoint 도달 |
| `[processCP] MISSED!` | CP 건너뜀 (catch-up) |
| `[LOCK_REQ]` | lock 요청 + auto-release 등록 |
| `[LOCK_WAIT] BLOCKED` | lock 대기 (강제 정지) |
| `[LOCK_WAIT] PASS` | lock 통과 |
| `[LOCK_WAIT] PREEMPT` | zone-internal → zone-external holder 선점 |
| `[LOCK_GRANT]` | 큐 다음 차량에 grant |
| `[LOCK_GRANT] ZONE_PRIORITY` | zone-internal 우선 grant |
| `[AUTO_RELEASE]` | 자동 해제 |
| `[AUTO_RELEASE] CANCEL` | holder 아닌데 auto-release → 큐 제거만 |
| `[MOVE_PREP]` | NEXT_EDGE 채움 |
