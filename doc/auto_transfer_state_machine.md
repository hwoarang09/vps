# AutoMgr Transfer State Machine — 전체 로직 + 회귀 분석

> 파일: `src/common/vehicle/logic/AutoMgr.ts`
> 관련 버그: N216 deadlock(v0.4.20), 짧은 edge stuck(v0.4.21 수정)
> 마지막 갱신: 2026-05-05

---

## 1. 큰 그림

차량 한 대가 한 transfer 작업을 끝내려면 다음 5단계를 거친다:

```
IDLE
  └─ transfer 할당 (utilization/throughput 여유 있을 때)
       │  → JobState = MOVE_TO_LOAD
       │  → assignToStation(srcStation): 현재 위치 → src edge 까지의 path 깔림
       ▼
MOVE_TO_LOAD
  └─ 차량 src edge 진입
       │  → preloadNextPath(src, dest): src → dest path 미리 깔림 ★ 핵심
       │  → TARGET_RATIO = src.ratio (감속해서 station 위치에서 멈춤)
       ▼
   isStopped → JobState = LOADING (dwellTimer +7s)
       ▼
LOADING (7s dwell)
  └─ → JobState = MOVE_TO_UNLOAD, TARGET_RATIO=1, MOVING
  └─ pathBuffer 에 있는 src→dest path 따라 이동 시작
       ▼
MOVE_TO_UNLOAD
  └─ 차량 dest edge 진입
       │  → preloadLoopPath: dest → 다음 자유 주행 path 미리 깔림
       │  → TARGET_RATIO = dest.ratio
       │  → dwellTimer = Infinity (sentinel, 첫 if 재진입 방지)
       ▼
   isStopped → JobState = UNLOADING (dwellTimer +7s)
       ▼
UNLOADING (7s dwell)
  └─ → JobState = IDLE, TARGET_RATIO=1, MOVING
  └─ preloadLoopPath 가 깐 path 따라 다음 transfer 까지 자유 주행
```

**핵심 invariant**: 매 dwell(LOADING/UNLOADING) 시작 직전에 차량이 dwell 끝나고 갈 path가 미리 깔려 있어야 함. 안 깔리면 dwell 7초 후 차량이 갈 곳 없어 멈춤 → deadlock.

---

## 2. assignToStation: 3가지 case

`assignToStation` 은 차량을 특정 station 으로 보내는 함수. 차량 현재 위치에 따라 3가지 분기:

### case A: 현재 edge ≠ station.edgeIndex (가장 흔한 케이스)

```typescript
this.pathFindCountThisFrame++;
const pathIndices = findShortestPath(currentEdgeIdx, station.edgeIndex, edgeArray, this.routingContext);
if (!pathIndices || pathIndices.length === 0) return false;
this.applyPathToVehicle({ vehId, pathIndices, candidate: station, ... });
```

→ Dijkstra 로 현재 edge → station edge path 찾아 적용. 끝.

### case B: 현재 edge == station.edgeIndex && station.ratio >= currentRatio

```typescript
if (currentEdgeIdx === station.edgeIndex) {
  if (station.ratio >= currentRatio) {
    transferMgr.clearVehiclePath(vehId);
    if (lockMgr) this.cancelObsoleteLocks(vehId, [currentEdgeIdx], edgeArray, lockMgr);
    this.vehicleDestinations.set(vehId, station);
    data[ptr + MovementData.TARGET_RATIO] = station.ratio;
    if (currentStatus === MovingStatus.STOPPED) {
      data[ptr + MovementData.MOVING_STATUS] = MovingStatus.MOVING;
    }
    return true;
  }
  ...
}
```

→ 같은 edge 위에 있고 station 위치가 앞에 있음 → 그냥 TARGET_RATIO 만 set. path 새로 안 깖.

### case C: 현재 edge == station.edgeIndex && station.ratio < currentRatio (loop-around)

