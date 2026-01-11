# VPS (Vehicle Path Simulation) System

## 시스템 개요

VPS는 공유 메모리(SharedArrayBuffer) 기반의 대규모 차량 시뮬레이션 시스템입니다.
- **웹 워커(Web Worker)** 멀티스레드로 시뮬레이션 실행
- **Three.js**로 3D 렌더링
- 수십만 대 차량 실시간 처리

## 메모리 모드

시스템은 3가지 메모리 모드를 지원합니다:

| 모드 | 용도 | 상태 | 비고 |
|------|------|------|------|
| **shmMode** | 프로덕션 | ✅ 주 사용 | SharedArrayBuffer + Worker 기반 |
| arrayMode | 개발/테스트 | 테스트용 | JavaScript 배열 기반 |
| rapierMode | 실험 | 실험용 | Rapier 물리엔진 기반 (미완성) |

**현재 주 사용 모드**: `shmMode`

## 주요 모듈

```
src/
├── shmSimulator/          # 시뮬레이션 엔진 (Worker 내부, React 독립적)
├── common/vehicle/        # 차량 로직 (메모리 모드 독립적)
├── components/three/      # Three.js 렌더링 (Main Thread)
├── store/                 # 상태 관리 (Zustand)
│   ├── vehicle/           # 모드별 구현 (arrayMode, shmMode, rapierMode)
│   ├── map/               # 맵 데이터 (edges, nodes, stations)
│   └── system/            # MQTT, 시스템 설정
└── utils/fab/             # FAB 시스템 (맵 복제)
```

## 핵심 개념

### FAB 시스템 (평행우주 복제)
- **동일한 맵 구조**를 격자 형태로 복제 (2×2, 3×3 등)
- 각 FAB은 **물리적으로 동일한 맵**이지만 **이름과 위치만 offset** (edge0001 → edge1001)
- 수십만 대를 작은 맵 1개에 몰아넣는 대신, **여러 FAB에 분산**
- 각 FAB은 물리적으로는 동일한 위치이지만, **평행우주처럼 독립적으로 시뮬레이션** (서로 간섭 없음)
- 모든 FAB이 동일한 맵을 갖기 때문에 메모리 절약

### SharedArrayBuffer
- Main Thread와 Worker 간 메모리 공유
- 각 차량은 22개 float 값으로 표현
- Worker가 쓰기, Main Thread가 읽기

### Worker 기반 시뮬레이션
- 멀티 워커로 여러 FAB 병렬 처리
- 60 FPS 내부 루프
- React/Zustand와 완전 분리

## 데이터 흐름

```
1. 초기화
   React → MultiWorkerController → Worker → SimulationEngine → FabContext

2. 시뮬레이션
   Worker 60FPS Loop → SharedArrayBuffer 업데이트

3. 렌더링
   Main Thread requestAnimationFrame → SharedArrayBuffer 읽기 → Three.js

4. 명령 (MQTT)
   MQTT → mqttStore → useShmSimulatorStore → MultiWorkerController
   → Worker → SimulationEngine → FabContext → TransferMgr
```

## 주요 정책

### 코드 작성 규칙
- **forEach 금지**: `for...of` 사용 (CLAUDE.md)
- **에러 처리**: `String(error)` 대신 `error.message` 사용
- **Worker 내 React 금지**: Worker에서 React Hooks, Zustand 접근 금지

### 메모리 정책
- 각 Worker는 할당된 메모리 영역만 접근
- Atomics 사용하지 않음 (영역 분리로 충분)
- FAB별 독립적인 경로 탐색

## 상세 문서

### 아키텍처
- [MEMORY_LAYOUT.md](./MEMORY_LAYOUT.md) - 메모리 구조 및 Vehicle 데이터 레이아웃
- [FAB_SYSTEM.md](./FAB_SYSTEM.md) - FAB 복제 시스템 상세
- [COMMAND_FLOW.md](./COMMAND_FLOW.md) - 명령 처리 흐름

### 개발 계획
- [dev_req/MULTI_WORKER_ARCHITECTURE.md](./dev_req/MULTI_WORKER_ARCHITECTURE.md) - 멀티 워커 설계
- [dev_req/MULTI_FAB_IMPLEMENTATION.md](./dev_req/MULTI_FAB_IMPLEMENTATION.md) - 멀티 FAB 구현
- [dev_req/shmSimulator_개발계획.md](./dev_req/shmSimulator_개발계획.md) - 시뮬레이터 개발 계획

### 코드 가이드
- [../src/shmSimulator/README.md](../src/shmSimulator/README.md) - 시뮬레이션 엔진 사용법
- [../src/common/vehicle/README.md](../src/common/vehicle/README.md) - 차량 로직 개발 가이드
- [../src/components/three/README.md](../src/components/three/README.md) - 렌더링 시스템 가이드
- [../src/store/vehicle/README.md](../src/store/vehicle/README.md) - 상태 관리 모드별 구현

### 규칙
- [rule/coding_rule.md](./rule/coding_rule.md) - 코딩 규칙
- [../CLAUDE.md](../CLAUDE.md) - 정적 분석 규칙
