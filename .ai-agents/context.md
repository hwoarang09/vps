# 반송 제어 시스템 구현 계획

## 상태: Phase 1 완료 (UI + Worker 전달), Phase 2 AutoMgr 로직 미구현

## 개요
- 모든 차량은 기본적으로 **LOOP** (bay 내 edge1↔edge2 왕복)를 돈다
- 반송 ON이면: **LOOP 중인 차량을 중간에 빼서** 반송 경로로 전환
- 반송 완료 후: 다시 LOOP로 복귀
- 가동률/물량 설정에 따라 **동시 반송 차량 수를 제어**

## 핵심 개념: LOOP 차량의 반송 전환

### 차량 상태 구분
```
차량의 pending 데이터 구조:
  1. reservedNextEdges — SHM NEXT_EDGE 슬롯에 이미 써놓은 edge (lock 잡혀있을 수 있음)
  2. pathBuffer        — AutoMgr가 넣어준 미래 경로 (아직 reservedNextEdges로 안 옮김)
```

### 전환 가능 조건
- **reservedNextEdges만 남음** → 소진 대기. 곧 idle이 되므로 그때 반송 할당
- **pathBuffer만 남음** → **교체 가능!** lock 미신청 상태이므로 안전
- **둘 다 남음** → reservedNextEdges 소진 후 pathBuffer 시점에 교체
- **둘 다 없음 (idle)** → 즉시 반송 할당 가능

### 안전한 교체 방법
pathBuffer 교체 시 `applyPathToVehicle()`을 그대로 사용:
1. `cancelObsoleteLocks()` — 새 경로에 없는 기존 lock 취소
2. pathBuffer 덮어쓰기
3. `buildCheckpoints()` — 새 경로 기반 checkpoint 재생성 (lock request 포함)
4. `initNextEdgesForStart()` — 첫 NEXT_EDGE 채움

reservedNextEdges는 **절대 건드리지 않음** → 자연스럽게 소진 후 pathBuffer(= 반송 경로)로 전환

## Phase 1: UI + Worker 전달 ✅ 완료

### 구현 완료 항목
- `fabConfigStore.ts`: `transferEnabled`, `transferRateConfig` (global + per-fab override)
- `FabConfigOverride`: `transferEnabled?`, `transferRateConfig?` 추가
- `ModeParamsPanel.tsx`: Global/Per-fab ON/OFF 토글, 가동률/물량 입력, controller 호출 연결
- `types.ts`: `SET_TRANSFER_ENABLED`, `SET_TRANSFER_RATE` 메시지 타입
- `MultiWorkerController.ts`: `setTransferEnabled()`, `setTransferRate()` (fabId optional)
- `worker.entry.ts`: 두 메시지 핸들러 (per-fab or broadcast via `forEachFab`)
- `EngineStore.ts`: `transferEnabled`, `transferRateMode`, `transferUtilizationPercent`, `transferThroughputPerHour` 필드 + setter
- `FabContext/index.ts`: `setTransferEnabled()`, `setTransferRate()` 래퍼

### 데이터 흐름 (완성)
```
UI (ModeParamsPanel)
  → fabConfigStore (Zustand)
  → controller.setTransferEnabled(enabled, fabId?)
  → controller.setTransferRate(rateMode, util%, tph, fabId?)
  → Worker postMessage
  → worker.entry.ts handler
  → FabContext.setTransferEnabled() / setTransferRate()
  → EngineStore 필드 업데이트
```

## Phase 2: AutoMgr 반송 제어 로직 (구현 예정)

### 2-1. update() 컨텍스트 확장

현재 `autoMgr.update(ctx)` 파라미터:
```ts
ctx: {
  mode: TransferMode;
  numVehicles: number;
  vehicleDataArray, edgeArray, edgeNameToIndex, transferMgr, lockMgr, vehicleBayLoopMap
}
```

추가할 파라미터:
```ts
ctx: {
  ...기존,
  transferEnabled: boolean;           // EngineStore에서
  transferRateMode: 'utilization' | 'throughput';
  transferUtilizationPercent: number; // 0~100
  transferThroughputPerHour: number;
  dt: number;                         // 프레임 delta time (throughput 크레딧 계산용)
}
```

### 2-2. 차량 상태 추적 (AutoMgr 내부 필드 추가)

```ts
// 반송 중인 차량 Set (반송 할당 시 add, 반송 완료 시 delete)
private readonly transferringVehicles: Set<number> = new Set();

// throughput 크레딧 (물량 모드용)
private throughputCredit: number = 0;
```

### 2-3. update() 메인 흐름 변경