```typescript
} else {
  // Station is behind us on the same edge. We must loop around.
  const currentEdge = edgeArray[currentEdgeIdx - 1];
  if (!currentEdge || !currentEdge.nextEdgeIndices || currentEdge.nextEdgeIndices.length === 0) {
    return false;
  }

  let bestPath: number[] | null = null;
  for (const nextIdx of currentEdge.nextEdgeIndices) {
    this.pathFindCountThisFrame++;
    const p = findShortestPath(nextIdx, station.edgeIndex, edgeArray, this.routingContext);
    if (p && p.length > 0) {
      if (!bestPath || p.length < bestPath.length - 1) {
        bestPath = [currentEdgeIdx, ...p];
      }
    }
  }

  if (!bestPath) return false;

  this.applyPathToVehicle({
    vehId, pathIndices: bestPath, candidate: station, ...
  });
  // ★ FIX: 차량이 srcStation.edgeIndex 위에 있지만 station 위치를 이미 지나친 상태.
  // MOVE_TO_LOAD branch 가 이 차량 처리 보류하도록 표시. 차량이 edge 떠나면 자동 해제.
  this.loopAroundVehicles.add(vehId);
  return true;
}
```

→ 같은 edge 위에 있는데 station 위치가 뒤에 있음. **뒤로 갈 수는 없으니** edge 끝까지 가서 한 바퀴 돌아 다시 station edge 로 들어와야 함. nextEdges 각각에 대해 station.edgeIndex 까지 Dijkstra 돌려서 가장 짧은 loop 선택.

이때 차량은 `srcStation.edgeIndex` 위에 있고 ratio > station.ratio. **이 상태가 v0.4.20 의 N216 deadlock 의 원인이었음** (다음 섹션에서 자세히).

---

## 3. v0.4.20 N216 deadlock — 첫 번째 fix

### 증상

차량이 lock 을 들고 있는 상태에서 ratio 가 갑자기 backward 로 텔레포트 → lock 위치 desync → deadlock.

### 메커니즘

`assignToStation` case C (loop-around) 적용 직후의 frame:
- 차량 currentEdge = srcStation.edgeIndex
- 차량 currentRatio > srcStation.ratio
- pendingSrcStation set 됨 (transfer assign 시)
- JobState = MOVE_TO_LOAD

이 상태에서 MOVE_TO_LOAD branch (전 v0.4.19 코드):

```typescript
if (srcStation && currentEdgeIdx === srcStation.edgeIndex) {
  // 무조건 실행 (가드 없음)
  preloadNextPath(...);
  data[ptr + MovementData.TARGET_RATIO] = srcStation.ratio;  // ★ backward set
  this.pendingSrcStation.delete(vehId);
}
```

`TARGET_RATIO = srcStation.ratio` 로 backward set 되면, 시뮬레이션 엔진의 `checkTargetReached(rawNewRatio >= targetRatio)` 가 즉시 true 가 되어 ratio 를 targetRatio 로 강제 → 차량이 뒤로 텔레포트.

만약 차량이 `srcStation.edgeIndex` 의 to_node 락을 hold 하고 있는 상태였다면, 위치는 뒤로 갔는데 락은 그대로 → 위치/락 desync. 다른 차량이 그 락 풀리길 기다리고, 텔레포트한 차량은 다음 진행 못 하고 → deadlock.

### v0.4.20 fix

MOVE_TO_LOAD/MOVE_TO_UNLOAD 분기에 ratio 비교 가드 추가:

```typescript
const currentRatio = data[ptr + MovementData.EDGE_RATIO];
if (currentRatio > srcStation.ratio) {
  // loop 도는 중 — path 그대로 따라가게 두고 다음 진입 대기
} else {
  // 정상 처리 ...
}
```

→ 차량이 station 을 이미 지난 상태면 처리 보류. loop 한 바퀴 돌고 다시 ratio≈0 으로 재진입할 때 정상 처리.

---

## 4. v0.4.20 가 만든 회귀 — 짧은 edge stuck

### 증상 1: veh 174 (cop fab, EDGE0473)

```
[00:28.832] EDGE_CHANGE 758→473
[00:28.832] PATH_ASSIGNED dest_edge=473 path_len=1   ← 빈 path
[37.328s ~] ratio=0.5081 vel=0 (LOADING)
[39.456s ~] vel 다시 증가 (LOADING 끝, MOVE_TO_UNLOAD 전환)
[42.592s] ratio=1.0 vel=0  ← edge 끝까지 가서 멈춤
... 290초간 같은 상태 (deadlock)
```

