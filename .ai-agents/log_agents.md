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

```bash
python scripts/log_parser/log_parser.py /path/to/session_xxx_edge_transit.bin --summary
python scripts/log_parser/log_parser.py /path/to/ --session session_xxx --export-csv ./output/
```

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
