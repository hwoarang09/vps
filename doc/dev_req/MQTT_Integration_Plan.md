# MQTT Integration Plan for Manual Control

브라우저(React) 환경 특성상 TCP 소켓이 아닌 **WebSocket**을 사용해야 하므로, Broker 설정 시 이 부분이 핵심입니다.

---

## 0. Topic Format

토픽 형식: `{PROJECT}/{RECEIVER}/{SENDER}/{SERVICE}`

| 위치 | 설명 | 예시 |
|------|------|------|
| PROJECT | 프로젝트 이름 | VPS |
| RECEIVER | 받는 놈 | transferMgr |
| SENDER | 보내는 놈 | UI, Backend |
| SERVICE | 서비스 이름 | MOVE, STOP, TRANSFER |

예시: `VPS/transferMgr/UI/MOVE`

---

## 1. React Configuration

### 1.1 Config JSON (`public/config/mqttConfig.json`)

```json
{
  "MQTT_BROKER_URL": "ws://localhost:9003",
  "SUBSCRIBE_TOPICS": [
    "VPS/transferMgr/+/+"
  ]
}
```

### 1.2 Topic Constants (`src/config/mqttConfig.ts`)

서비스 타입은 상수로 관리:

```typescript
export const TOPICS = {
  MOVE: "MOVE",
  TRANSFER: "TRANSFER",
  STOP: "STOP",
  STATUS: "STATUS",
} as const;
```

---

## 2. UI Implementation

### 2.1 Main Menu Integration (Level 1)

* **위치:** `src/components/react/menu/data/MenuLevel1Config.tsx`
* **아이콘:** `Antenna` (lucide-react)
* **동작:** 클릭 시 `menuStore`의 `activeMainMenu`를 `MQTT`로 변경

### 2.2 Connection Panel (Right Panel)

* **컴포넌트:** `src/components/react/menu/panels/MqttControlPanel.tsx`
* **기능:**
  * Broker URL 입력 필드
  * Connect/Disconnect 토글 버튼
  * 구독 토픽 목록 표시
  * 로그 표시 영역

### 2.3 HUD Status Indicator

* **위치:** 화면 좌측 상단
* **컴포넌트:** `src/components/react/system/MqttStatusIndicator.tsx`
* **기능:** 연결 상태 표시 (초록/빨강)

---

## 3. Message Handler (`src/store/system/mqtt/messageHandler.ts`)

토픽 파싱 후 서비스별 라우팅:

```typescript
import { TOPICS } from "@/config/mqttConfig";

// Topic parsing: VPS/transferMgr/{sender}/{service}
switch (service) {
  case TOPICS.MOVE:
    handleMoveCommand(sender, message);
    break;
  case TOPICS.STOP:
    handleStopCommand(sender, message);
    break;
  case TOPICS.TRANSFER:
    handleTransferCommand(sender, message);
    break;
  case TOPICS.STATUS:
    handleStatus(sender, message);
    break;
}
```

---

## 4. Implementation Status

### Phase 1: Config ✅
* [x] `public/config/mqttConfig.json` - 포트 9003
* [x] `src/config/mqttConfig.ts` - TOPICS 상수 정의

### Phase 2: Store ✅
* [x] `src/store/system/mqttStore.ts` - connect, disconnect 액션
* [x] `src/store/system/mqtt/messageHandler.ts` - 토픽 파싱 및 라우팅

### Phase 3: UI ✅
* [x] MenuLevel1에 MQTT (Antenna) 아이콘 추가
* [x] `MqttControlPanel` 컴포넌트
* [x] `MqttStatusIndicator` 위젯

### Phase 4: Testing
* [ ] MQTT Explorer로 `VPS/transferMgr/UI/MOVE` 토픽 테스트
* [ ] 콘솔에서 메시지 수신 확인