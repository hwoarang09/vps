# 반송 제어 시스템 구현 계획

## 상태: UI 완료, Worker 로직 미구현

## 개요
- 반송 ON/OFF 토글 + 가동률/물량 제어 → Worker에 전달하여 실제 반송 비율 제어
- OFF일 때: 모든 차량 LOOP만 순회
- ON일 때: 설정된 모드(AUTO/MQTT)로 반송 명령 생성, idle 차량은 LOOP

## 구현된 것 (UI Only)
- `fabConfigStore.ts`: `transferEnabled`, `transferRateConfig` (mode, utilizationPercent, throughputPerHour)
- `ModeParamsPanel.tsx`: 반송 ON/OFF 토글, AUTO/MQTT 모드 선택, 가동률/물량 입력

## 구현할 것 (Worker 로직)

### 1. transferEnabled → Worker 전달
- `MultiWorkerController`에 `setTransferEnabled(enabled: boolean)` 추가
- Worker message: `SET_TRANSFER_ENABLED`
- `EngineStore`에 `transferEnabled: boolean` 추가
- ON/OFF 토글 시 UI에서 controller 호출

### 2. transferRateConfig → Worker 전달
- `MultiWorkerController`에 `setTransferRateConfig(config)` 추가
- Worker message: `SET_TRANSFER_RATE`
- `EngineStore`에 `transferRateConfig` 추가

### 3. AutoMgr 로직 변경 (핵심)
현재: `autoMgr.update()` → idle 차량 발견 시 **무조건** 반송 할당
변경:

```
autoMgr.update():
  if (!transferEnabled):
    return  ← 반송 OFF면 아무것도 안 함 (전부 LOOP)

  if (rateMode === 'utilization'):
    현재 반송 중인 차량 수 / 전체 차량 수 = 현재 가동률
    현재 가동률 >= 목표% → 새 할당 skip
    현재 가동률 < 목표% → 할당 진행

  if (rateMode === 'throughput'):
    목표 초당 반송 = throughputPerHour / 3600
    이번 프레임에서 할당 가능한 수 = 누적 크레딧 기반
    크레딧 부족 → skip
    크레딧 있음 → 할당 + 크레딧 차감
```

### 4. idle 차량 LOOP 동작
- `transferEnabled === false` 이거나, 반송 할당 대상이 아닌 차량 → LOOP
- 현재 LOOP 로직: `processTransferQueue()` + `fillNextEdgesFromLoopMap()`
- AutoMgr에서 반송 할당 안 된 차량은 기존 LOOP 흐름 그대로 유지

### 5. 반송 완료 → LOOP 복귀
- `hasPendingCommands(vehId) === false` (경로 소진) → idle 상태
- idle + transferEnabled + 가동률/물량 여유 → 새 반송
- idle + (OFF or 여유 없음) → LOOP 계속

## 파일 변경 예상

| 파일 | 변경 |
|------|------|
| `MultiWorkerController.ts` | setTransferEnabled, setTransferRateConfig 메서드 |
| `worker.entry.ts` | SET_TRANSFER_ENABLED, SET_TRANSFER_RATE 핸들러 |
| `EngineStore.ts` | transferEnabled, transferRateConfig 필드 |
| `FabContext/index.ts` | autoMgr.update()에 enabled/rate 전달 |
| `AutoMgr.ts` | 가동률/물량 기반 할당 로직 |
| `ModeParamsPanel.tsx` | ON/OFF, rate 변경 시 controller 호출 |

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
