# Merge Pre-Brake 구현 계획

## 발견 배경

`fab_1_0` v=12 케이스 분석 중 발견.

- `cfg waiting_offset = 2409mm` (E0061)
- WAIT CP는 정확히 ratio 0.7815 (= N0060에서 2409mm 전)에 박힘
- **그런데 차량은 ratio 0.819 (= N0060에서 2029mm 전)에서 정지**
- overshoot ≈ 380mm

## 원인

`mergeBraking.ts`가 stub. 합류점 사전 감속 로직 없음.

```ts
// 현재 (stub)
export function checkMergePreBraking(_params): MergeBrakeCheckResult {
  return { shouldBrake: false, deceleration: 0, distanceToMerge: Infinity };
}
```

→ **차량은 lock 없는 merge로 풀스피드(4 m/s)로 돌진** → WAIT CP 도달 시점에 velocity 강제 0.

Frame 순서 (`simulation-step.ts:108-179`):
```
1. checkCollisions       (sensor stop만 처리)
2. lockMgr.updateAll     (CP 도달 시 velocity = 0)
3. updateMovement         (이전 vel × dt 진행)
```

Lock check는 매 frame 발동하지만, **각 frame이 진행하는 거리** = `vel × dt`. dt가 maxDelta(100ms)에 cap되면 최대 0.4m 이동. WAIT CP 도달 frame의 movement가 이미 발생한 상태라 그만큼 overshoot.

## 영향

- cfg에 `waiting_offset = 2409mm`로 안전 거리 잡았는데 실제론 380mm 잠식.
- 유효 안전거리 = 2409 - 380 = 2029mm. body 1500 + 곡선 sweep 909mm 합치면 2409mm 필요한데 500mm 부족 → sensor 충돌 발생.

## 목표

LOCK_WAIT CP를 본인이 holder 아닌 채 다가가는 차량은 **사전 감속** → CP 도달 시 velocity ≈ 0 → overshoot ≈ 0.

## 설계

### 트리거 조건 (모두 만족 시 brake)

1. `CURRENT_CP_FLAGS`에 `LOCK_WAIT` 비트.
2. **본인이 holder 아님** (holder면 그대로 진행).
3. WAIT CP까지 잔여 거리 `distToWait` ≤ 정지 거리 `v² / (2a)`.

### Brake 안 하는 케이스

- holder = 본인 → 통과.
- DZ gate 처리 차량 (deadlockZoneMerges) → gate가 별도 stop.
- 이미 cpRatio 통과 (overshoot 발생) → 이미 늦음.
- `LOCK_WAIT` flag 없음 → REQ만 있거나 PREP만 있거나, 정지 의무 없음.

### `distToWait` 계산

CURRENT_CP는 1개만 보유. cpEdge가 currentEdge일 수도, 아닐 수도.

```ts
if (currentEdgeIdx === cpEdgeIdx) {
  distToWait = (cpRatio - currentRatio) * currentEdge.distance;
} else {
  // multi-edge: NEXT_EDGE_0~4 traversal
  distToWait = (1 - currentRatio) * currentEdge.distance;
  for (i in NEXT_EDGE_0..NEXT_EDGE_4) {
    if (NEXT_EDGE[i] === cpEdgeIdx) {
      distToWait += cpRatio * cpEdge.distance;
      break;
    }
    distToWait += NEXT_EDGE[i].distance;
  }
  // cpEdge가 NEXT_EDGE_*에 없으면 → 이미 지남 또는 비정상 → no brake
}
if (distToWait <= 0) return noBrake;
```

### 감속도

`config.linearPreBrakeDeceleration` 사용 (이미 곡선 사전 감속에 쓰이는 값).

### Brake 결정

```ts
const decel = Math.abs(config.linearPreBrakeDeceleration);
const stopDist = (currentVelocity * currentVelocity) / (2 * decel);

if (stopDist >= distToWait) {
  // 정지 거리가 잔여 거리보다 크거나 같으면 → 지금부터 감속해야 함
  return {
    shouldBrake: true,
    deceleration: -decel,  // 음수 (감속)
    distanceToMerge: distToWait,
  };
}
return noBrake;
```

