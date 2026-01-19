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

# Code Style Rules

이 프로젝트의 정적 분석 규칙입니다. 코드 작성 시 반드시 준수하세요.

## Re-export 규칙

타입이나 값을 re-export할 때는 반드시 `export...from` 형식을 사용하세요.

```typescript
// Bad
import { Foo } from "./foo";
export { Foo };
export type { Foo };
export default Foo;

// Good
export { Foo } from "./foo";
export type { Foo } from "./foo";
export { Foo as default } from "./foo";
```

## 반복문

### forEach 대신 for...of 사용

`.forEach(…)` 대신 `for…of`를 사용하세요.

```typescript
// Bad
items.forEach((item) => {
  process(item);
});

// Good
for (const item of items) {
  process(item);
}

// index가 필요한 경우
for (const [index, item] of items.entries()) {
  process(index, item);
}
```

## 불필요한 코드 제거

### 빈 constructor 금지

```typescript
// Bad
class Foo {
  constructor() {}
}

// Good
class Foo {
  // constructor 생략
}
```

## 에러 처리

### Object stringification 금지

ErrorEvent나 Error 객체를 문자열로 변환할 때 `String()`을 사용하지 마세요.

```typescript
// Bad
worker.onerror = (error) => {
  callback(String(error)); // '[object Object]' 출력
};

// Good
worker.onerror = (error) => {
  callback(error.message);
};
```