```
autoMgr.update(ctx):
  // === 0. 반송 완료 체크 (매 프레임) ===
  for (vehId of transferringVehicles):
    if (!hasPendingCommands(vehId)):
      transferringVehicles.delete(vehId)  // 반송 완료 → LOOP로 자동 복귀

  // === 1. mode가 LOOP/AUTO_ROUTE가 아니면 return ===
  if (mode !== AUTO_ROUTE && mode !== LOOP) return;

  // === 2. 기존 LOOP 처리 (항상 실행) ===
  //   idle 차량 (pending 없음) + transferring이 아닌 차량 → LOOP 경로 할당
  for (각 차량, round-robin):
    if (transferringVehicles.has(vehId)) continue;  // 반송 중이면 skip
    if (hasPendingCommands(vehId)) continue;         // 아직 이동 중이면 skip
    → checkAndAssignLoopRoute()                      // LOOP 경로 할당

  // === 3. 반송 할당 (transferEnabled일 때만) ===
  if (!transferEnabled) return;

  canAssign = shouldAssignTransfer()  // 가동률/물량 체크
  if (!canAssign) return;

  // LOOP 중인 차량 중 반송 대상 선택
  for (각 차량, round-robin):
    if (transferringVehicles.has(vehId)) continue;  // 이미 반송 중
    if (!isSwappable(vehId)) continue;               // 교체 불가 (reservedNextEdges만 남은 경우 등)

    → pathBuffer clear + assignRandomDestination()
    → transferringVehicles.add(vehId)
    → canAssign 재체크, 불가면 break
```

### 2-4. shouldAssignTransfer() — 가동률/물량 판정

```ts
private shouldAssignTransfer(ctx): boolean {
  const transferCount = this.transferringVehicles.size;
  const totalVehicles = ctx.numVehicles;

  if (ctx.transferRateMode === 'utilization') {
    // 현재 가동률 = 반송 중 차량 / 전체 차량
    const currentUtil = (transferCount / totalVehicles) * 100;
    return currentUtil < ctx.transferUtilizationPercent;
  }

  if (ctx.transferRateMode === 'throughput') {
    // 크레딧 누적: 매 프레임 dt * (목표/3600) 만큼 증가
    this.throughputCredit += ctx.dt * (ctx.transferThroughputPerHour / 3600);
    // 크레딧 상한 = 10 (버스트 제한)
    this.throughputCredit = Math.min(this.throughputCredit, 10);
    return this.throughputCredit >= 1;
  }

  return false;
}
```

### 2-5. isSwappable() — 교체 가능 판정

```ts
private isSwappable(vehId: number, transferMgr: TransferMgr): boolean {
  // reservedNextEdges가 남아있으면 교체 불가 (lock 잡혀있을 수 있음)
  const reserved = transferMgr.getReservedNextEdges(vehId);  // 새 메서드 필요
  if (reserved && reserved.length > 0) return false;

  // pathBuffer만 남아있거나, 둘 다 없으면 교체 가능
  return true;
}
```

**주의**: `TransferMgr`에 `getReservedNextEdges(vehId)` 또는 `hasReservedNextEdges(vehId)` 메서드 추가 필요

### 2-6. 반송 할당 시 pathBuffer 교체

```ts
// 1. 기존 pathBuffer clear
transferMgr.clearVehiclePath(vehId);  // 새 메서드 필요 (pathBuffer만 0으로)

// 2. assignRandomDestination() 호출
//    → 내부에서 applyPathToVehicle() → cancelObsoleteLocks() + pathBuffer 덮어쓰기 + checkpoint 재생성
this.assignRandomDestination(vehId, currentEdgeIdx, ...);

// 3. 반송 중 등록
this.transferringVehicles.add(vehId);

// 4. throughput 크레딧 차감 (물량 모드)
if (ctx.transferRateMode === 'throughput') {
  this.throughputCredit -= 1;
}
```

### 2-7. 반송 완료 → LOOP 복귀

별도 처리 불필요:
- 반송 경로 소진 → `hasPendingCommands() === false`
- update() 첫 부분에서 `transferringVehicles.delete(vehId)`
- 다음 프레임에서 LOOP 할당 로직이 이 차량을 잡아서 LOOP 경로 할당

## Phase 2 파일 변경 계획

| 파일 | 변경 내용 |
|------|-----------|
| `AutoMgr.ts` | transferringVehicles Set, throughputCredit, shouldAssignTransfer(), isSwappable(), update() 흐름 변경 |
| `TransferMgr/index.ts` | `hasReservedNextEdges(vehId)` 메서드 추가, `clearVehiclePath(vehId)` 메서드 추가 |
| `FabContext/simulation-step.ts` | autoMgr.update() 호출 시 transferEnabled, rateMode, util%, tph, dt 전달 |

