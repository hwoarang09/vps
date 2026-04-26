# Lock Issue Report: v0.3.74 — WAIT 상태 차량이 경로 변경 시 큐에서 제거되어 deadlock

## 1. 요약
- **버전**: v0.3.74 (수정 예정, 현재 코드는 v0.3.73 기반)
- **커밋**: 아직 없음 (v0.3.73 `e1438d4` 에서 발견)
- **날짜**: 2026-04-26
- **상태**: 미해결

WAIT 상태(merge 직전 정지)인 차량이 EWMA 경로 재할당을 받으면,
`releaseOrphanedLocks`의 직진/우회 판별에서 구 경로 `releaseEdgeIdx`가 신 경로에 없어
"우회"로 오판 → 큐에서 cancel → 재REQ 시 큐 맨 뒤 → 물리적 뒤차가 GRANT → **deadlock**.

## 2. 문제 상황

### 2.1 증상
- **fab**: fab_0_0 (0_0fab)
- **멈춘 시점**: 시뮬 시간 ~11:00 (약 660초)
- **deadlock 노드**: node 260 (0-based)
- **연쇄 stuck**: 11분~12분 사이 20대 이상 정지

### 2.2 관련 차량
| 차량 | 역할 | 마지막 edge | 마지막 lock 상태 |
|------|------|-------------|-----------------|
| veh 41 | 앞차 (물리적) | edge 316 → 317 (exit 10:58) | **REQ** at node 260 (11:01) |
| veh 108 | 뒷차 (물리적) | edge 316 → 317 (exit 11:00) | **GRANT** at node 260 (11:04) |

### 2.3 시간순 이벤트 (deadlock 발생 구간)
```
10:54.064  veh  41  LOCK_GRANT    node=271
10:55.088  veh  41  LOCK_RELEASE  node=271
10:55.104  veh 108  LOCK_GRANT    node=271
10:56.048  veh  41  LOCK_GRANT    node=274
10:57.376  veh 108  LOCK_RELEASE  node=271
10:57.760  veh  41  LOCK_RELEASE  node=274
10:57.889  veh  41  LOCK_REQ      node=260     ← 41이 먼저 REQ
10:58.352  veh  41  EDGE exit     edge=316→317  ← 41이 먼저 edge 통과
10:59.120  veh 108  LOCK_GRANT    node=274
10:59.312  veh  41  LOCK_WAIT     node=260     ← 41 WAIT (holder 불명 — 로그에 미기록)
11:00.224  veh 108  LOCK_RELEASE  node=274
11:00.304  veh 108  LOCK_REQ      node=260     ← 108도 REQ (큐: [..., 41, 108])
11:00.640  veh 108  EDGE exit     edge=316→317  ← 108도 같은 edge 통과 (41 뒤에)
11:01.600  veh  41  PATH_ASSIGN   dest=520 len=15  ← ★ 41 경로 재할당 (EWMA)
11:01.616  veh  41  LOCK_REQ      node=260     ← 41이 다시 REQ (cancel 후 재등록 → 큐 맨 뒤)
11:04.144  veh 108  LOCK_GRANT    node=260     ← 108이 GRANT! (41보다 큐에서 앞)
```

**이후**: 41은 WAIT(108이 holder) → 108은 41 뒤에서 collision으로 전진 불가 → **deadlock**

### 2.4 차량 이동 궤적 (마지막 10 edge)
- **veh 41**: 344 → 345 → 334 → 335 → 326 → 327 → 313 → 314 → 315 → **316**
- **veh 108**: 817 → 818 → 819 → 310 → 311 → 312 → 313 → 314 → 315 → **316**

둘 다 edge 313~316을 순서대로 통과. 41이 2초 먼저 316을 exit. 같은 rail 위에서 41이 앞.

### 2.5 Stuck 전파 (마지막 edge_transit 기준)
```
veh  41  edge 316  10:58  ← deadlock 시작
veh 108  edge 316  11:00  ← deadlock 시작
veh  92  edge 315  11:07  ← 뒤따라 정지
veh 144  edge 314  11:07
veh 197  edge 299  11:09
veh 193  edge 297  11:09
veh 153  edge 314  11:20
veh 107  edge 314  11:22
... (20대+ 연쇄)
```

## 3. 원인 분석

### 3.1 현재 코드의 문제 (`lock-handlers.ts:428-443`)
```typescript
if (newPathMergeNodes.has(nodeName)) {
  if (holder === vehicleId) {
    continue; // HOLDER → 유지 ✅
  }
  // 큐 대기 중 → 직진/우회 판별
  let posInPath = -1;
  for (let j = 0; j < newPathEdges.length; j++) {
    if (newPathEdges[j] === releaseEdgeIdx) {  // ← 구 경로의 releaseEdge!
      posInPath = j; break;
    }
  }
  if (posInPath >= 0 && posInPath < MAX_DIRECT_MERGE_EDGES) {
    continue; // 직진 → 유지
  }
  // 우회 → cancel  ← ★ 여기서 41이 cancel됨!
}
```

