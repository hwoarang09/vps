# 문서 인덱스

프로젝트 내 모든 문서 링크 모음

---

## 시스템 문서 (doc/)

| 문서 | 설명 |
|------|------|
| [시스템 아키텍처](./SYSTEM_ARCHITECTURE.md) | 전체 시스템 설계 |
| [코딩 규칙](./rule/coding_rule.md) | 코드 작성 규칙 |
| [Lock 정리](./spec/Lock정리.md) | Lock 메커니즘 스펙 |
| [MQTT 명령 전달](./spec/mqtt_명령전달_구현현황.md) | MQTT 통신 구현 현황 |

---

## 시뮬레이션 엔진 (shmSimulator)

| 문서 | 설명 |
|------|------|
| [shmSimulator](../src/shmSimulator/README.md) | SharedArrayBuffer 기반 시뮬레이션 엔진 |
| [shmSimulator/core](../src/shmSimulator/core/README.md) | 엔진 핵심 클래스 (SimulationEngine, FabContext) |

---

## 차량 로직 (common/vehicle)

| 문서 | 설명 |
|------|------|
| [vehicle](../src/common/vehicle/README.md) | 차량 로직 개요 |
| [vehicle/collision](../src/common/vehicle/collision/README.md) | 충돌 감지 로직 |
| [vehicle/logic](../src/common/vehicle/logic/README.md) | 비즈니스 로직 (Lock, Transfer, Dispatch) |
| [vehicle/memory](../src/common/vehicle/memory/README.md) | 메모리 레이아웃 (VehicleDataArray) |
| [vehicle/movement](../src/common/vehicle/movement/README.md) | 이동 로직 (EdgeTransition, Physics) |

---

## 렌더링 (components/three)

| 문서 | 설명 |
|------|------|
| [three](../src/components/three/README.md) | Three.js 렌더링 컴포넌트 |
| [vehicle 렌더링](../src/components/three/entities/vehicle/README.md) | 차량 렌더링 모드 개요 |
| [vehicleArrayMode](../src/components/three/entities/vehicle/vehicleArrayMode/README.md) | InstancedMesh 기반 렌더링 |

---

## 상태 관리 (store)

| 문서 | 설명 |
|------|------|
| [vehicle store](../src/store/vehicle/README.md) | 차량 관련 Zustand store |

---

## 유틸리티

| 문서 | 설명 |
|------|------|
| [logger](../src/logger/README.md) | 로깅 시스템 (EdgeTransitTracker, DevLogger) |
| [VehicleTest](../src/components/test/VehicleTest/README.md) | 테스트 UI 컴포넌트 |

---

## AI 에이전트 문서

코드 수정 시 AI가 참조하는 컨텍스트 문서입니다.

| 문서 | 설명 |
|------|------|
| [react_agents](../.ai-agents/react_agents.md) | React UI, 메뉴, Store |
| [multi_fab](../.ai-agents/multi_fab.md) | Multi-Fab 시스템 |
| [shmSimulator_agents](../.ai-agents/shmSimulator_agents.md) | Worker-Main 통신, 에러 처리 |
| [lock_agents](../.ai-agents/lock_agents.md) | Lock 메커니즘 |
| [sensor_collision](../.ai-agents/sensor_collision.md) | 센서 기반 충돌 감지 |
| [sonar_agents](../.ai-agents/sonar_agents.md) | 소나 시스템 |
| [visualization](../.ai-agents/visualization.md) | 시각화 |

---

## 루트 문서

| 문서 | 설명 |
|------|------|
| [프로젝트 README](../README.md) | 프로젝트 소개 및 빠른 시작 |
| [CLAUDE.md](../CLAUDE.md) | AI 코드 어시스턴트 컨텍스트 |
