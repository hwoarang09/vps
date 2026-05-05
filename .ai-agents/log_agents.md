# Log System - AI Context

## Overview

SimLogger 기반 단일 바이너리 로그 시스템. Worker 스레드에서 OPFS에 직접 기록.

**핵심 특징:**
- 이벤트 타입별 .bin 파일로 OPFS에 직접 기록
- 두 종류 모드: `ml` (통계용) / `dev` (디버그용)
- Worker 스레드에서 `FileSystemSyncAccessHandle`로 직접 쓰기 (Main→Worker MessagePort 불필요)
- 512 레코드 단위 flush

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Main Thread                                  │
│  ┌─────────────────┐                                                │
│  │ simLogUtils.ts  │ → OPFS 파일 목록/다운로드/삭제 (UI용)          │
│  └─────────────────┘                                                │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                         Sim Worker                                   │
│  ┌─────────────────┐                                                │
│  │   SimLogger     │ → OPFS SyncAccessHandle로 직접 .bin 쓰기       │
│  └─────────────────┘                                                │
└─────────────────────────────────────────────────────────────────────┘
```

## File Map

```yaml
src/logger/protocol.ts
  purpose: 멀티 이벤트 바이너리 프로토콜 정의

  EventType enum:
    ML_PICKUP = 1      # 16B: ts(4) vehId(4) nodeEdgeId(4) stationIdx(2) bayIdx(1) pad(1)
    ML_DROPOFF = 2     # 16B: 동일
    ML_EDGE_TRANSIT = 3 # 24B: ts(4) vehId(4) edgeId(4) enterTs(4) exitTs(4) edgeLen(f32,4)
    ML_LOCK = 4        # 16B: ts(4) vehId(4) nodeIdx(2) eventType(1) pad(1) waitMs(4)
    DEV_VEH_STATE = 10 # 44B: ts(4) vehId(4) x y z edge ratio speed movingStatus trafficState jobState (각 f32)
    DEV_PATH = 11      # 16B: ts(4) vehId(4) destEdge(4) pathLen(4)
    DEV_LOCK_DETAIL = 12 # 20B: ts(4) vehId(4) nodeIdx(2) type(1) pad(1) holderVehId(4) waitMs(4)
    DEV_TRANSFER = 13  # 16B: ts(4) vehId(4) fromEdge(4) toEdge(4)
    DEV_EDGE_QUEUE = 14 # 16B: ts(4) edgeId(4) vehId(4) count(2) type(1) pad(1)

  constants:
    FLUSH_THRESHOLD: 512 records
    ML_EVENT_TYPES: [1,2,3,4]
    ALL_EVENT_TYPES: [1,2,3,4,10,11,12,13,14]

  functions:
    getFileName(sessionId, eventType) → "{sessionId}_{suffix}.bin"

src/logger/SimLogger.ts
  purpose: Worker 스레드 전용 로거 - OPFS SyncAccessHandle로 직접 쓰기

  config:
    sessionId: string
    workerId: number
    mode: 'ml' | 'dev'
    vehStateHz?: 10 | 30 | 60

  key methods:
    - init(): OPFS 파일 핸들 생성
    - logPickup(ts, vehId, nodeEdgeId, stationIdx, bayIdx)
    - logDropoff(ts, vehId, nodeEdgeId, stationIdx, bayIdx)
    - logEdgeTransit(ts, vehId, edgeId, enterTs, exitTs, edgeLen)
    - logLock(ts, vehId, nodeIdx, lockEventType, waitMs)
    - logVehState(ts, vehId, x, y, z, edge, ratio, speed, movingStatus, trafficState, jobState)
    - logPath(ts, vehId, destEdge, pathLen)
    - logLockDetail(ts, vehId, nodeIdx, type, holderVehId, waitMs)
    - logTransfer(ts, vehId, fromEdge, toEdge)
    - logEdgeQueue(ts, edgeId, vehId, count, type)
    - flush(): 모든 버퍼 디스크에 쓰기
    - dispose(): flush + 핸들 닫기

src/logger/simLogUtils.ts
  purpose: Main Thread에서 OPFS SimLog 파일 관리

  functions:
    - listSimLogFiles(): SimLogFileInfo[]
    - downloadSimLogFile(fileName): 브라우저 다운로드
    - deleteSimLogFile(fileName): boolean
    - clearAllSimLogs(): { deleted, failed }

src/logger/index.ts
  purpose: SimLogger + protocol + simLogUtils re-export
```

## File Naming

```
{sessionId}_{suffix}.bin

