# VPS (Virtual Physics Simulator) Project Context

## 1. Project Overview
- **Goal**: High-performance AMHS (Automated Material Handling System) simulator capable of handling 100k+ vehicles in real-time.
- **Key Tech**: React (UI), Three.js (Rendering), Web Workers (Simulation Logic), SharedArrayBuffer (Data Exchange).
- **Current Status**: Refactoring complete. Moved simulation logic from Main Thread to Web Workers.

## 2. Core Architecture (CRITICAL)
The project strictly separates **Rendering** (Main Thread) and **Simulation** (Worker Thread).

### A. Thread Responsibilities
1.  **Main Thread (React + Three.js)**
    -   **Role**: ONLY Rendering and UI interaction.
    -   **Constraint**: NEVER performs physics calculations, collision checks, or pathfinding.
    -   **Data Access**: Reads vehicle positions from `SharedArrayBuffer` via `Float32Array` views.
    -   **Files**: `src/components/three/**`, `src/store/ui/**`.

2.  **Worker Thread (Simulation Engine)**
    -   **Role**: Physics, movement, collision detection, pathfinding (Dijkstra), lock management.
    -   **Constraint**: NO access to DOM, `window`, or Three.js scene objects.
    -   **Data Access**: Writes calculated positions/states to `SharedArrayBuffer`.
    -   **Files**: `src/shmSimulator/**` (Core Logic), `src/common/vehicle/logic/**`.

### B. Data Communication Strategy
-   **DO NOT** use `postMessage` for high-frequency data (e.g., vehicle positions).
-   **MUST USE** `SharedArrayBuffer` and `Atomics`.
-   **Pattern**:
    -   Shared memory is pre-allocated (See `src/shmSimulator/MemoryLayoutManager.ts`).
    -   Worker updates the buffer array indices directly.
    -   Main Thread's `useFrame` loop reads directly from these buffer indices to update Three.js `InstancedMesh`.

## 3. Directory Structure & Key Components
-   **`/src/shmSimulator/`**: **(CORE)** The simulation engine running in the worker.
    -   `core/SimulationEngine.ts`: The main loop of the worker.
    -   `managers/`: Logic managers (Routing, Dispatch, Lock).
-   **`/src/components/three/entities/`**: Three.js rendering components.
    -   `vehicle/vehicleSharedMode/`: Renders vehicles by reading shared memory.
-   **`/src/common/`**: Shared utilities and constants (accessible by both threads).
-   **`/doc/`**: **WARNING** - Contains some legacy documentation. If `CLAUDE.md` and `doc/` conflict, follow `CLAUDE.md` (Worker-based architecture).

## 4. Coding Standards & Anti-Patterns

### ✅ DOs
-   Use `Int32Array` or `Float32Array` views for all vehicle data.
-   Implement logic in `src/shmSimulator` if it involves vehicle movement or state change.
-   Use `Atomics.store/load` or `Atomics.compareExchange` for synchronization flags.
-   Run `eslint` regularly.

### ❌ DON'Ts (Hard Constraints)
-   **Anti-Pattern**: Using `React.useState` or Redux/Zustand for 60FPS vehicle data (Causes re-render hell).
-   **Anti-Pattern**: Importing `Three.js` inside `shmSimulator` (Worker cannot use Three.js types).
-   **Anti-Pattern**: Copying large arrays between threads via `postMessage`.

## 5. Key Algorithms
-   **Pathfinding**: Dijkstra (Node-based). Edge costs are dynamic (BPR function).
-   **Collision**: Custom logic checking `currentEdge` and `distance` on the rail. NOT using physics engines like Cannon.js/Rapier (except for specific test modes).
-   **Logging**: High-frequency logs are buffered in Worker and flushed to OPFS or Main Thread periodically.

## 6. Git Workflow
-   **mypush**: 커밋과 푸시를 한번에 수행하는 스크립트
    ```bash
    /home/vosui/vosui/scripts/mypush.sh "커밋 메시지"
    ```
    -   자동으로 버전 번호 증가 (package.json)
    -   커밋 메시지 앞에 버전 정보 추가
    -   origin/main으로 푸시

## 7. Slash Commands (에이전트 역할 전환)
세션 시작 시 특정 역할로 전환하려면 슬래시 커맨드를 사용합니다.

| 명령어 | 참조 파일 | 설명 |
|--------|-----------|------|
| `/my-agents` | - | 사용 가능한 에이전트 목록 보기 |
| `/react-agents` | `.ai-agents/react_agents.md` | React UI 작업 |
| `/lock-agents` | `.ai-agents/lock_agents.md` | Lock 시스템 작업 |
| `/log-agents` | `.ai-agents/log_agents.md` | Log 시스템 작업 |
| `/sonar-agents` | `.ai-agents/sonar_agents.md` | Sonar 시스템 작업 |
| `/multi-fab` | `.ai-agents/multi_fab.md` | Multi-fab 작업 |
| `/sensor-collision` | `.ai-agents/sensor_collision.md` | Sensor collision 작업 |
| `/shm-simulator` | `.ai-agents/shmSimulator_agents.md` | ShmSimulator 작업 |
| `/threejs-agents` | `.ai-agents/threejs_agents.md` | Three.js 렌더링 작업 |
| `/ml-routing-agents` | `.ai-agents/ml_routing_agents.md` | ML 기반 edge cost 예측 라우팅 프로젝트 |
| `/transfer-agents` | `.ai-agents/transfer_agents.md` | Transfer 시스템 작업 |
| `/visualization` | `.ai-agents/visualization.md` | Visualization 작업 |

-   커맨드 파일 위치: `.claude/commands/`
-   에이전트 설정 파일 위치: `.ai-agents/`

## 8. Working Principles (Karpathy-Inspired)
출처: https://github.com/forrestchang/andrej-karpathy-skills

### Think Before Coding
**가정하지 마라. 혼란을 숨기지 마라. 트레이드오프를 드러내라.**

구현 전에:
- 가정을 명시적으로 진술. 불확실하면 질문.
- 해석이 여러 개 가능하면 모두 제시 — 혼자 골라잡지 말 것.
- 더 단순한 접근이 있으면 말할 것. 필요하면 사용자 의견에 푸시백.
- 모호하면 멈출 것. 무엇이 헷갈리는지 이름 붙이고 질문.

### Goal-Driven Execution
**성공 기준을 먼저 정의. 검증될 때까지 루프.**

작업을 검증 가능한 목표로 변환:
- "validation 추가" → "잘못된 입력에 대한 테스트 작성 후 통과시키기"
- "버그 수정" → "버그를 재현하는 테스트를 먼저 작성, 그 다음 통과시키기"
- "X 리팩토링" → "리팩토링 전후로 테스트가 모두 통과하는지 확인"

다단계 작업이면 짧은 계획을 진술:
```
1. [단계] → 검증: [체크]
2. [단계] → 검증: [체크]
```

강한 성공 기준이 있으면 독립적으로 루프 가능. 약한 기준 ("작동하게 만들어줘")은 매번 추가 질문이 필요.