`decideFinalAcceleration`이 brake 결과를 받아 final decel 계산 (이미 구현되어 있음 — `vehiclePhysics.ts:117-126`).

## 코드 위치

### 수정
- `src/common/vehicle/movement/mergeBraking.ts` — stub 제거, 실제 로직 구현.

### 변경 없음
- `vehiclePhysics.ts` — 이미 `checkMergePreBraking` 호출 + `decideFinalAcceleration`에서 brake 결과 반영.
- `simulation-step.ts` — 변경 없음.
- builder/cfg — 변경 없음.

### LockMgr 추가 API 필요?
- `lockMgr.isHolder(nodeName, vehId)` 또는 직접 `state.locks` 접근.
- 기존에 `getTable()` 같은 게 있음. holder만 빠르게 조회하는 helper 추가:
  ```ts
  isLockHolder(nodeName: string, vehId: number): boolean {
    return this.state.locks.get(nodeName) === vehId;
  }
  ```

## 구현 step

### Step 1: LockMgr `isLockHolder` helper
`LockMgr/index.ts`에 추가.

### Step 2: `checkMergePreBraking` 본 구현
`mergeBraking.ts` stub 제거. 위 설계대로 작성.

### Step 3: typecheck

### Step 4: 검증
- y_short sim 돌려서 다음 확인:
  1. v=12 같은 케이스 정지 위치가 ratio 0.7815 (= 2.4m before merge)에 정확히 맞는지.
  2. WAIT 이벤트 시점 velocity 거의 0인지.
  3. sensor 충돌 발생 안 함 확인.

## 위험 / 검토 사항

1. **곡선 합류 케이스**:
   - WAIT CP가 곡선 incoming의 ratio 0 (fn).
   - 곡선은 `curveBraking`이 이미 사전 감속. 그 위에 mergeBraking이 추가로 감속하면 너무 강하게 감속.
   - `decideFinalAcceleration`이 두 brake 중 강한 쪽 채택해야. 기존 구현 확인 필요.

2. **변형 DZ 케이스**:
   - WAIT CP가 chain start에 박힘 (예: E0652 ratio 0).
   - 그 다음 짧은 LINEAR + 곡선이 이어짐.
   - mergeBraking이 chain start에서 정지 시키면, 곡선 사전 감속이랑 자연스럽게 연결됨.

3. **Holder 차량은 brake 안 함**:
   - holder는 lock 받은 상태라 통과 가능.
   - 그러나 holder가 다른 lock을 또 wait해야 할 수도 (chained merges).
   - CURRENT_CP는 1개씩 처리되니 다음 lock에 대한 WAIT는 다음 frame에 처리. 한 frame에 한 wait만 처리.

4. **STOP_REASON 처리**:
   - mergeBraking 발동 시 STOP_REASON에 별도 bit? 또는 그냥 deceleration 반환만?
   - 일단 deceleration만 반환. 차량이 정지하면 lock check가 LOCKED bit 설정.

5. **너무 일찍 정지**:
   - distToWait이 정지 거리와 거의 같을 때 from-then 감속 시작.
   - 만약 holder가 release하면 본인이 다음 grant. 이미 정지 거의 다 한 상태에서 갑자기 통과 가능 → 다시 가속.
   - decideFinalAcceleration이 매 frame 다시 평가하므로 자연스럽게 다시 가속됨.

## 참고 파일

- `src/common/vehicle/movement/mergeBraking.ts` (수정 대상)
- `src/common/vehicle/movement/vehiclePhysics.ts:104-126` (호출 + 통합)
- `src/common/vehicle/movement/curveBraking.ts` (참고 — 비슷한 패턴)
- `src/common/vehicle/logic/LockMgr/index.ts` (helper 추가)
- `src/config/worker/simulationConfig.ts` (`linearPreBrakeDeceleration` 값 확인)