suffixes:
  pickup       → ML_PICKUP
  dropoff      → ML_DROPOFF
  edge_transit → ML_EDGE_TRANSIT
  lock         → ML_LOCK
  veh_state    → DEV_VEH_STATE
  path         → DEV_PATH
  lock_detail  → DEV_LOCK_DETAIL
  transfer     → DEV_TRANSFER
  edge_queue   → DEV_EDGE_QUEUE
```

## Usage

```typescript
// Worker 내부에서 SimLogger 사용
const logger = new SimLogger({
  sessionId: `sim_${Date.now()}`,
  workerId: 0,
  mode: 'ml', // or 'dev'
});
await logger.init();

// 로그 기록
logger.logEdgeTransit(timestamp, vehId, edgeId, enterTs, exitTs, edgeLen);
logger.logPickup(timestamp, vehId, nodeEdgeId, stationIdx, bayIdx);

// 정리
logger.dispose(); // flush + close
```

## Python Parser

### 파일

```yaml
scripts/log_parser/log_parser.py
  purpose: 단일 .bin 파일 raw 파싱 + summary/CSV export
  지원 타입: order, edge_transit, lock, veh_state, path, lock_detail, transfer, edge_queue, snapshot
  주요 함수:
    - parse_file(filepath) → list[dict]   # fixed-size 레코드
    - parse_snapshot_file(filepath) → list[block]   # 가변 블록 (snapshot 전용)

scripts/log_parser/analyze.py
  purpose: 세션 디렉토리 통합 분석 (여러 .bin 합쳐서 시간순 / 노드 / 차량 단위로 보기)
  명령들 (mutually exclusive):
    --lock-node N    : 특정 노드의 lock activity (REQ/WAIT/GRANT/RELEASE 시간순 + 위치 + holder timeline + 잔존 holder)
    --veh V          : 차량 타임라인 (edge 이동 + path + lock + transfer + checkpoint 통합)
    --stuck          : 멈춘 차량 자동 탐지
    --transfers      : 반송 현황 요약
    --deadlock --pair V1 V2 [--node N] : 두 차량 데드락 분석
    --raw            : 차량 원시 레코드 출력
    (default)        : 세션 전체 요약
  공통 옵션: --from / --to (시간 범위), --limit
```

### snapshot.bin 형식 (가변 블록)

```
magic(u16)=0xCAFE
ts(u32)
numVehicles(u16)
[vehId(u16) currentEdge(u16) ratio(f32) velocity(f32) stopReason(u16)] × numVehicles
numActiveEdges(u16)
[edgeId(u16) count(u16) [vehId(u16)] × count] × numActiveEdges
```

`parse_snapshot_file()` 가 알아서 파싱. magic 으로 sync, 손상 시 다음 magic 까지 스킵.

### 사용 예

```bash
# 세션 요약
python3 scripts/log_parser/analyze.py logs/SESSION_ID/

# 단일 .bin 파일 raw
python3 scripts/log_parser/log_parser.py logs/SESSION_ID/X_lock.bin --summary
python3 scripts/log_parser/log_parser.py logs/SESSION_ID/X_lock.bin --veh 164

# 노드 분석 (가장 많이 씀)
python3 scripts/log_parser/analyze.py logs/SESSION_ID/ --lock-node 384

# 차량 통합 타임라인
python3 scripts/log_parser/analyze.py logs/SESSION_ID/ --veh 164

# 특정 시간대만
python3 scripts/log_parser/analyze.py logs/SESSION_ID/ --lock-node 384 --from 5000 --to 15000

