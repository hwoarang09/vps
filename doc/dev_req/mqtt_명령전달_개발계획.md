MQTT 명령 제어 시스템 구축을 위한 최종 개발 계획서다. 3년 차 개발자로서 설계의 확장성과 관심사 분리(SoC)를 극대화하는 방향으로 정리했다.

---

# [vps] MQTT 기반 이송 제어 시스템 개발 계획서

## 1. 아키텍처 개요

모든 외부 명령은 `SimulatorEngine`을 단일 창구로 하며, 내부적으로 **할당(Dispatch)**과 **전송(Routing)** 책임을 분리하여 설계한다.

---

## 2. 핵심 컴포넌트별 역할

| 컴포넌트 | 책임 (Responsibility) | 주요 특징 |
| --- | --- | --- |
| **MqttHandler** | 메시지 수신 및 파싱 | 비즈니스 로직 없음. 엔진의 `dispatchCommand`만 호출. |
| **SimulatorEngine** | 전체 오케스트레이션 | 시스템 진입점. `DispatchMgr`와 `RoutingMgr`을 소유. |
| **DispatchMgr** | **차량 할당 (Who)** | `vehId` 미지정 명령 시, 최적의 IDLE 차량 선택 (거리/상태 기반). |
| **RoutingMgr** | **명령 전달 (Where)** | 선택된 `vehId`가 위치한 Worker(또는 로컬)로 명령 전달. |
| **TransferMgr** | **동작 실행 (How)** | `MQTT_CONTROL` 모드 시 명령 대기 및 주입된 경로로 이동. |

---

## 3. 상세 설계 및 흐름

### 3.1 명령 처리 시퀀스

1. **MQTT Message 수신**: `{ "nextEdgeId": "E101", "vehId": null }`
2. **DispatchMgr**: `vehId`가 없으므로 현재 가용 차량 중 가장 가까운 차량(`V1`)을 선정.
3. **RoutingMgr**: `V1`이 관리되고 있는 스레드/워커를 찾아 명령(Payload)을 전달.
4. **TransferMgr**: `V1`의 현재 위치에서 `E101`로의 경로 유효성 검증 후 주행 예약.

### 3.2 핵심 로직 확장 (`TransferMgr`)

```typescript
// transferMgr.ts
export class TransferMgr {
  private mode: 'AUTO' | 'MQTT_CONTROL' = 'AUTO';
  private reservedNextEdge: string | null = null;

  public onEdgeEnd() {
    if (this.mode === 'MQTT_CONTROL') {
      if (this.reservedNextEdge) {
        this.executeMove(this.reservedNextEdge);
        this.reservedNextEdge = null; 
      } else {
        this.status = 'WAITING_FOR_COMMAND'; // 명령 올 때까지 정지
      }
    } else {
      this.executeAutoRoute(); // 기존 Random/Loop
    }
  }
}

```

---

## 4. 개발 단계 (Roadmap)

### 1단계: 기반 구조 및 MQTT 연동

* `SimulatorEngine` 내부에 `DispatchMgr`, `RoutingMgr` 인스턴스 생성.
* Zustand Store 의존성 제거 및 엔진 직접 호출 로직 구현.
* `noUncheckedIndexedAccess` 등 TS 엄격 모드 적용으로 안정성 확보.

### 2단계: Routing 및 Dispatch 로직 구현

* **RoutingMgr**: 현재 단일 워커 환경에 맞춰 단순 호출 로직 작성 (추후 `postMessage` 확장 대비).
* **DispatchMgr**: 최적 차량 선정을 위한 거리 계산 알고리즘(Dijkstra 또는 유클리드 거리) 초안 구현.

### 3단계: TransferMgr 제어 모드 추가

* `MQTT_CONTROL` 모드 상태 머신 구현.
* Edge 도달 시 정지 및 명령 대기 로직 테스트.

### 4단계: 예외 처리 및 검증

* 도착 불가능한 `nextEdgeId` 수신 시 Reject 처리.
* 명령 중복 수신 시 우선순위 정책 적용.

---

## 5. 기술적 주의사항 (3년 차 필수 체크)

1. **관심사 분리**: `RoutingMgr`은 "어떻게 보낼까"만 고민하고, `DispatchMgr`은 "누구에게 줄까"만 고민할 것.
2. **Zustand 오용 금지**: UI 업데이트를 위해서만 `setState`를 호출하고, 엔진 로직은 순수 TS 클래스 내에서 완결할 것.
3. **성능 최적화**: `DispatchMgr`이 매번 모든 차량을 전수 조사하지 않도록, 가용 차량(IDLE) 리스트를 별도로 관리할 것.

---

이 계획서대로 `DispatchMgr`의 **가용 차량 선정 알고리즘(Distance-based)**을 먼저 구체화해볼까, 아니면 **MQTT 메시지 프로토콜(JSON Schema)**부터 정의할까?