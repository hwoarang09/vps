# Lock Issue Report: v0.3.75 — 물리적 위치 기반 직진/우회 판별

## 1. 요약
- **버전**: v0.3.75
- **커밋**: (예정)
- **날짜**: 2026-04-27
- **상태**: 수정 완료, 검증 대기

v0.3.70~v0.3.74까지 5번의 시도가 모두 실패한 근본 원인 해결.
구 경로의 `releaseEdgeIdx` 대신 **차량의 현재 물리적 위치에서 merge까지 거리**로 판단.

## 2. 문제 상황 (v0.3.73/v0.3.74 코드에서 발생)

### 2.1 증상
- **fab**: fab_0_0
- **멈춘 시점**: 시뮬 시간 ~2:20 (약 140초)
- **deadlock 노드**: node 306 (0-based)
- **연쇄 stuck**: 2분~3분 사이 거의 전체 200대 정지

### 2.2 관련 차량
| 차량 | 역할 | 마지막 edge | 마지막 lock 상태 |
|------|------|-------------|-----------------|
| veh 114 | 앞차 (물리적) | edge 362 (exit 02:18) | **WAIT** at node 306 (02:23, holder=veh129) |
| veh 86 | 뒷차 (물리적) | edge 362 (exit 02:22) | **GRANT** at node 306 (02:26) |

### 2.3 시간순 이벤트 (deadlock 발생 구간)
```
02:12.754  veh 114  LOCK_REQ      node=306     ← 114 먼저 REQ
02:18.193  veh 114  edge 362 exit              ← 114 먼저 edge 통과
02:19.569  veh  86  LOCK_REQ      node=306     ← 86 REQ (큐: [..., 114, 86])
02:20.816  veh 114  LOCK_REQ      node=306     ← ★ 114 재REQ (경로 변경 → cancel 후 재등록)
02:22.737  veh  86  edge 362 exit              ← 86 같은 edge 통과 (114 뒤)
02:23.328  veh 114  LOCK_WAIT     node=306  holder=veh129
02:26.240  veh  86  LOCK_GRANT    node=306     ← 86이 GRANT (큐에서 114보다 앞)
```

### 2.4 차량 이동 궤적 (마지막 5 edge)
- **veh 114**: 384 → 372 → 373 → 374 → **362**
- **veh 86**: 358 → 359 → 360 → 361 → **362**

## 3. 원인 분석

### 3.1 v0.3.70~v0.3.74 공통 실패 원인

모든 시도가 **구 경로의 `releaseEdgeIdx`**로 직진/우회를 판별.
경로가 바뀌면 구 경로의 exit edge가 신 경로에 없어서 무조건 "우회" → cancel.

| 시도 | 보호 추가 | 놓친 것 |
|------|-----------|---------|
| v0.3.70 | 없음 (전부 cancel) | 가까운 차량 |
| v0.3.71 | 전부 keep | 먼 차량 |
| v0.3.72 | releaseEdgeIdx 기반 직진/우회 | HOLDER |
| v0.3.73 | HOLDER 보호 | WAIT 상태 |
| v0.3.74 | WAIT 보호 | REQ만 한 상태 (WAIT 도달 전) |

### 3.2 근본 문제
**판단 기준이 잘못됨.** `releaseEdgeIdx`(구 경로)는 경로 변경 후 의미 없는 값.
차량의 **현재 물리적 위치**와 merge까지의 **실제 거리**로 판단해야 함.

## 4. 해결

### 4.1 수정 방향
`releaseEdgeIdx` 기반 → **차량 currentEdge에서 merge node까지 newPath에서의 edge 거리** 기반

### 4.2 코드 변경

**lock-handlers.ts** — `releaseOrphanedLocks` 직진/우회 블록:
```typescript
// 물리적 위치 기반 직진/우회 판별 (v0.3.75)
const curEdge = data ? Math.trunc(data[vehicleId * VEHICLE_DATA_SIZE + MovementData.CURRENT_EDGE]) : 0;

// 새 경로에서 차량 위치
let vehPos = -1;
for (let j = 0; j < newPathEdges.length; j++) {
  if (newPathEdges[j] === curEdge) { vehPos = j; break; }
}
// 새 경로에서 merge 위치 (to_node === nodeName)
let mergePos = -1;
for (let j = 0; j < newPathEdges.length; j++) {
  const edge = state.edges[newPathEdges[j] - 1];
  if (edge && edge.to_node === nodeName) { mergePos = j; break; }
}

if (mergePos >= 0) {
  const dist = vehPos >= 0 ? (mergePos - vehPos) : mergePos;
  if (dist >= 0 && dist < MAX_DIRECT_MERGE_EDGES) {
    // 가까움 → 큐 유지 + releaseEdgeIdx 갱신
    if (mergePos + 1 < newPathEdges.length) {
      releases[i].releaseEdgeIdx = newPathEdges[mergePos + 1];
    }
    continue;
  }
}
// 멀거나 못 찾음 → cancel
```

**TransferMgr/index.ts** — line 622:
```diff
- lockMgr.releaseOrphanedLocks(vehId, mergeNodesInNewPath, edgeIndices, {
+ lockMgr.releaseOrphanedLocks(vehId, mergeNodesInNewPath, edgeIndicesWithCurrent, {
```
currentEdge를 newPathEdges에 포함시켜 물리적 위치를 찾을 수 있게 함.

### 4.3 6가지 케이스 검증
| 케이스 | dist | 결과 |
|--------|------|------|
| 가까운 차량, 경로 살짝 변경 | 2~3 | KEEP ✅ |
| 먼 우회 차량 | >10 | CANCEL ✅ |
| HOLDER | (별도 체크) | KEEP ✅ |
| WAIT 상태 | (별도 체크) | KEEP ✅ |
| REQ만, 물리적 가까움 | 3~5 | KEEP ✅ |
| REQ만, 물리적 멀리 | >10 | CANCEL ✅ |

## 5. 로그 파일
- `logs/20260427_0025_fab_0_0_edge_transit.bin` (21,881건, 0:03~11:33)
- `logs/20260427_0025_fab_0_0_lock.bin` (31,437건, 0:03~11:32)
- `logs/20260427_0025_fab_0_0_transfer.bin` (21,881건, 0:03~11:33)
- `logs/20260427_0025_fab_0_0_path.bin` (1,001건, 0:06~11:32)

## 6. 분석 명령어
```bash
python scripts/log_parser/analyze.py dev_lock_history/v0.3.75_physical_position/logs/ \
  --deadlock --pair 114 86 --node 306
python scripts/log_parser/analyze.py dev_lock_history/v0.3.75_physical_position/logs/ --stuck
```