`station.map`(cop) 분석:
```
EDGE0473 에 station 다수, 모두 ratio=0.5081
149 edges 에 4349 stations (평균 29 station/edge)
```

→ transfer assign 의 random 선택이 srcStation/destStation 을 같은 edge (EDGE0473) 에 떨어뜨릴 확률 매우 높음. 이때 `preloadNextPath` 호출 시:

```typescript
findShortestPath(473, 473) → [473]   // 길이 1
constructPathCommand([473]) → []       // i=1 부터 루프, 길이 1 이라 진입 X
transferMgr.assignCommand({ path: [] }) → pathBuffer 안 채워짐
```

LOADING 7초 후 MOVE_TO_UNLOAD 로 전환되며 `TARGET_RATIO=1` 설정 → 차량 edge 끝까지 이동 → pathBuffer 비어있어 다음 edge 못 감 → 멈춤.

거기서 v0.4.20 의 MOVE_TO_UNLOAD guard 가 발동:

```typescript
if (currentRatio > destStation.ratio) {
  // 처리 보류  ← currentRatio=1.0 > 0.5081 → 영구 true
}
```

→ `dwellTimers` set 안 되니 `else if (isStopped && ...)` UNLOADING 분기로도 못 빠짐 → **영구 deadlock**.

### 1차 fix: `preloadNextPath` 에 src==dest 분기 추가

```typescript
private preloadNextPath(...) {
  let pathIndices: number[] | null = null;

  if (srcStation.edgeIndex === destStation.edgeIndex) {
    // src/dest 가 같은 edge — assignToStation case C 와 동일 패턴으로 loop path 생성
    const srcEdge = edgeArray[srcStation.edgeIndex - 1];
    if (!srcEdge || !srcEdge.nextEdgeIndices || srcEdge.nextEdgeIndices.length === 0) return;

    let bestPath: number[] | null = null;
    for (const nextIdx of srcEdge.nextEdgeIndices) {
      this.pathFindCountThisFrame++;
      const p = findShortestPath(nextIdx, destStation.edgeIndex, edgeArray, this.routingContext);
      if (p && p.length > 0) {
        if (!bestPath || p.length < bestPath.length - 1) {
          bestPath = [srcStation.edgeIndex, ...p];
        }
      }
    }
    pathIndices = bestPath;
  } else {
    this.pathFindCountThisFrame++;
    pathIndices = findShortestPath(srcStation.edgeIndex, destStation.edgeIndex, edgeArray, this.routingContext);
  }

  if (!pathIndices || pathIndices.length === 0) return;
  this.applyPathToVehicle({ vehId, pathIndices, candidate: destStation, ... });
}
```

→ src==dest 케이스도 정상 loop path 생성. 174 같은 차량은 LOADING 후 loop 한 바퀴 돌고 dest(=src) 로 재진입해서 UNLOADING 가능.

### 증상 2: veh 64 (cop fab, EDGE0176, 길이 0.92m)

1차 fix 적용했음에도 또 다른 패턴의 stuck 발생:

```
[42:12.520] PATH_ASSIGNED dest_edge=176 path_len=16
... 16 edges 따라 정상 이동 ...
[43:15.113] EDGE_CHANGE 175 → 176  (목적지 edge 진입)
[43:15.304] EDGE_CHANGE 176 → 177  (191ms 만에 통과)
[43:15.304~] EDGE_CHANGE 177→17→18→19→1
[43:40.096] edge 1 ratio=1.0 vel=0  ← 멈춤
... 이후 약 41분간 같은 상태
```

EDGE0176 은 **길이 0.92m, station.ratio=0.05**. 차량이 5m/s 풀스피드로 진입하면 1 frame(~100ms)에 ratio 가 약 0.5 증가. 즉 차량이 edge 진입 후 AutoMgr.update 가 처음 보는 ratio 는 이미 ≈0.5 (>> 0.05).

v0.4.20 의 guard:
```typescript
if (currentRatio > srcStation.ratio) {  // 0.5 > 0.05 → true
  // 처리 보류
}
```