# CSV export
python3 scripts/log_parser/log_parser.py logs/SESSION_ID/ --session SESSION_ID --export-csv ./output/
```

## 노드 분석 워크플로우

사용자가 "N0XXX 분석해줘" / "어떤 노드 락이 이상해" 라고 하면:

1. **node 이름 → node_idx 변환**
   - log/analyze.py 의 node_idx 는 **0-based** (e.g. `N0385` → `384`)
   - nodes.cfg 1-based row N → log node_idx (N-1)
2. **`analyze.py --lock-node <idx>` 한 번 호출**
3. 출력에서 핵심 자동 보임:
   - 시간순 lock event 표 (REQ/WAIT/GRANT/RELEASE)
   - 각 event 시점 차량 위치 (snapshot 가장 가까운 frame: edge, ratio, velocity, stopReason)
   - 차량별 사이클 요약 (정상은 `REQ WAIT GRANT RELEASE`, 비정상 한눈에)
   - holder timeline (보유 시간 포함)
   - **❗ 잔존 holder** (시뮬 끝까지 release 안 한 차량)
4. 매번 ad-hoc 파이썬 스크립트 새로 짜지 말 것 — 위 명령으로 충분

## Lock Event 의미

```
event_type 0 = REQ      (락 요청)
event_type 1 = GRANT    (락 받음)
event_type 2 = RELEASE  (락 해제)
event_type 3 = WAIT     (queue 진입, holder_hint = 누가 들고 있나)
holder_hint = 255 → '-' (해당 없음)
```

## 멀티 fab 주의

한 세션에 fab 여러 개 (e.g. `*_fab_1_0_*.bin`, `*_fab_2_1_*.bin`) 가 같이 있으면 `analyze.py` 가 둘 다 합쳐 출력 → ts 가 섞임. 분석 시 fab 별로 분리된 디렉토리에 두는 게 깔끔. (필요 시 `--fab` 필터 추가 가능)

## Critical Rules

1. **SimLogger는 Worker에서만 사용** (FileSystemSyncAccessHandle은 Worker 전용 API)
2. **Main Thread에서는 simLogUtils 사용** (비동기 File API)
3. **각 EventType은 별도 .bin 파일** (pickup.bin, dropoff.bin 등 - SyncAccessHandle 충돌 방지)
4. **512 레코드마다 자동 flush** (FLUSH_THRESHOLD)

## Impact Map

| 수정 | 확인 필요 |
|------|-----------|
| protocol.ts EventType/RECORD_SIZE | SimLogger.ts, log_parser.py |
| SimLogger 메서드 시그니처 | FabContext/logger-setup.ts, simulation-step.ts |
| simLogUtils.ts | SimLogFileManager.tsx, shmSimulatorStore.ts |
| Python parser struct format | log_parser.py EVENT_TYPES, COLUMNS |

## [TODO] PostgreSQL 로그 DB 계획

### 목표
현재: Worker → OPFS .bin → 수동 다운로드 → Python 파싱 → 분석
목표: Worker → fetch() → FastAPI → PostgreSQL → 실시간 분석

### 아키텍처
```
┌─ Sim Worker ─────────────────────────┐
│ SimLogger (기존 OPFS 유지, fallback)  │
│ LogShipper (NEW)                      │
│   - 버퍼에 레코드 모음               │
│   - 1초 or 1000건마다 batch POST      │
└──────────── fetch() ─────────────────┘
                 │
                 ▼
┌─ Local Backend (Python FastAPI) ─────┐
│ POST /logs/ingest                     │
│   - binary batch 수신                │
│   - PostgreSQL INSERT                │
└──────────────────────────────────────┘
                 │
                 ▼
┌─ PostgreSQL (Docker, 로컬) ──────────┐
│ 테이블: ml_*, dev_* (이벤트 타입별)   │
│ → SQL 직접 분석                       │
│ → Python psycopg2 쿼리               │
│ → Grafana 연결 가능                   │
└──────────────────────────────────────┘
```

### 로그 목록

**ML (항상 기록):**
| 이벤트 | 테이블 | 빈도 |
|--------|--------|------|
| ORDER_COMPLETE | ml_order_complete | 오더 완료 시 |
| EDGE_TRANSIT | ml_edge_transit | 엣지 진입/퇴출마다 |
| LOCK | ml_lock | 락 이벤트마다 |

**DEV (dev 모드에서만):**
| 이벤트 | 테이블 | 빈도 |
|--------|--------|------|
| VEH_STATE | dev_veh_state | 매 프레임 (10~60Hz) |
| PATH | dev_path | 경로 변경 시 |
| LOCK_DETAIL | dev_lock_detail | 락 대기 발생 시 |
| TRANSFER | dev_transfer | transfer 시 |
| EDGE_QUEUE | dev_edge_queue | 큐 변동 시 |

**추가 후보:**
| 이벤트 | 목적 | 우선순위 |
|--------|------|----------|
| DISPATCH | 배차 로직 디버깅 | 높음 |
| COLLISION | 충돌 감지/회피 | 중간 |
| SIM_TICK | 틱 처리 시간 프로파일링 | 낮음 |

### DB 테이블 설계

```sql
-- 세션 메타
CREATE TABLE sessions (
    session_id TEXT PRIMARY KEY,
    started_at TIMESTAMPTZ DEFAULT now(),
    mode TEXT NOT NULL,            -- 'ml' | 'dev'
    vehicle_count INT,
    map_name TEXT,
    note TEXT
);