## Phase 2 구현 순서

| Step | 내용 | 파일 |
|------|------|------|
| 1 | TransferMgr에 `hasReservedNextEdges()`, `clearVehiclePath()` 추가 | TransferMgr/index.ts |
| 2 | AutoMgr 내부 필드 추가 (transferringVehicles, throughputCredit) | AutoMgr.ts |
| 3 | AutoMgr.update() ctx 타입 확장 | AutoMgr.ts |
| 4 | AutoMgr.update() 메인 흐름 재구성 (LOOP 먼저 → 반송 판정 → 교체) | AutoMgr.ts |
| 5 | shouldAssignTransfer(), isSwappable() 구현 | AutoMgr.ts |
| 6 | simulation-step.ts에서 EngineStore 값 전달 | simulation-step.ts |
| 7 | 통합 테스트 (LOOP→반송→LOOP 전환 확인) | - |

## 엣지 케이스

| 상황 | 처리 |
|------|------|
| 반송 중 transferEnabled OFF | 현재 반송은 완료까지 유지, 새 반송만 안 내림 |
| 가동률 50%→10% 변경 | 이미 반송 중인 차량은 완료까지 유지, 초과분이 자연 소진될 때까지 새 할당 안 함 |
| stations 없음 | assignRandomDestination() return false → 반송 불가, LOOP 유지 |
| 차량 1대뿐 | 가동률 100% = 1대 반송, 50% = 0대 (반올림 정책 결정 필요) |
| pathBuffer도 reservedNextEdges도 없는 idle | 바로 반송 할당 가능 (isSwappable = true) |
| MQTT 모드 | AUTO_ROUTE와 별개 — 외부 명령 기반이므로 가동률/물량 제어 대상 아님 (추후 결정) |

---

# Log DB 개발 계획

## 상태: Phase 2 완료 (Phase 3 분석 스크립트 남음)

## 아키텍처

```
simulation-step.ts
  │
  └─ simLogger.logLock(...)   ← 호출부 변경 없음
        │
        ├─ [opfs: true]  → OPFS 버퍼 쓰기 (기존 로직)
        ├─ [db: true]    → DbShipper 버퍼 → fetch POST
        └─ [둘 다 false] → 아무것도 안 함

┌─ Sim Worker ─────────────────────┐
│ SimLogger (래퍼)                  │
│   config.targets { opfs, db }    │
│   ├─ OPFS Writer (기존 로직)     │
│   └─ DbShipper (NEW)             │
│       - 이벤트별 ArrayBuffer 버퍼 │
│       - 1초 or 1000건 batch POST  │
└────────── fetch() ───────────────┘
                │
                ▼
┌─ FastAPI (tools/log_db/server/) ─┐
│ POST /logs/ingest                 │
│   - binary batch 수신             │
│   - protocol.ts struct 포맷 파싱  │
│   - PostgreSQL batch INSERT       │
└──────────────────────────────────┘
                │
                ▼
┌─ PostgreSQL (Docker, 로컬) ──────┐
│ sessions, ml_*, dev_* 테이블      │
└──────────────────────────────────┘
```

## 현재 로그 호출 현황

모든 로그 호출은 `src/shmSimulator/core/FabContext/simulation-step.ts` 한 곳에서 발생.

| 메서드 | 타입 | 라인 | 모드 | 비고 |
|--------|------|------|------|------|
| `logLock()` | ML | L90 | ml/dev | lockMgr 콜백 |
| `logEdgeTransit()` | ML | L131 | ml/dev | onEdgeTransit 콜백 |
| `logTransfer()` | DEV | L142 | dev only | onEdgeTransit 내부 |
| `logPath()` | DEV | L173 | dev only | autoMgr.onPathFound |

미사용 메서드: `logOrderComplete`, `logVehState`, `logLockDetail`, `logEdgeQueue` (정의만 존재)

## SimLogger 초기화 경로

```
Main Thread: shmSimulatorStore.resume()
  → MultiWorkerController.enableLogging()
    → Worker: worker.entry.ts handleSetLoggerPort()
      → FabContext.setLoggerPort()
        → logger-setup.ts setupLoggerPort()
          → new SimLogger(config) + logger.init()
```

현재 mode는 항상 `'ml'`. sessionId = `sim_{fabId}_{timestamp}`.

## Phase 1: 인프라 — tools/log_db/

### 파일 구조
```
tools/log_db/
├── docker-compose.yml          # PostgreSQL 16 alpine
├── schema.sql                  # 테이블 + 인덱스 (실사용 4개만)
├── server/
│   ├── main.py                 # FastAPI 서버 (port 8100)
│   ├── ingest.py               # binary 파싱 + DB batch INSERT
│   └── requirements.txt        # fastapi, uvicorn, psycopg2-binary
└── analyzer/                   # Phase 3에서 추가
```