→ preloadNextPath 한 번도 호출 안 됨 → pathBuffer 비어감 → `transferMgr.determineNextEdge`(`L531`) 의 fallback `nextEdgeIndices[0]` 따라 default drift → 결국 어디선가 lock 못 잡고 멈춤.

### 근본 원인

v0.4.20 의 가드가 두 가지 다른 상황을 ratio 비교만으로 구분하려 했음:
1. **case C 직후의 loop-around 진행 중** (텔레포트 위험) — 처리 보류 필요
2. **짧은 edge 에서 ratio 가 빠르게 증가하는 정상 첫 진입** — 처리 필요

ratio 비교만으로는 둘 다 `currentRatio > station.ratio` 라 구분 불가능. 짧은 edge 케이스가 잘못된 분기로 빠짐.

---

## 5. v0.4.21 fix — `loopAroundVehicles` Set 으로 명시 추적

### 핵심 아이디어

ratio 비교가 아니라 **"case C 가 실제로 적용됐는지"** 를 명시적으로 추적. case C 분기에서 차량을 set 에 추가, 차량이 edge 떠나면 set 에서 제거.

### 변경 1: 필드 추가

```typescript
// vehId set: assignToStation case 2 (loop-around) 적용 직후 차량 표시.
// 차량이 srcStation.edgeIndex 위에 있지만 station 위치를 이미 지나친 상태라 loop path 따라
// 한 바퀴 돌고 와야 함. MOVE_TO_LOAD branch 가 이 set 의 차량은 처리 보류 (preloadNextPath
// 호출 안 함, backward TARGET_RATIO 안 set) → 차량이 srcStation.edgeIndex 떠나면 set 해제 →
// 다시 진입(ratio≈0) 시 정상 처리.
private readonly loopAroundVehicles: Set<number> = new Set();
```

### 변경 2: `assignToStation` case C 에서 set 에 추가

```typescript
this.applyPathToVehicle({
  vehId, pathIndices: bestPath, candidate: station, ...
});
// ★ FIX: 차량이 srcStation.edgeIndex 위에 있지만 station 위치를 이미 지나친 상태.
// MOVE_TO_LOAD branch 가 이 차량 처리 보류하도록 표시. 차량이 edge 떠나면 자동 해제.
this.loopAroundVehicles.add(vehId);
```

### 변경 3: MOVE_TO_LOAD branch — guard 제거, set 체크로 교체

```typescript
if (jobState === JobState.MOVE_TO_LOAD) {
  const srcStation = this.pendingSrcStation.get(vehId);

  // Cleanup loopAround flag: vehicle 이 srcStation.edgeIndex 떠나면 해제 (loop 한 바퀴 돌고
  // 다시 들어올 때 정상 처리되도록). 짧은 edge(<1m) 에서 ratio 가 1 frame 만에 station.ratio
  // 를 넘는 케이스를 ratio 비교만으로는 구분할 수 없기 때문에 set 으로 명시 추적.
  if (this.loopAroundVehicles.has(vehId)
    && (!srcStation || currentEdgeIdx !== srcStation.edgeIndex)) {
    this.loopAroundVehicles.delete(vehId);
  }

  if (srcStation && currentEdgeIdx === srcStation.edgeIndex) {
    if (this.loopAroundVehicles.has(vehId)) {
      // assignToStation case 2 직후: vehicle 이 srcStation.edgeIndex 위에 있지만
      // station 위치를 이미 지나침. loop path 적용된 상태로 path 따라 한 바퀴 돌게 두고
      // 다음 진입(ratio≈0) 대기. preloadNextPath/TARGET_RATIO 건드리면 텔레포트(N216).
    } else {
      // 정상 진입(loop 한 바퀴 돌고 ratio≈0 으로 재진입 OR 다른 edge 에서 normal path 끝)
      // → preload dest path + station 에서 stop
      const destStation = this.pendingDestStation.get(vehId);
      if (destStation) {
        this.actualDestStation.set(vehId, destStation);
        this.preloadNextPath(
          vehId, srcStation, destStation,
          vehicleDataArray, edgeArray, edgeNameToIndex, transferMgr, lockMgr
        );
      }
      data[ptr + MovementData.TARGET_RATIO] = srcStation.ratio;
      this.pendingSrcStation.delete(vehId);
    }
  } else if (!srcStation && isStopped) {
    data[ptr + LogicData.JOB_STATE] = JobState.LOADING;
    data[ptr + OrderData.PICKUP_ARRIVE_TS] = simulationTime;
    data[ptr + OrderData.PICKUP_START_TS] = simulationTime;
    this.dwellTimers.set(vehId, now + this.dwellMs);
  }
}
```

