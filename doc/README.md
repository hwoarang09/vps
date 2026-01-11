# VPS (Vehicle Path Simulation)

반도체 FAB 내 OHT 차량 대규모 시뮬레이션 시스템

## 데모

| 환경 | URL | 비고 |
|------|-----|------|
| Production | - | |
| Staging | - | |
| Local | http://localhost:5173 | |

## 빠른 시작

```bash
# 설치
pnpm install

# 개발 서버
pnpm dev

# 빌드
pnpm build

# 테스트
pnpm test
```

## 기술 스택

| 분류 | 기술 |
|------|------|
| Frontend | React, TypeScript, Vite |
| 3D 렌더링 | Three.js, React Three Fiber |
| 상태 관리 | Zustand |
| 시뮬레이션 | Web Worker, SharedArrayBuffer |
| 통신 | MQTT (mqtt.js) |

## 환경 변수

```bash
# .env.local
VITE_MQTT_URL=ws://localhost:9001      # MQTT 브로커 주소
VITE_MQTT_USERNAME=                     # MQTT 인증 (선택)
VITE_MQTT_PASSWORD=                     # MQTT 인증 (선택)
```

## 프로젝트 구조

```
src/
├── shmSimulator/          # 시뮬레이션 엔진 (Worker)
├── common/vehicle/        # 차량 로직 (공유)
├── components/three/      # 3D 렌더링 (Main Thread)
├── store/                 # 상태 관리 (Zustand)
└── utils/                 # 유틸리티
```

## 문서

### 아키텍처
- [시스템 아키텍처](./SYSTEM_ARCHITECTURE.md) - 전체 시스템 설계

### 개발 가이드
- [코딩 규칙](./rule/coding_rule.md)
- [정적 분석 규칙](../CLAUDE.md)

### 개발 계획
- [멀티 워커 설계](./dev_req/MULTI_WORKER_ARCHITECTURE.md)
- [멀티 FAB 구현](./dev_req/MULTI_FAB_IMPLEMENTATION.md)

## 라이선스

MIT
