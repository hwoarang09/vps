# MQTT 구현 현황 정리

## 1. 토픽 구조

**형식**: `{PROJECT}/{RECEIVER}/{SENDER}/{SERVICE}`

**예시**: `VPS/transferMgr/UI/MOVE`

- **PROJECT**: `VPS` (프로젝트 이름)
- **RECEIVER**: `transferMgr` (수신자)
- **SENDER**: `UI`, `Backend` 등 (발신자)
- **SERVICE**: `MOVE`, `TRANSFER`, `STOP`, `STATUS` (명령 타입)

### 구독 중인 토픽
```typescript
SUBSCRIBE_TOPICS: ["VPS/transferMgr/+/+"]
```
→ `transferMgr`로 오는 모든 메시지를 구독 (sender, service는 와일드카드)

## 2. 메시지 흐름

```
MQTT Broker
  ↓
mqttStore (메시지 수신)
  ↓
messageHandler (토픽 파싱 및 라우팅)
  ↓
useShmSimulatorStore.sendCommand()
  ↓
Worker (SimulationEngine)
  ↓
routingMgr.receiveMessage()
  ↓
dispatchMgr.dispatch()
  ↓
transferMgr.assignCommand(vehId, command)
```

## 3. 현재 페이로드 구조

### 예상 형식
```json
{
  "vehId": 0,
  "command": { ... }
}
```

- **vehId**: 차량 ID (없으면 기본값 0)
- **command**: 실제 명령 내용

### 중요: Fab 정보는 **현재 사용되지 않음**

코드 분석 결과:
- `shmSimulator`와 `common/vehicle` 어디에도 `fab` 관련 로직 없음
- 차량은 **전역적으로 단일 ID 체계** 사용 (fab 구분 없음)
- Edge/Node 데이터는 초기화 시 전체 맵 데이터로 로드되며, fab별로 분리되지 않음

## 4. 결론

**Fab 정보를 페이로드에 포함할 필요 없음**

현재 시스템은:
- 모든 차량이 하나의 통합된 공간에서 동작
- 차량 ID만으로 식별 가능
- Edge/Node는 초기화 시 전체 맵으로 로드됨

만약 **멀티 Fab 지원**이 필요하다면:
1. 차량 ID 체계를 `{fabId}-{localVehId}` 형태로 변경
2. Edge/Node 데이터에 fab 정보 추가
3. 메시지 페이로드에 `fabId` 필드 추가

하지만 **현재는 불필요**합니다.