### 변경 4: MOVE_TO_UNLOAD branch — guard 제거 (원본 복원)

```typescript
else if (jobState === JobState.MOVE_TO_UNLOAD) {
  const destStation = this.actualDestStation.get(vehId)
    ?? this.vehicleDestinations.get(vehId);
  if (destStation && currentEdgeIdx === destStation.edgeIndex
    && !this.dwellTimers.has(vehId)) {
    // Just entered dest station edge — pre-load loop path
    // (MOVE_TO_LOAD 와 달리 destStation 도달은 항상 정상 path 끝이므로 loop-around guard 불필요.
    // dwellTimer=Infinity sentinel 이 다음 frame 첫 if skip 시켜서 isStopped UNLOADING 분기로 빠지게 함.)
    this.preloadLoopPath(
      vehId, destStation,
      vehicleDataArray, edgeArray, edgeNameToIndex, transferMgr, lockMgr
    );
    data[ptr + MovementData.TARGET_RATIO] = destStation.ratio;
    this.dwellTimers.set(vehId, Infinity);
  } else if (isStopped && destStation && currentEdgeIdx === destStation.edgeIndex) {
    data[ptr + LogicData.JOB_STATE] = JobState.UNLOADING;
    data[ptr + OrderData.DROP_ARRIVE_TS] = simulationTime;
    data[ptr + OrderData.DROP_START_TS] = simulationTime;
    this.dwellTimers.set(vehId, now + this.dwellMs);
  }
}
```

→ MOVE_TO_UNLOAD 에서는 case C 같은 loop-around 진입 경로가 없음. destStation 도달은 항상 정상 path 끝. 따라서 guard 불필요.

### 변경 5: dispose 에서 cleanup

```typescript
this.loopAroundVehicles.clear();
```

---

## 6. 시나리오 추적 — 4가지 케이스

각 케이스가 fix 후 어떻게 흘러가는지 단계별 추적.

### 시나리오 1: 정상 transfer (src ≠ dest, currentEdge 다른 곳)

```
[t=0] 차량 idle, currentEdge=A
       transfer assign: srcStation(edge=B, ratio=0.5), destStation(edge=C, ratio=0.5)
       transferMgr.clearVehiclePath(vehId)
       assignToStation(srcStation):
         currentEdge=A != B → case A
         findShortestPath(A, B) = [A, X, Y, ..., B]
         applyPathToVehicle → pathBuffer 채워짐, B 의 마지막 명령에 targetRatio=0.5
       transferringVehicles.add, pendingSrcStation/pendingDestStation set
       JobState = MOVE_TO_LOAD

[t=N] 차량 X→Y→...→B 이동, B 진입 (ratio=0)
       MOVE_TO_LOAD branch:
         loopAroundVehicles.has(vehId)? → false
         srcStation && currentEdge==srcStation.edgeIndex → true
         not in loopAround → process:
           preloadNextPath(B, C):
             B != C → findShortestPath(B, C) = [B, ..., C]
             applyPathToVehicle → pathBuffer extends with B→C path
           TARGET_RATIO = srcStation.ratio = 0.5
           pendingSrcStation.delete

[t=N+k] 차량 ratio=0.5 도달, vel=0
       MOVE_TO_LOAD branch:
         srcStation undefined (deleted)
         else if (!srcStation && isStopped) → JobState=LOADING, dwellTimer=now+7000

[t=N+k+7s] LOADING dwell 끝
       LOADING branch: JobState=MOVE_TO_UNLOAD, TARGET_RATIO=1, MOVING

[t=N+k+7s+] 차량 출발, B 끝까지 가서 다음 edge 로 transit, B→C path 따라 이동
       (MOVE_TO_LOAD branch 안 들어감, JobState=MOVE_TO_UNLOAD)

[t=M] 차량 C 진입 (ratio=0)
       MOVE_TO_UNLOAD branch:
         destStation && currentEdge==C && !dwellTimers.has → true
         preloadLoopPath: C → 다른 random station 까지 path 생성, applyPathToVehicle
         TARGET_RATIO = destStation.ratio = 0.5
         dwellTimers.set(Infinity)

[t=M+k] 차량 ratio=0.5 도달, vel=0
       MOVE_TO_UNLOAD branch:
         dwellTimers.has → true → 첫 if skip
         else if (isStopped && ...) → JobState=UNLOADING, dwellTimer=now+7000

[t=M+k+7s] UNLOADING dwell 끝
       UNLOADING branch: JobState=IDLE, transferringVehicles.delete, MOVING
       preloadLoopPath 가 깐 path 따라 자유 주행
```

