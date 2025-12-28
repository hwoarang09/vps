제안하신 내용을 완벽하게 반영하여, **"React/Zustand 의존성을 0으로 만들고, 독립적인 게임 엔진처럼 동작하는 Shared Memory Simulator"** 개발 계획을 작성했습니다.

마지막에 **"한 번에 옮길지 vs 점진적으로 할지"**에 대한 전략적 조언도 포함했습니다.

---

# 🏗️ Independent Shared Memory Simulator Development Plan

## 1. 아키텍처 철학 (Architecture Philosophy)

이 프로젝트의 핵심은 **"완벽한 격리(Complete Isolation)"**와 **"단방향 데이터 흐름(One-Way Data Flow)"**이다.

* **Headless Game Engine**: `shmSimulator`는 화면(DOM/Canvas)이 존재하지 않는 리눅스 서버에서 돌아가는 프로그램처럼 작성한다. React, Hooks, Zustand Store는 이 영역에 존재하지 않는다.
* **Snapshot Injection**: React(Main Thread)는 맵 파일과 설정을 로딩한 뒤, 그 **스냅샷(Snapshot)**을 직렬화(JSON)하여 시뮬레이터에 던져주고 잊어버린다.
* **State Internalization**: 기존에 Zustand 전역 스토어에 있던 모든 데이터는 `SimulationEngine` 클래스의 **멤버 변수(Member Variables)**로 변환된다.

---

## 2. 폴더 및 파일 구조 (Directory Structure)

`src` 최상위에 독립적인 폴더를 구성하여 기존 컴포넌트와 섞이지 않도록 한다.

```text
src/
├── shmSimulator/                  # [NEW] 독립 시뮬레이션 엔진 패키지
│   ├── index.ts                   # (Main Thread용) 워커 생성 및 제어기 래퍼
│   ├── worker.entry.ts            # (Worker Thread) 워커 진입점
│   ├── core/
│   │   ├── SimulationEngine.ts    # ★ 핵심: 모든 상태와 로직을 가진 신(God) 클래스
│   │   └── EngineContext.ts       # 내부에서 사용하는 타입 정의
│   ├── memory/
│   │   └── VehicleDataArray.ts    # (이동) 기존 파일 복사/수정하여 멤버로 사용
│   ├── systems/                   # 로직 모듈 (기존 로직 재사용/래핑)
│   │   ├── MovementSystem.ts
│   │   ├── CollisionSystem.ts
│   │   └── TrafficSystem.ts       # (LockMgr 포함)
│   └── utils/                     # 맵 파싱 등 유틸리티
│
├── components/three/entities/vehicle/vehicleSharedMode/
│   └── VehicleSharedMode.tsx      # (React) 시뮬레이터 인스턴스 생성 및 렌더링

```

---

## 3. 핵심 클래스 설계 (Class Design)

### 3.1 `SimulationEngine` (In Worker)

이 클래스는 기존 `VehicleArrayMode` 컴포넌트와 `Store`들이 하던 일을 모두 흡수한다.

```typescript
// src/shmSimulator/core/SimulationEngine.ts

import { VehicleDataArray } from "../memory/VehicleDataArray";
import { LockMgr } from "../systems/TrafficSystem";
// ... 기타 로직 import

export class SimulationEngine {
  // =========================================================
  // 1. Memory & State (Zustand 대체)
  // =========================================================
  // 차량 데이터 (공유 메모리 래퍼)
  private vehicleData: VehicleDataArray;
  
  // 맵 데이터 (Read-only Reference)
  private edges: any[] = [];
  private nodes: any[] = [];
  
  // 검색용 룩업 테이블 (내부에서 생성)
  private edgeMap = new Map<string, number>(); // Name -> Index
  private vehicleLoops = new Map<number, any>(); // Path Calculation Object

  // 설정값
  private config: SimulationConfig;

  // =========================================================
  // 2. Logic Systems (Singleton 대체)
  // =========================================================
  // 각 인스턴스는 이 엔진 안에서만 살아있음
  private lockMgr: LockMgr; 
  private transferMgr: TransferMgr;

  // =========================================================
  // 3. Runtime State
  // =========================================================
  private isRunning = false;
  private lastTime = 0;

  constructor() {
    this.vehicleData = new VehicleDataArray(); 
    this.lockMgr = new LockMgr(); // 독자적인 Traffic Controller 생성
    this.transferMgr = new TransferMgr();
  }

  /**
   * 초기화: 메인 스레드에서 받은 '세상'을 로드함
   * 맵이 바뀌면 이 함수가 다시 호출되거나, 엔진을 파괴하고 새로 만듦
   */
  init(payload: InitPayload) {
    // 1. 메모리 연결
    this.vehicleData.setBuffer(payload.sharedBuffer);
    
    // 2. 맵 데이터 수신
    this.edges = payload.edges;
    this.nodes = payload.nodes;
    this.config = payload.config;

    // 3. 내부 자료구조 구축 (Rebuild)
    this.rebuildInternalMaps();
    
    // 4. 로직 시스템 초기화
    this.lockMgr.init(this.nodes);
    
    console.log("[Engine] Simulation World Built.");
  }

  private rebuildInternalMaps() {
    this.edgeMap.clear();
    this.vehicleLoops.clear();

    this.edges.forEach((edge, index) => {
      this.edgeMap.set(edge.edge_name, index);
      // Loop 객체 생성 (기존 유틸 재사용)
      this.vehicleLoops.set(index, new VehicleLoop(edge));
    });
  }

  /**
   * 메인 루프: 1 프레임 진행
   */
  step(delta: number) {
    if (!this.isRunning) return;

    // 멤버 변수들을 로직 함수에 주입 (Dependency Injection)
    const context = {
      data: this.vehicleData.getData(),
      edges: this.edges,
      edgeMap: this.edgeMap,
      loops: this.vehicleLoops,
      lockMgr: this.lockMgr, // 내 소유의 매니저 전달
      config: this.config
    };

    // 1. 충돌 처리
    checkCollisions(context);

    // 2. 이동 처리
    updateMovement(context);
    
    // 결과는 this.vehicleData(공유 메모리)에 자동 반영됨
  }
}

```

