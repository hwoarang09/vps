3년 차 개발자로서 설계의 핵심인 **관심사 분리(Separation of Concerns)**를 명확히 하는 방향으로 정리했다. 핵심은 **Zustand는 데이터(State)의 창구이지, 로직(Engine)의 실행 주체가 아니다**라는 점이다.

---

# MQTT 기반 이송 제어 아키텍처 설계

## 1. 기본 원칙

* **UI와 로직의 분리:** `Zustand`는 UI 렌더링을 위한 상태 보관소로만 사용한다. 시뮬레이션 엔진 인스턴스를 Store에 직접 넣거나 Store를 통해 엔진 로직을 호출하는 안티패턴을 지양한다.
* **명령 하향 전달:** MQTT 메시지는 시스템의 입력값이다. 입력은 위에서 아래로(Handler -> Engine -> Manager) 흘러야 한다.

---

## 2. 시스템 아키텍처 흐름

### [Case A] 단일 스레드 (Main Thread Engine)

1. **MQTT Client**: 외부 메시지 수신.
2. **Command Handler**: 수신된 JSON 파싱 및 엔진 인스턴스의 메서드 호출.
3. **Simulator Engine**: 대상 `Vehicle` 식별 후 `TransferMgr`에 명령 하달.

### [Case B] 멀티 스레드 (Worker Thread Engine)

1. **Main Thread (MQTT Client)**: 메시지 수신.
2. **PostMessage**: `worker.postMessage({ type: 'MOVE_COMMAND', payload })` 전달.
3. **Worker Thread (Engine)**: 메시지 수신 후 내부 엔진 인스턴스 제어.

---

## 3. 상세 구현 가이드

### 3.1 `TransferMgr` 로직 확장

이송 관리자는 스스로 다음 경로를 계산하는 대신, 외부 명령을 기다리는 상태를 가진다.

```typescript
// transferMgr.ts
export class TransferMgr {
  private mode: 'AUTO' | 'MQTT_CONTROL' = 'AUTO';
  private reservedNextEdge: string | null = null;

  // 다음 Edge 도달 시 호출되는 로직
  public onEdgeEnd() {
    if (this.mode === 'MQTT_CONTROL') {
      if (this.reservedNextEdge) {
        this.moveTo(this.reservedNextEdge);
        this.reservedNextEdge = null; // 명령 소모
      } else {
        this.wait(); // 명령이 올 때까지 정지/대기
      }
    } else {
      this.autoSelectNextEdge(); // 기존 방식(Random/Loop)
    }
  }

  // MQTT 핸들러에 의해 호출될 함수
  public setNextEdge(edgeId: string) {
    this.reservedNextEdge = edgeId;
  }
}

```

### 3.2 엔진 접근 방식 (Dependency Injection)

Zustand 없이 엔진 인스턴스에 접근하는 정석적인 방법이다.

```typescript
// engine.ts
export class SimulatorEngine {
  private vehicles: Map<string, Vehicle> = new Map();

  public dispatchCommand(vehId: string, edgeId: string) {
    const vehicle = this.vehicles.get(vehId);
    if (vehicle) {
      vehicle.transferMgr.setNextEdge(edgeId);
    }
  }
}

// mqttHandler.ts
export function initMqtt(engine: SimulatorEngine) {
  client.on('message', (topic, message) => {
    const { vehId, nextEdgeId } = JSON.parse(message.toString());
    engine.dispatchCommand(vehId, nextEdgeId);
  });
}

```



---
