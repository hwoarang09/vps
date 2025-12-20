# LockMgr 개발 계획 (합류점 Lock/Signal 제어)

## 목표
합류점(merge point) 앞에서 차량이 **순서를 지켜 진입**하도록 “신호등”처럼 **진입 허가(LOCK)**를 분배한다.

- 합류점 단위로 대기열을 관리 (edge별 + 통합)
- 정책/전략(Strategy)을 교체 가능하게 설계
- Array Mode 기준으로 `TrafficState`, `StopReason.WAITING_FOR_LOCK`를 활용해 정지/재개를 일관되게 처리

---

## 핵심 데이터 구조(메모리)
맵 로딩 시 1회 생성되는 “합류점 테이블”을 가진다.

```ts
type VehId = number; // (권장) array mode vehicleIndex
type EdgeName = string;
type MergeName = string;

type MergeLockNode = {
  name: MergeName;
  edgeQueues: Record<EdgeName, VehId[]>; // edge별 대기열 (FIFO)
  mergedQueue: VehId[];                 // 합류점 통합 대기열 (FIFO)
  granted: { edge: EdgeName; veh: VehId } | null; // 현재 GREEN(진입 허가) 1대
  strategyState: Record<string, unknown>;          // 라운드로빈 포인터 등
};

type LockTable = Record<MergeName, MergeLockNode>;
```

### 요구사항 매핑
- “모든 합류점 이름을 키로 하는 dict” → `LockTable`
- “합류점 내부에 edge 이름을 키로 하는 dict + 배열” → `edgeQueues[edgeName] = VehId[]`
- “각 합류점마다 통합배열” → `mergedQueue`

---

## 초기화(맵 로딩 시)
### 1) 합류점 탐색 기준(제안)
그래프에서 **incoming edge가 2개 이상인 node**를 merge point로 간주하거나, 이미 존재하는 “merge 타입” 메타데이터가 있으면 그것을 우선한다.

### 2) 초기화 절차
1. `LockMgr.init(graph)` 호출
2. merge point 목록을 만들고, 각 mergeName에 대해 `MergeLockNode` 생성
3. 해당 merge로 들어오는 모든 incoming edgeName을 수집해 `edgeQueues[edgeName] = []`로 초기화
4. `mergedQueue = []`, `granted = null`로 시작

---

## 런타임 이벤트/책임 분리
LockMgr은 “누가 언제 합류점에 들어가도 되는가”만 결정하고, 실제 정지/재개는 기존 상태 적용 로직(`TrafficState`, `StopReason`, `applyVehicleStatus`)로 연결한다.

### 차량이 “합류점 접근”했을 때(대기열 등록)
차량이 합류점 앞의 일정 구간(예: `lockApproachRatio`, 또는 거리 기반)으로 들어오면:

```ts
LockMgr.onApproach(vehId, mergeName, incomingEdgeName);
```

권장 규칙:
- **중복 enqueue 방지**: `vehId`가 이미 어떤 queue에 존재하면 무시
- `edgeQueues[incomingEdgeName]`와 `mergedQueue`에 **동일 순서로** enqueue

> 구현 편의상 `vehId -> {mergeName, edgeName, enqueuedAt}` 역인덱스(Map)를 LockMgr 내부에 둬도 좋다.

### 차량이 “진입 허가”를 요청/판단받을 때(신호등 상태)
매 프레임 또는 특정 타이밍에 아래 중 하나 형태로 사용:

1) Pull 방식: 차량이 스스로 질문
```ts
const canEnter = LockMgr.canEnter(vehId, mergeName, incomingEdgeName);
```

2) Push 방식: LockMgr이 합류점별로 grant(녹색) 대상 갱신
```ts
LockMgr.tick(); // 전략에 따라 각 mergeNode.granted 갱신
```

정지/재개 연결(권장):
- `canEnter=false`이면
  - `TrafficState = WAITING`
  - `STOP_REASON |= WAITING_FOR_LOCK`
  - `applyVehicleStatus(..., canProceed=false)`