---

## 4. 데이터 흐름 및 생명주기 (Lifecycle)

### Step 1: 맵 로딩 (In React)

사용자가 맵을 선택하면 `MapLoader`가 JSON을 파싱하여 `Store`에 저장한다. (기존 로직 유지)

### Step 2: 모드 활성화 (Simulator Instantiation)

사용자가 `shmMode` 버튼을 누르면:

1. `VehicleSharedMode.tsx`가 마운트된다.
2. `SharedArrayBuffer`를 새로 할당한다.
3. `new Worker('worker.entry.ts')`를 생성한다.
4. **Handshake**: `INIT` 메시지로 `SharedBuffer` + `Map JSON` + `Config`를 워커로 전송한다.

### Step 3: 시뮬레이션 루프 (In Worker)

1. 워커는 `SimulationEngine` 인스턴스를 만들고 `init()`을 실행한다.
2. 내부적으로 `setTimeout` 루프를 돌며 `engine.step(delta)`를 무한 반복한다.
3. 계산된 좌표는 `SharedArrayBuffer`에 즉시 기록된다.

### Step 4: 렌더링 (In React)

1. 메인 스레드의 `VehiclesRenderer`는 `useFrame`을 돌며 `SharedArrayBuffer`의 값을 읽는다.
2. Three.js `InstancedMesh`의 Matrix만 업데이트하여 화면에 그린다.

### Step 5: 맵 변경 (Re-initialization)

사용자가 팹(Map)을 변경하면:

1. `VehicleSharedMode.tsx`가 언마운트 되면서 기존 워커를 `.terminate()` 시킨다 (완전 파괴).
2. 새로운 맵 데이터로 컴포넌트가 다시 마운트된다.
3. 새로운 워커, 새로운 엔진이 생성되어 깨끗한 상태에서 시작한다.

---

## 5. 개발 전략: 한방에? 아니면 조금씩?

사용자님의 상황(기존 코드가 이미 동작함)을 고려할 때, **"구조 먼저 잡고, 로직은 복붙(Copy & Paste)"** 하는 **Hybrid 방식**을 강력 추천합니다.

### 🚩 추천 전략: "Skeleton First, Logic Copy"

작은 기능부터 다시 만드는 건 시간이 너무 오래 걸립니다. 이미 검증된 로직(`movementUpdate` 등)은 그대로 쓰는 게 맞습니다. 단, **그 로직이 뛰어놀 "운동장(Engine Class)"을 먼저 완벽하게 짓는 것**이 핵심입니다.

#### 1단계: 뼈대 구축 (Skeleton)

* `src/shmSimulator` 폴더를 만들고 `SimulationEngine` 클래스를 껍데기만 만듭니다.
* `worker.entry.ts`와 통신하는 부분을 먼저 완성합니다.
* React에서 버튼을 누르면 워커가 뜨고, `console.log("Engine Init")`이 찍히는 것까지만 확인합니다.

#### 2단계: 데이터 이식 (State Migration) - *가장 중요*

* `VehicleDataArray`를 `SimulationEngine` 멤버로 넣습니다.
* `edgeStore`에 있는 맵 데이터를 받아서 `SimulationEngine` 내부 변수(`this.edges`, `this.edgeMap`)에 채워 넣는 코드를 작성합니다.
* **검증**: 워커 콘솔에 `Edges loaded: 150` 처럼 데이터가 잘 들어갔는지 확인합니다.

#### 3단계: 로직 이식 (The Big Copy)

* 기존 `initializeVehicles`, `updateMovement` 함수 내용을 가져옵니다.
* 기존 함수들이 `store`를 인자로 받던 부분을, `SimulationEngine`의 멤버 변수(`this.lockMgr` 등)를 넘겨주도록 수정합니다.
* 이 단계에서 차량이 움직이기 시작해야 합니다.

#### 4단계: 고급 기능 연결

* `LockMgr`를 `SimulationEngine` 멤버로 `new` 해서 붙입니다.
* 교차로에서 차가 멈추는지 확인합니다.

---

### 💡 결론

**"갈아엎는다"고 생각하지 마시고, "이사 간다"고 생각하세요.**

1. **새 집(`shmSimulator`)을 튼튼하게 짓습니다.** (클래스 설계)
2. **이삿짐(`VehicleData`, `MapData`)을 새 집에 넣습니다.** (Init 로직)
3. **가구(`updateMovement`, `LockMgr`)를 새 배치에 맞게 들이십니다.** (로직 연결)

이 방식이 리스크를 최소화하면서 가장 빠르게 `shmMode`를 완성하는 길입니다.

