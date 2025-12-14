````md
# NextEdge + NextEdgeState 도입 개발 계획 (Array Mode)

## 목표
Array Mode에서 차량이 다음으로 갈 edge를 `vehicleLoop`에서 직접 조회하는 구조를 제거하고,
`vehicleDataArray`에 `NEXT_EDGE`와 `NEXT_EDGE_STATE`를 추가하여:

- `handleTransition`은 **오직 `NEXT_EDGE`로만 전환**
- `NEXT_EDGE`를 채우는 책임은 **TransferMgr**
- 중복 요청/큐 폭발/전환 타이밍 문제를 **상태 머신(EMPTY/PENDING/READY)**로 제어

---

## 핵심 개념
### NextEdgeState 3단계
- `EMPTY (0)` : nextEdge 없음 + 요청도 안 함
- `PENDING (1)` : nextEdge 없음 + 요청은 했음(처리 대기)
- `READY (2)` : nextEdge 할당 완료 (전환 가능)

### 필드 규칙
- `NEXT_EDGE`는 `READY`일 때만 유효
- `EMPTY`/`PENDING`일 때 `NEXT_EDGE = -1` 유지 권장
- Typed array가 `Float32Array`면 읽을 때 항상 정수화 필요 (`|0`)

---

## 데이터 레이아웃 변경 (vehicleDataArray offsets)

### 신규 상수
```ts
export const NextEdgeState = {
  EMPTY: 0,
  PENDING: 1,
  READY: 2,
} as const;
````

### MovementData 수정안 (CURRENT_EDGE 뒤에 2개 추가)

```ts
export const MovementData = {
  X: 0,
  Y: 1,
  Z: 2,
  ROTATION: 3,
  VELOCITY: 4,
  ACCELERATION: 5,
  DECELERATION: 6,
  EDGE_RATIO: 7,
  MOVING_STATUS: 8, // 0=STOPPED, 1=MOVING, 2=PAUSED

  CURRENT_EDGE: 9,      // Edge index
  NEXT_EDGE: 10,        // Edge index (valid only when NEXT_EDGE_STATE==READY, else -1)
  NEXT_EDGE_STATE: 11,  // 0=EMPTY, 1=PENDING, 2=READY

  OFFSET: 12,           // Distance from edge start
} as const;

export const SensorData = {
  PRESET_IDX: 13,
  HIT_ZONE: 14,
} as const;