- `canEnter=true`이면
  - `TrafficState = ACQUIRED` (또는 FREE)
  - `STOP_REASON`에서 `WAITING_FOR_LOCK` bit 제거
  - `applyVehicleStatus(..., canProceed=true)`

### 차량이 합류점을 “통과/해제”했을 때(대기열 pop & 다음 grant)
합류점을 실제로 지나가면(merge를 구성하는 특정 edge로 진입했거나, merge node를 통과했을 때):

```ts
LockMgr.onPass(vehId, mergeName);
```

권장 동작:
- 해당 mergeNode의 `granted`가 `(vehId)`면 해제
- `edgeQueues[edge]`와 `mergedQueue`에서 `vehId` 제거(pop이 이상적이지만, 예외 상황 대비해 remove도 준비)
- 다음 차량을 선택하도록 `tick()` 또는 내부에서 즉시 재-grant

---

## 전략(Strategy) 설계
전략별로 “다음에 누구에게 GREEN을 줄지”만 바뀌도록 함수를 분리한다.

### 공통 인터페이스(제안)
```ts
type Grant = { edge: EdgeName; veh: VehId } | null;

type LockStrategy = (node: MergeLockNode) => Grant;
```

### 전략 후보(우선순위 높은 것부터)
1) `fifoMerged` (통합큐 기준 완전 FIFO)
- `mergedQueue[0]`가 속한 edge의 `edgeQueues[edge][0]`와 일치하면 grant
- 불일치(중간 이탈/재라우팅 등) 시 정합성 복구(remove) 후 재평가

2) `roundRobinEdges` (edge별 공정)
- edge 순서를 돌며 non-empty인 edge의 head에게 grant
- `strategyState.rrIndex` 같은 포인터 필요

3) `priorityEdges` (고정 우선순위)
- 설정된 priority list를 먼저 검사, 그 다음 나머지

4) `weightedFair` (가중치/혼잡도 기반)
- `weight[edge]`, `queueLen`, `waitingTime` 등을 점수화하여 grant

> 첫 구현은 `fifoMerged` 또는 `roundRobinEdges`가 단순하고 디버깅이 쉽다.

---

## 설정(Strategy 선택 + 파라미터)
설정에서 전략명과 파라미터를 선택하도록 한다.

예시(형식은 프로젝트의 config 패턴에 맞춰 결정):
```json
{
  "lockMgr": {
    "strategy": "roundRobinEdges",
    "approachRatio": 0.8,
    "minGreenMs": 0,
    "clearanceMs": 0,
    "priority": ["E0001", "E0002"],
    "weights": { "E0001": 2, "E0002": 1 }
  }
}
```

파라미터 의미(권장):
- `approachRatio`: 이 ratio 이상이면 onApproach 처리(대기열 등록)
- `minGreenMs`: GREEN을 최소 유지(진동 방지)
- `clearanceMs`: 차량 통과 후 다음 GREEN까지 지연(안전 간격)

---

## 예외/정합성(필수)
- **차량이 다른 경로로 빠짐**: queued 상태에서 edge가 바뀌면 기존 merge queue에서 제거 필요
- **차량 삭제/리셋**: despawn 시 모든 queue에서 제거
- **중복 등록 방지**: onApproach가 여러 번 호출돼도 queue가 불어나지 않게
- **통합큐/edge큐 불일치 복구**: head mismatch가 발생하면 “가장 보수적으로” 정리(remove) 후 재선정

---

## 개발 단계(추천 순서)
1. `LockMgr` 스켈레톤 + `LockTable` 초기화(맵 로딩 훅 연결)
2. `onApproach`, `onPass`로 queue 정합성 확보(중복/삭제 포함)
3. 기본 전략 1개 구현(`fifoMerged` 또는 `roundRobinEdges`)
4. 차량 상태 연동(`TrafficState`, `StopReason.WAITING_FOR_LOCK`, `applyVehicleStatus`)
5. 전략 플러그인 구조 + 설정 로딩/선택

