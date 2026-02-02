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
| `/visualization` | `.ai-agents/visualization.md` | Visualization 작업 |

-   커맨드 파일 위치: `.claude/commands/`
-   에이전트 설정 파일 위치: `.ai-agents/`
