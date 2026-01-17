

# 📄 Lock 관리 고도화 개발 계획 (Configurable Version)

## 1. 개요 (Overview)
기존 **FIFO(선입선출)** 방식을 유지하면서, 새로운 효율화 정책들을 **옵션(Config)**으로 추가하여 성능을 비교/검증할 수 있도록 한다.

* **Phase 1 (이번 목표):** 전역 설정(`simulationConfig`)을 통해 정책을 변경하고 동작성을 검증한다.
* **Phase 2 (추후 목표):** 검증된 정책을 FAB(구역)별, 또는 노드별로 다르게 적용할 수 있도록 확장한다.

---

## 2. 설정(Config) 구조 설계

`src/config/simulationConfig.ts`에 Lock 관련 설정을 추가하여 두 가지 측면(요청 시점, 승인 전략)을 각각 제어할 수 있게 한다.

```typescript
// [설계안] SimulationConfigFile 인터페이스 확장

interface SimulationConfigFile {
  // ... 기존 설정
  lock: {
    /**
     * Lock 요청 시점 정책
     * - 'IMMEDIATE': 진입 즉시 요청 (기존 방식)
     * - 'DISTANCE': 합류점까지 남은 거리가 threshold 이하일 때 요청
     */
    requestMode: 'IMMEDIATE' | 'DISTANCE';
    
    /**
     * Lock 승인 우선순위 전략
     * - 'FIFO': 먼저 요청한 순서대로 승인 (기존 방식)
     * - 'BATCH': 같은 방향 차량을 묶어서 연속 승인 (신규 방식)
     */
    grantStrategy: 'FIFO' | 'BATCH';

    /** requestMode가 'DISTANCE'일 때의 거리 임계값 (미터) */
    requestThreshold: number; // 예: 10.0
    
    /** grantStrategy가 'BATCH'일 때 최대 연속 통과 차량 수 */
    maxBatchSize: number; // 예: 5
  };
}

```

---

## 3. 구현 상세 1: 요청 시점 제어 (MovementUpdate)

`MovementUpdate.ts`에서 설정을 읽어 조건부로 Lock을 요청한다.

### 변경 로직

* 기존: `if (TrafficState.FREE) -> requestLock()`
* 변경: `config.lock.requestMode` 확인 후 분기 처리

```typescript
// [Pseudo Code] movementUpdate.ts 내부

// 설정값 가져오기 (성능을 위해 루프 밖에서 참조 권장)
const { requestMode, requestThreshold } = ctx.config.lock;

function processMergeLogicInline(...) {
  // ...
  if (currentTrafficState === TrafficState.FREE) {
    let shouldRequest = true; // 기본값: IMMEDIATE

    if (requestMode === 'DISTANCE') {
      // 직선 구간이고, 충분히 긴 경우에만 거리 체크
      if (currentEdge.vos_rail_type === EdgeType.LINEAR) {
         const distToNode = currentEdge.distance * (1 - currentRatio);
         // 남은 거리가 임계값보다 크면 아직 요청하지 않음
         if (distToNode > requestThreshold) {
           shouldRequest = false;
         }
      }
    }

    if (shouldRequest) {
      lockMgr.requestLock(currentEdge.to_node, currentEdge.edge_name, vehId);
    }
  }
  // ...
}

```

---

## 4. 구현 상세 2: 승인 전략 제어 (LockMgr)

`LockMgr.ts`에 여러 전략을 함수로 정의해두고, 초기화 시점이나 설정 변경 시점에 `currentStrategy`를 교체한다.

### 전략 함수 분리

1. `FIFO_Strategy` (기존): `requestTime` 순 정렬
2. `Batch_Strategy` (신규): `lastGrantedEdge` 우선권 부여 + `consecutiveCount` 체크

### LockMgr 수정

```typescript
// [설계안] LockMgr.ts

export class LockMgr {
  private currentStrategy: MergeStrategy;

  constructor() {
    // 기본값은 FIFO (안전장치)
    this.currentStrategy = FIFO_Strategy;
  }

  // 설정을 받아 전략을 교체하는 메서드
  updateConfig(config: LockConfig) {
    if (config.grantStrategy === 'BATCH') {
      this.currentStrategy = createBatchStrategy(config.maxBatchSize);
      console.log("[LockMgr] Strategy switched to BATCH");
    } else {
      this.currentStrategy = FIFO_Strategy;
      console.log("[LockMgr] Strategy switched to FIFO");
    }
  }

  // ... tryGrant에서 this.currentStrategy(node) 호출
}

```

---

## 5. 단계별 검증 계획 (Validation Plan)

한 번에 하나씩 켜보며 로그나 시각화로 동작을 확인한다.

| 테스트 케이스 | Request Mode | Grant Strategy | 기대 동작 (검증 포인트) |
| --- | --- | --- | --- |
| **Case 1 (Baseline)** | `IMMEDIATE` | `FIFO` | 기존과 동일하게 동작해야 함. (회귀 테스트) |
| **Case 2 (Smart Request)** | `DISTANCE` | `FIFO` | 긴 직선에서 차량이 진입해도 바로 'Waiting' 상태가 되지 않고, 교차로 근처에 갔을 때 'Waiting'으로 변하는지 확인. |
| **Case 3 (Batching)** | `IMMEDIATE` | `BATCH` | 교차로에 양방향 대기열이 있을 때, 한 방향이 5대씩 우르르 지나가는지 확인. (지연시간 감소 효과 확인) |
| **Case 4 (Full Optimization)** | `DISTANCE` | `BATCH` | 두 기능이 모두 켜진 상태에서의 최종 성능 측정. |

---

## 6. 결론 및 다음 단계

1. 이 계획대로 **Config 기반의 분기 로직**을 먼저 구현한다.
2. `SimulationConfig.json`을 수정해가며 위 4가지 케이스를 테스트한다.
3. 성능 개선이 확인되면, 그때 `FabContext` 등을 통해 **FAB별로 다른 Config를 주입하는 구조**로 리팩토링한다.

```

```