export const LogicData = {
  TRAFFIC_STATE: 15,
  STOP_REASON: 16,
  JOB_STATE: 17,
} as const;
```

> 주의: 기존 `SensorData`, `LogicData`의 인덱스가 모두 +2 밀림.
> `VEHICLE_DATA_SIZE`/stride 같은 상수도 +2 반영 필요.

---

## 상태 전이(State Transition) 정의

### 초기화

* `NEXT_EDGE = -1`
* `NEXT_EDGE_STATE = EMPTY`

### 요청 트리거 (예: ratio >= 0.5)

* 조건: `NEXT_EDGE_STATE == EMPTY`
* 동작:

  1. `NEXT_EDGE_STATE = PENDING`
  2. TransferMgr queue에 `vehId` enqueue

### TransferMgr 처리 완료

* 조건: queue에서 vehId pop
* 동작:

  1. `NEXT_EDGE = <결정된 edgeIdx>`
  2. `NEXT_EDGE_STATE = READY`

### edge 전환 (handleTransition)

* 조건: `NEXT_EDGE_STATE == READY`

* 동작:

  1. `CURRENT_EDGE = NEXT_EDGE`
  2. `NEXT_EDGE = -1`
  3. `NEXT_EDGE_STATE = EMPTY`
  4. ratio/offset 등 전환 초기화 수행

* READY가 아니면:

  * 정책 결정 필요 (정지/대기/타임아웃/강제 재요청 등)

---

## 구현 변경 범위

### 1) 데이터 구조/상수 변경

* `MovementData`에 `NEXT_EDGE`, `NEXT_EDGE_STATE` 추가
* `SensorData`, `LogicData` 오프셋 업데이트
* 차량 stride(`VEHICLE_DATA_SIZE` 등) +2 업데이트
* 모든 인덱스 하드코딩/가정 코드 전수 점검

### 2) 읽기 유틸 규칙 적용 (정수화)

* 예:

```ts
const currEdge = vehicleDataArray[base + MovementData.CURRENT_EDGE] | 0;
const nextState = vehicleDataArray[base + MovementData.NEXT_EDGE_STATE] | 0;
const nextEdge = vehicleDataArray[base + MovementData.NEXT_EDGE] | 0;
```

### 3) 요청 트리거 헬퍼 추가

* `hasCrossedRequestPoint(vehIdx): boolean`

  * 초기 버전: `EDGE_RATIO >= 0.5`
  * 추후: 남은거리/남은시간 기반으로 확장 가능

### 4) movement update 루프 수정

* per-vehicle update 중:

  * `if (hasCrossedRequestPoint && NEXT_EDGE_STATE==EMPTY) { NEXT_EDGE_STATE=PENDING; enqueue(vehId); }`

### 5) TransferMgr 추가/확장

* 책임: queue 처리 + next edge 결정 + 데이터 배열에 nextEdge 세팅
* queue 구조:

  * 초기 구현: JS array 가능
  * 10k 규모 안정화: ring buffer(Int32Array + head/tail) 권장
* 라우팅 전략(모드):

  * Loop 모드: 기존 `vehicleLoop`를 TransferMgr 내부에서 참조하여 nextEdge 반환
  * Random 모드(추후): 분기점에서 후보 edge 중 랜덤 선택
  * 정책 모드(추후): 혼잡/락/우선순위 기반

### 6) handleTransition 수정

* 기존: transition 시 `vehicleLoop` 직접 조회
* 변경: transition 시 `NEXT_EDGE_STATE==READY`만 허용
* READY 아니면 대기/정지 정책 적용

---

## 단계별 개발 순서 (Plan)

### Step 0: 영향 범위 파악

* `VEHICLE_DATA_SIZE/stride` 정의 위치 확인
* 인덱스 의존 코드(OFFSET=10 같은 가정) 탐색

### Step 1: offsets 업데이트

* `MovementData`에 NEXT_EDGE / NEXT_EDGE_STATE 추가
* Sensor/Logic index 전부 +2 반영
* stride +2 반영

### Step 2: 초기화 루틴 업데이트

* 차량 생성/리셋 시:

  * `NEXT_EDGE=-1`
  * `NEXT_EDGE_STATE=EMPTY`

### Step 3: 요청 트리거 추가

* `hasCrossedRequestPoint()` 구현 (초기 ratio>=0.5)
* movement loop에 요청 로직 삽입 (EMPTY -> PENDING + enqueue)

### Step 4: TransferMgr 구현

* 큐 + 처리 루프
* Loop 모드 전략으로 nextEdge 산출
* 처리 완료 시: (PENDING -> READY + nextEdge set)

### Step 5: handleTransition 전환 방식 변경

* 전환은 nextEdge 기반만 허용
* 전환 후 state reset
* READY가 아니면 정지/대기 정책 구현

### Step 6: 기존 vehicleLoop 직접 조회 제거

* transition 로직에서 vehicleLoop 접근 코드 제거
* 경로 결정은 TransferMgr 한 곳으로 수렴

---

## 테스트 계획

### 기능 테스트

* 1대 차량 + loop 맵:

  * ratio 0.5 통과 시 PENDING으로 바뀌는지
  * TransferMgr이 nextEdge 채워 READY 되는지
  * edge 끝에서 nextEdge로 정상 전환 후 EMPTY로 리셋되는지

### 부하 테스트

* 1만대:

  * 중복 enqueue가 없는지 (PENDING 덕분에)
  * queue 처리량/프레임 유지 확인

### 지연/경계 케이스

* TransferMgr 처리 지연 상황(처리량 제한):

  * edge 끝 도달 전에 READY가 되는지
  * READY가 늦으면 정지/대기 정책이 의도대로 동작하는지

---

## 리스크 & 대응

### Risk 1) 트리거가 늦어서 edge 끝에서 멈춤 발생

* 초기엔 ratio=0.5로 시작하되, 필요 시 더 앞당기거나(0.3),
  “남은거리/남은시간 기반”으로 확장 계획 확보

### Risk 2) offsets 변경으로 인덱스 깨짐

* 인덱스 의존 코드 전수 점검 필수
* stride/offset 상수만 참조하도록 리팩토링 권장

### Risk 3) READY 아닌 상태에서 전환 진입

* 정지/대기 정책 명확화
* 타임아웃/재요청 정책은 추후 추가 가능

---

## Done 정의(완료 기준)

* Array Mode에서 `handleTransition`이 `vehicleLoop`를 직접 참조하지 않는다.
* `NEXT_EDGE_STATE`가 중복 요청을 방지하고, 정상 상태 전이가 동작한다.
* TransferMgr이 Loop 모드 기준으로 `NEXT_EDGE`를 안정적으로 공급한다.
* 1만대 테스트에서 큐 폭발/중복 요청 없이 프레임 안정적으로 유지된다.

```
```