### 3.2 왜 문제인가

1. `releaseEdgeIdx`는 **구 경로** 기준으로 설정된 값
2. 경로가 바뀌면 구 경로의 releaseEdge가 신 경로에 없을 수 있음
3. 신 경로에 없으면 `posInPath = -1` → "우회" 판정 → cancel
4. **BUT**: 차량은 이미 WAIT 상태 = 물리적으로 merge 직전에 정지해 있음
5. cancel 후 재REQ → 큐 맨 뒤 → 물리적 뒤차(108)가 먼저 GRANT → **deadlock**

### 3.3 발생 조건
1. 차량 A가 merge node에 대해 REQ → WAIT 상태 (merge 직전 정지)
2. 차량 B가 같은 merge에 REQ (A 뒤에 큐 등록)
3. EWMA 라우팅이 A에게 경로 재할당
4. 신 경로에서 구 경로의 `releaseEdgeIdx`를 찾을 수 없음
5. A가 큐에서 cancel → 재REQ → 큐 맨 뒤
6. 이전 holder release → B가 A보다 먼저 GRANT
7. A는 B의 lock 때문에 WAIT, B는 A 뒤에서 collision → deadlock

## 4. 해결 (예정)

### 4.1 수정 방향

**WAIT 상태인 차량은 경로 변경 시에도 큐에서 cancel하지 않는다.**

이미 WAIT 상태 = 물리적으로 merge 직전. 큐에서 빼는 것은 의미 없음.
checkpoint 시스템이 이미 WAIT을 발동시킨 이상, 이 lock은 "커밋된" 것.

### 4.2 코드 변경 (예정)
```diff
  if (newPathMergeNodes.has(nodeName)) {
    if (holder === vehicleId) {
      continue; // HOLDER → 무조건 유지
    }
+   // WAIT 상태 = 이미 merge 직전에 정지 → 큐 유지 (cancel하면 priority inversion)
+   if (state.waitingVehicles.has(vehicleId)) {
+     continue;
+   }
    // 큐 대기 중 → 직진/우회 판별
    ...
  }
```

### 4.3 부작용 검토
- WAIT 상태에서 경로가 완전히 바뀌어 merge를 안 지나는 경우?
  → 이미 `newPathMergeNodes.has(nodeName)` 체크를 통과했으므로
    신 경로에도 이 merge가 있는 경우에만 해당. 안전함.
- WAIT 상태에서 먼 우회로 변경된 경우?
  → 차량이 이미 물리적으로 merge 직전에 있으므로 우회 여부와 무관.
    어차피 이 merge를 지나야 함. 큐 위치 유지가 맞음.

## 5. 추가 개선 필요 사항

### 5.1 로그 개선
WAIT 이벤트에 **holder 정보**가 없어서 분석 시 추정에 의존.
ML_LOCK 또는 DEV_LOCK_DETAIL에 holder vehId 추가 필요.

### 5.2 Flush 정책
현재 512건 버퍼가 다 차야 flush → 시뮬 멈추면 마지막 데이터 유실.
주기적 타이머 flush 또는 dispose 보장 필요.

## 6. 로그 파일
- `logs/20260426_2332_fab_0_0_edge_transit.bin` (37,888건, 0:03~14:04)
- `logs/20260426_2332_fab_0_0_lock.bin` (55,808건, 0:03~14:15)
- `logs/20260426_2332_fab_0_0_transfer.bin` (37,888건, 0:03~14:04)
- `logs/20260426_2332_fab_0_0_path.bin` (1,536건, 0:11~11:06)

## 7. 분석 명령어
```bash
# deadlock 분석
python scripts/log_parser/analyze.py dev_lock_history/v0.3.74_wait_cancel_deadlock/logs/ \
  --deadlock --pair 41 108 --node 260

# stuck 차량 탐지
python scripts/log_parser/analyze.py dev_lock_history/v0.3.74_wait_cancel_deadlock/logs/ --stuck

# 개별 차량 타임라인
python scripts/log_parser/analyze.py dev_lock_history/v0.3.74_wait_cancel_deadlock/logs/ \
  --veh 41 --from 10:50.000 --to 11:10.000
```

## 8. 관련 커밋 히스토리
| 버전 | 커밋 | 요약 | 결과 |
|------|------|------|------|
| v0.3.70 | `16aba12` | 미GRANT 무조건 cancel | 가까운 차량 밀림 → revert |
| v0.3.71 | `08dd86a` | v0.3.70 revert | 원래 문제 복귀 |
| v0.3.72 | `5bf7d49` | 직진/우회 판별 | HOLDER에도 적용 버그 |
| v0.3.73 | `e1438d4` | HOLDER 무조건 유지 | **WAIT 상태 cancel 미방지** ← 현재 이슈 |