### Docker
- image: postgres:16-alpine
- port: 5432
- DB: vps_logs, user: vps, password: vps
- volume: vps_pgdata

### DB 테이블 (실사용 이벤트만)
```sql
sessions           -- session_id, started_at, mode, vehicle_count, map_name, note
ml_edge_transit    -- session_id, ts, veh_id, edge_id, enter_ts, exit_ts, edge_len, created_at
ml_lock            -- session_id, ts, veh_id, node_idx, event_type, wait_ms, created_at
dev_transfer       -- session_id, ts, veh_id, from_edge, to_edge, created_at
dev_path           -- session_id, ts, veh_id, dest_edge, path_len, created_at
```

인덱스: (session_id, edge_id), (session_id, veh_id), (session_id, node_idx)

미사용 테이블(ml_order_complete, dev_veh_state, dev_lock_detail, dev_edge_queue)은 해당 로그 활성화 시 추가.

### FastAPI 서버
- `POST /logs/ingest` — binary body, 헤더로 session_id + event_type 전달
- `POST /sessions` — 세션 등록 (시뮬 시작 시)
- protocol.ts의 RECORD_SIZE/struct 포맷 기반 파싱 (log_parser.py EVENT_TYPES dict 재사용)
- psycopg2 executemany batch INSERT
- 서버 실패 시 → Worker 측에서 무시 (OPFS fallback)

## Phase 2: Worker LogShipper — src/logger/

### 파일 구조
```
src/logger/
├── SimLogger.ts       # 수정: targets flag 분기 + DbShipper 연동
├── DbShipper.ts       # NEW: fetch batch POST
├── protocol.ts        # 기존 그대로
├── simLogUtils.ts     # 기존 그대로
└── index.ts           # DbShipper re-export 추가
```

### SimLoggerConfig 변경
```typescript
export interface SimLoggerConfig {
  sessionId: string;
  workerId: number;
  mode: 'ml' | 'dev';
  vehStateHz?: 10 | 30 | 60;
  targets: {
    opfs?: boolean;    // OPFS 파일 쓰기 (기본: true)
    db?: boolean;      // DB 서버 전송 (기본: false)
    dbUrl?: string;    // 기본: http://localhost:8100
  };
}
```

### SimLogger 수정 포인트
- 각 logXxx() 내부에서 targets.opfs → 기존 _increment(), targets.db → dbShipper.push()
- init()에서 targets.opfs일 때만 OPFS 핸들 생성
- init()에서 targets.db일 때 DbShipper 생성 + session 등록 POST
- dispose()에서 dbShipper.flush() + cleanup

### DbShipper.ts
- 이벤트 타입별 ArrayBuffer 버퍼
- flush 조건: 1초 타이머 OR 1000건 도달
- fetch() POST → 실패 시 버퍼 폐기 (retry 안 함, 성능 우선)
- Worker에서 fetch() 사용 가능 (DOM 아님)

### logger-setup.ts 수정
- SimulationConfig에서 logTargets 읽어서 SimLoggerConfig.targets에 전달
- 기본값: { opfs: true, db: false }

### SimulationConfig 추가 필드
```typescript
logTargets?: {
  opfs?: boolean;
  db?: boolean;
  dbUrl?: string;
};
```

## Phase 3: 분석 스크립트 (나중에)

```
tools/log_db/analyzer/
├── edge_bottleneck.py    # edge별 평균 통과 시간
├── lock_analysis.py      # 노드별 대기 시간
└── session_summary.py    # 세션 요약
```

## 구현 순서

| Step | 내용 | 파일 |
|------|------|------|
| 1 | docker-compose.yml | tools/log_db/ |
| 2 | schema.sql | tools/log_db/ |
| 3 | FastAPI 서버 (main.py + ingest.py) | tools/log_db/server/ |
| 4 | DB 기동 + 서버 테스트 | curl로 확인 |
| 5 | DbShipper.ts | src/logger/ |
| 6 | SimLogger.ts 수정 (targets 분기) | src/logger/ |
| 7 | logger-setup.ts 수정 (config 전달) | src/shmSimulator/core/FabContext/ |
| 8 | SimulationConfig에 logTargets 추가 | src/shmSimulator/types.ts |
| 9 | 통합 테스트 (시뮬 → DB 확인) | - |

## 확정사항
- FastAPI 포트: 8100
- DB 서버 연결 실패 시: 무시, OPFS만 유지, 에러 로그 안 찍음
- 미사용 이벤트 테이블: 나중에 추가
- 서버 시작: 수동 (docker-compose up + uvicorn)