-- ML 이벤트
CREATE TABLE ml_order_complete (
    session_id TEXT NOT NULL, order_id INT, veh_id INT, dest_edge INT,
    move_to_pickup_ts INT, pickup_arrive_ts INT, pickup_start_ts INT, pickup_done_ts INT,
    move_to_drop_ts INT, drop_arrive_ts INT, drop_start_ts INT, drop_done_ts INT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE ml_edge_transit (
    session_id TEXT NOT NULL, ts INT, veh_id INT, edge_id INT,
    enter_ts INT, exit_ts INT, edge_len REAL,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE ml_lock (
    session_id TEXT NOT NULL, ts INT, veh_id INT,
    node_idx SMALLINT, event_type SMALLINT, wait_ms INT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- DEV 이벤트
CREATE TABLE dev_veh_state (
    session_id TEXT NOT NULL, ts INT, veh_id INT,
    x REAL, y REAL, z REAL, edge REAL, ratio REAL, speed REAL,
    moving_status REAL, traffic_state REAL, job_state REAL,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE dev_path (
    session_id TEXT NOT NULL, ts INT, veh_id INT,
    dest_edge INT, path_len INT, created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE dev_lock_detail (
    session_id TEXT NOT NULL, ts INT, veh_id INT,
    node_idx SMALLINT, type SMALLINT, holder_veh_id INT, wait_ms INT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE dev_transfer (
    session_id TEXT NOT NULL, ts INT, veh_id INT,
    from_edge INT, to_edge INT, created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE dev_edge_queue (
    session_id TEXT NOT NULL, ts INT, edge_id INT,
    veh_id INT, count SMALLINT, type SMALLINT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 인덱스
CREATE INDEX idx_edge_transit_session_edge ON ml_edge_transit(session_id, edge_id);
CREATE INDEX idx_lock_session_node ON ml_lock(session_id, node_idx);
CREATE INDEX idx_veh_state_session_veh ON dev_veh_state(session_id, veh_id);
CREATE INDEX idx_lock_detail_session_veh ON dev_lock_detail(session_id, veh_id);
```

### 구현 Phase
- Phase 1: Docker PostgreSQL + 스키마 + FastAPI 서버 (scripts/log_server/)
- Phase 2: Worker LogShipper.ts — SimLogger에서 write 시 LogShipper에도 push, batch fetch POST
- Phase 3: 분석 쿼리 스크립트 (scripts/log_analyzer/)

## 분석 도구 (scripts/log_parser/)

세션 분석/디버깅용 Python 도구. 일회용 ad-hoc 스크립트로 만들지 말고 이 폴더에 등록해서 재사용.

### log_parser.py
범용 .bin 파일 파서 (개별 파일 단위, CLI).
- `parse_file(filepath, event_types=None)` — 단일 .bin → list[dict]
- `parse_snapshot_file(filepath)` — snapshot.bin (가변 블록) 파싱
- CLI: `--summary` / `--export-csv` / `--type` / `--veh` / `--from` / `--to`

### analyze.py
세션 통합 분석 (모든 .bin 한 번에 로드, CLI).

| 명령어 | 인풋 | 아웃풋 / 용도 |
|---|---|---|
| (없음) | session_dir | 세션 요약 (각 suffix 별 record/veh/시간 범위) |
| `--veh N` | veh_id | 차량 타임라인 (edge transit + path + transfer + lock) |
| `--stuck` | - | 멈춘 차량 탐지 (10초 이상 정지) |
| `--transfers` | - | 반송 현황 요약 |
| `--deadlock --pair V1 V2 [--node N]` | 두 차량 + 노드 | deadlock 분석 (cycle 검증) |
| `--lock-node N` | node_idx (0-based) | 노드 락 activity 시간순 + 차량 위치 + holder timeline |
| `--lock-detail [--detail-type X]` | - | DEV_LOCK_DETAIL 의심 메커니즘 추적 (ZONE_PREEMPT/DZ_GATE/HOLDER_SWAP) |
| `--ratio-jump --veh N` | veh_id, threshold | 텔레포트 감지 (같은 edge 에서 \|Δratio\| > 0.3) |
| `--compare-pair --pair V1 V2` | 두 차량 | 시간순 위치 비교 (edge/ratio/vel/stop) |
| `--topology --rail-dir D [--edge-idx N] [--node-idx N]` | rail config 폴더 | 토폴로지 검증 — edge ↔ from/to_node 매핑, merge 노드 검출 |

### snapshot_streaming.py (NEW, 2026-05-05)
큰 snapshot.bin (300MB+) 을 OOM 없이 streaming 처리.

| 함수 | 인풋 | 아웃풋 |
|---|---|---|
| `iter_snapshot_frames(filepath, ts_range=None)` | path, optional (ts_from, ts_to) | generator: frame meta {ts, num_v, raw, veh_off} |
| `capture_at_ts_list(filepath, target_ts_list, target_vehs=None)` | path, ts 리스트, vehId set | `{target_ts: {snap_ts, data: {vehId: {edge,ratio,vel,stop}}}}` |
| `capture_dense_range(filepath, ts_range, target_vehs=None, every_n=1)` | path, (ts_from,ts_to), set, N | list of `{ts, data: {vehId: {edge,ratio,vel,stop}}}` |
| `detect_ratio_jumps(filepath, veh_id, threshold=0.3, ts_range=None)` | path, vehId, 임계값 | list of `{ts, edge, prev_ratio, cur_ratio, delta, same_edge, prev_vel, cur_vel}` |

언제 쓰나:
- `parse_snapshot_file()` 가 OOM 나는 큰 세션 (>200MB)
- 특정 시간 구간만 dense 분석 (ratio 점프 감지, deadlock 시점 차량 위치 추적)
- 두 차량 위치 비교 (deadlock 조사)

### topology.py (NEW, 2026-05-05)
rail config (edge.map+node.map / edges.cfg+nodes.cfg) 로딩 + 인덱스 변환.

| 함수 / 메소드 | 인풋 | 아웃풋 |
|---|---|---|
| `load_topology(rail_dir)` | railConfig 폴더 | `Topology` 객체 |
| `Topology.edge_by_index(idx_1based)` | SHM 1-based edge idx | edge dict |
| `Topology.node_by_index(idx_0based)` | lock log 0-based node idx | node dict |
| `Topology.edge_idx_by_name("EDGE0246")` | edge 이름 | 1-based int |
| `Topology.node_idx_by_name("NODE0216")` | node 이름 | 0-based int |
| `Topology.edges_into(node_name)` | node 이름 | incoming edge 리스트 |
| `Topology.edges_out_of(node_name)` | node 이름 | outgoing edge 리스트 |
| `Topology.merge_nodes` | property | incoming ≥ 2 인 노드 set |
| `describe_edge(topo, idx)` / `describe_node(topo, idx)` | - | 사람-읽기용 한 줄 요약 |

언제 쓰나:
- 락 로그의 `node_idx=215` 가 어떤 NODE인지 확인 (0-based vs 1-based 매핑 검증)
- `edge 246` 의 from/to 노드 + 길이 + bay 확인
- merge 노드 검출 (incoming edges ≥ 2)
- 차량 경로 검증 (edge X 의 다음 가능한 edge가 무엇인지)

### 인덱스 매핑 규칙 (중요)
- **edge index**: SHM/log 에서 항상 **1-based**. `edges[idx-1]` 로 array 접근.
- **node index**: lock log (`node_idx`) 는 **0-based** (nodeNameToIndex set with i 그대로).
- 즉 lock log 의 `node_idx=215` = `nodes[215]` = `NODE0216` (이름 1-based). UI 의 "N216" 과 매핑.
- TMP_FROM_*/TMP_TO_* 노드도 nodes 배열에 포함 (parseNodesCFG 가 필터하지 않음). 단 NODE0xxx 가 먼저 나와서 NODE0216 의 인덱스는 215 가 맞음.

### 분석 케이스 노트 (2026-05-05): N216 deadlock 조사
세션 `20260505_1405`. veh 118 N216 락 잡고 영원히 release 안함. veh 57이 앞을 막아 양쪽 다 stuck.
- **smoking gun**: veh 118 ratio 0.929 → 0.050 (같은 edge 246 에서 텔레포트, 112ms)
- **의심 코드**: `AutoMgr.ts:181, 218` — `data[ptr + MovementData.TARGET_RATIO] = srcStation.ratio`
- 차량이 station 을 이미 지나친(currentRatio > srcStation.ratio) 상태에서 path replan 발생 시,
  `vehicleTransition.ts:235` `checkTargetReached` 가 `rawNewRatio >= targetRatio` 조건으로 ratio 를 target 으로 강제 → 뒤로 텔레포트
- 락은 GRANT 직후라 hold 유지, 위치만 뒤로 가서 후속 차량(57)이 추월 → deadlock
- 재현/디버깅 명령:
  ```
  python3 scripts/log_parser/analyze.py logs/20260505_1405/ --topology --rail-dir public/railConfig/cop --edge-idx 246 --node-idx 215
  python3 scripts/log_parser/analyze.py logs/20260505_1405/ --ratio-jump --veh 118
  python3 scripts/log_parser/analyze.py logs/20260505_1405/ --lock-node 215 --from 8300000 --to 8500000
  ```