### 시나리오 2: assignToStation case C (currentEdge==src.edgeIndex && 이미 지남)

```
[t=0] 차량 idle, currentEdge=B, currentRatio=0.7
       transfer assign: srcStation(edge=B, ratio=0.5), destStation(edge=C, ratio=0.5)
       assignToStation(srcStation):
         currentEdge==B && srcStation.ratio=0.5 < currentRatio=0.7 → case C
         B의 nextEdges 통해 B로 돌아오는 loop path 생성: [B, X, Y, ..., B]
         applyPathToVehicle → pathBuffer 채워짐
         loopAroundVehicles.add(vehId)  ★
       JobState=MOVE_TO_LOAD

[t=1] 다음 frame, 차량 여전히 B (ratio=0.7→0.75)
       MOVE_TO_LOAD branch:
         srcStation && currentEdge==B → true
         loopAroundVehicles.has → true → SKIP (preloadNextPath, TARGET_RATIO 안 건드림)

[t=2] 차량 B 끝까지 가서 X 로 transit
       MOVE_TO_LOAD branch:
         currentEdge==X != B
         loopAroundVehicles cleanup: currentEdge != srcStation.edgeIndex → delete from set
         첫 if false (currentEdge != B)
         else if (!srcStation && isStopped): srcStation 살아있으니 false
         → branch 그냥 통과 (pathBuffer 따라 정상 이동)

[t=3..] X→Y→...→B 한 바퀴
       MOVE_TO_LOAD branch: 모두 skip (currentEdge != B)

[t=M] 차량 다시 B 진입 (ratio=0)
       MOVE_TO_LOAD branch:
         loopAroundVehicles.has → false (cleanup 됐음)
         srcStation && currentEdge==B → true
         not in loopAround → process:
           preloadNextPath(B, C) → path 깔림
           TARGET_RATIO = 0.5
           pendingSrcStation.delete

       (이후 시나리오 1 과 동일)
```

**N216 deadlock 안 일어남**: t=1 에서 `TARGET_RATIO=0.5` backward set 이 차단됐기 때문 (skip).

### 시나리오 3: src==dest 같은 edge (cop EDGE0473 174 케이스)

```
[t=0] 차량 currentEdge=A
       transfer assign: srcStation(edge=B, ratio=0.5081), destStation(edge=B, ratio=0.5081)
       assignToStation(srcStation):
         A != B → case A → path [A, ..., B]

[t=N] 차량 B 진입 (ratio=0)
       MOVE_TO_LOAD branch:
         not in loopAroundVehicles → process:
           preloadNextPath(B, B):
             ★ src==dest fix: B의 nextEdges 통해 B로 돌아오는 loop path 생성
             pathIndices = [B, X, Y, ..., B]
             applyPathToVehicle → pathBuffer 채워짐
           TARGET_RATIO = 0.5081
           pendingSrcStation.delete

[t=N+k] 차량 ratio=0.5081 도달, isStopped → LOADING (dwellTimer +7s)
[t=N+k+7s] LOADING 끝 → MOVE_TO_UNLOAD, TARGET_RATIO=1
[차량 X→Y→...→B 한 바퀴]
[t=M] 차량 다시 B 진입 (ratio=0)
       MOVE_TO_UNLOAD branch:
         destStation && currentEdge==B && !dwellTimers.has → true
         preloadLoopPath, TARGET_RATIO=0.5081, dwellTimer=Infinity

[t=M+k] ratio=0.5081 도달, isStopped → UNLOADING (dwellTimer +7s)
[t=M+k+7s] UNLOADING 끝 → IDLE
```

### 시나리오 4: 짧은 edge (cop EDGE0176, 0.92m, 64 케이스)

```
[t=0] 차량 currentEdge=A (멀리 떨어진 edge)
       transfer assign: srcStation(edge=176, ratio=0.05), destStation(edge=Z, ratio=0.5)
       assignToStation(srcStation):
         A != 176 → case A → path [A, ..., 176]
         path 의 마지막 명령: { edgeId='EDGE0176', targetRatio=0.05 }

[t=...] 차량 path 따라 이동, 175 진입 (이전 edge 이고 19.88m 정도라 충분히 김)
       transferMgr 가 175 의 다음 edge=176 의 targetRatio=0.05 를 알고 있음
       엔진이 175 위에서 미리 감속 시작 (이상적으로는)

[t=N] 차량 176 진입. ratio=0 (이상적) 또는 ratio>0 (감속 못한 경우)
```

**Sub-case 4-A** (감속 잘 됐을 때, ratio<0.05):
```
       MOVE_TO_LOAD branch:
         not in loopAroundVehicles → process:
           preloadNextPath(176, Z) → path [176, ..., Z]
           TARGET_RATIO = 0.05
           pendingSrcStation.delete
       차량 ratio=0.05 도달, LOADING, ... 정상 흐름
```

**Sub-case 4-B** (감속 못 했음, currentRatio=0.5 already):
```
       MOVE_TO_LOAD branch:
         not in loopAroundVehicles → process:  ★ v0.4.21 에서 처리됨!
           preloadNextPath(176, Z) → path [176, ..., Z]  ← path 깔림!
           TARGET_RATIO = 0.05  ← backward set, 이번 케이스에선 텔레포트 발생할 수 있음
           pendingSrcStation.delete
```

이 sub-case 의 텔레포트는 N216 만큼 위험하지 않음 (같은 edge 내에서만 이동). 락 desync 발생할 수 있는 것은 다른 lock 이 이미 잡혀있을 때만이고, 짧은 edge 진입 시점엔 다음 edge 락만 잡아둔 상태라 영향 적음.

만약 텔레포트조차 막고 싶으면 추가 fix:
```typescript
const currentRatio = data[ptr + MovementData.EDGE_RATIO];
if (currentRatio <= srcStation.ratio) {
  data[ptr + MovementData.TARGET_RATIO] = srcStation.ratio;
}
// else: backward 라 설정 안 함. 차량은 path 따라 그냥 통과 → 다음 진입 시 ratio=0 부터 다시 처리될 것
// (단 이 경우 LOADING 안 함. JobState=MOVE_TO_LOAD 로 dest 까지 감 → 다른 처리 필요)
```

→ 하지만 이러면 LOADING 못 함 (벨로시티 그대로 통과 → !isStopped 라 LOADING 분기 진입 못 함). 별도 fallback 필요.

**현 v0.4.21 의 trade-off**: 짧은 edge 에서 텔레포트 작게 발생할 수 있지만 deadlock 은 없음. 시뮬레이션 가시화 측면에서 ratio 가 살짝 튀는 정도이고 락 desync 위험 낮음. 추가 정밀화는 차후 과제.

---

## 7. 4가지 path 사전 처리 정리표

각 path가 어떤 시점에 깔리고, 어떤 TARGET_RATIO 가 설정되는지:

| 단계 | 트리거 | 깔리는 path | TARGET_RATIO | 상태 변경 |
|------|--------|-------------|--------------|-----------|
| transfer assign | 할당량 여유 | currentEdge → src | (case A: 자동, case C: 1) | →MOVE_TO_LOAD |
| **preloadNextPath** | src edge 첫 진입 (loopAround 아닐 때) | src → dest (또는 src→loop→dest) | src.ratio (override) | dwellTimer 미사용 |
| LOADING 종료 | +7s | (변경 없음) | 1 (transit 유도) | →MOVE_TO_UNLOAD |
| **preloadLoopPath** | dest edge 첫 진입 | dest → 다른 station | dest.ratio (override) | dwellTimer=Infinity |
| UNLOADING 종료 | +7s | (변경 없음) | 1 | →IDLE |

---

## 8. 디버깅 체크리스트

차량이 멈춰있을 때 의심해야 할 것:

1. **path log 확인**: `python3 scripts/log_parser/analyze.py logs/SESSION --veh VEH_ID`
   - `PATH_ASSIGNED dest_edge=X path_len=1` → src==dest 같은 edge 케이스 (1차 fix 로 해결)
   - PATH log 없는데 차량이 다른 edge 로 이동 → preloadNextPath 가 호출 안 됐을 수 있음 (loopAround/짧은 edge 이슈)

2. **snapshot 추적**: 차량의 ratio/vel/edge timeline
   - `ratio=1.0 vel=0` 으로 멈춤 → pathBuffer 비어 차량이 default `nextEdgeIndices[0]` 도 못 찾음
   - 짧은 edge(<2m) 진입 후 빠른 통과 → snapshot 으로 ratio 점프 폭 확인

3. **stations on edge**: `awk -F',' 'NR>7 && $(NF-2)=="EDGE0XXX"' public/railConfig/cop/station.map`
   - 같은 edge 에 station 다수 → src==dest 케이스 가능성

4. **edge 길이**: `analyze.py --topology --rail-dir public/railConfig/cop --edge-idx XXX`
   - <1m + 작은 station.ratio → 시나리오 4-B 케이스

5. **lock log**: `--veh VEH --lock-detail` 로 락 hold/wait 확인. 텔레포트 의심 시 ratio jump 와 lock 위치 비교

---

## 9. 향후 과제

- **시나리오 4-B 의 backward TARGET_RATIO 텔레포트 정밀화**: 짧은 edge 에서 텔레포트 없이 LOADING 처리. 옵션:
  - (a) 시뮬레이션 엔진에 미리 감속 plan 강화 — 175 edge 진입 시점부터 176 의 0.05 stop 점 인지하도록
  - (b) MOVE_TO_LOAD branch 에서 ratio 비교로 backward 차단 + LOADING fallback (정지 안 하고 LOADING 처리)
- **transfer assign 단계 src==dest 회피**: srcStation/destStation 의 edgeIndex 다르도록 강제 reroll. 1차 fix(preloadNextPath src==dest 분기) 가 이미 처리하지만, 의미 있는 transfer 보장 차원에서 유리.
- **loopAroundVehicles 의 stale entry 방어**: transferringVehicles.delete 시 함께 정리 (현재는 자연 cleanup 만)

---

## 10. 변경 이력

- **v0.4.20 (2026-05-05)**: MOVE_TO_LOAD/UNLOAD 에 `currentRatio > station.ratio` guard 추가 → N216 deadlock fix
- **v0.4.21 (2026-05-05, 1차 fix)**: `preloadNextPath` 에 src==dest edge 분기 추가 → 174 케이스 deadlock fix
- **v0.4.21 (2026-05-05, 2차 fix)**: ratio guard 제거, `loopAroundVehicles` Set 으로 명시 추적. MOVE_TO_UNLOAD guard 도 제거 → 64 케이스 (짧은 edge) deadlock fix

---

## 부록: 핵심 파일 위치

- `src/common/vehicle/logic/AutoMgr.ts`: 본 문서의 모든 로직
- `src/common/vehicle/logic/TransferMgr/index.ts`: pathBuffer, edge transition, fallback `nextEdgeIndices[0]`(line 531)
- `src/common/vehicle/logic/Dijkstra.ts`: `findShortestPath`
- `public/railConfig/cop/station.map`: 4349 stations on 149 edges (transfer assign 의 random pool)
- `public/railConfig/cop/edge.map`: edge 길이/방향/연결 토폴로지
- `scripts/log_parser/analyze.py`: 디버깅 도구
