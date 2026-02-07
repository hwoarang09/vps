# Log System - AI Context

## Overview

Edge Transit 로그 시스템. 시뮬레이션 중 차량이 Edge를 통과할 때마다 기록.

**핵심 특징:**
- OPFS (Origin Private File System)에 바이너리 포맷으로 저장
- fabId별로 파일 분리 (`edge_transit_{sessionId}_fab{fabId}.bin`)
- 각 레코드에 vehId가 포함되어 외부 도구로 차량별 분리 가능
- Zero-Copy Transfer로 메모리 효율 극대화

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Main Thread                                  │
│  ┌─────────────────┐      ┌─────────────────────────────────────┐  │
│  │ LoggerController│ ───► │ logger.worker.ts (Logger Worker)    │  │
│  │ (API 제공)      │      │  - OPFS 파일 관리                   │  │
│  └─────────────────┘      │  - fabId별 파일 핸들                │  │
│                           └─────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
          ▲ MessagePort
          │
┌─────────────────────────────────────────────────────────────────────┐
│                         Sim Worker                                   │
│  ┌─────────────────┐                                                │
│  │   LogBuffer     │  fabId별 버퍼 → LOG_BY_FAB 메시지 전송        │
│  └─────────────────┘                                                │
└─────────────────────────────────────────────────────────────────────┘
```

## File Map

```yaml
src/logger/protocol.ts
  purpose: 바이너리 프로토콜 정의

  constants:
    LOG_RECORD_SIZE: 28 bytes
    LOG_BUFFER_SIZE: 4096 bytes (~146 records)
    CLOUD_UPLOAD_THRESHOLD: 5MB

  record layout (28 bytes):
    - timestamp   : Uint32  (4B, offset 0)  - 기록 시점 (ms)
    - workerId    : Uint8   (1B, offset 4)  - 워커 ID
    - fabId       : Uint8   (1B, offset 5)  - Fab ID
    - edgeId      : Uint16  (2B, offset 6)  - Edge 인덱스
    - vehId       : Uint32  (4B, offset 8)  - Vehicle ID
    - enterTime   : Uint32  (4B, offset 12) - Edge 진입 시점
    - exitTime    : Uint32  (4B, offset 16) - Edge 통과 시점
    - edgeLength  : Float32 (4B, offset 20) - Edge 길이 (m)
    - edgeType    : Uint8   (1B, offset 24) - EdgeType enum
    - padding     : 3B      (offset 25)     - 4-byte alignment

  message types:
    Worker → Logger:
      - LOG_BY_FAB: { fabId, buffer }
    Logger → Main:
      - FAB_ID_LIST: { fabIds: number[] }
      - DOWNLOADED: { buffer, fileName, recordCount }

  utilities:
    - packRecord(view, offset, record)
    - unpackRecord(view, offset): EdgeTransitRecord
    - unpackAllRecords(buffer, recordCount)

src/logger/LogBuffer.ts
  purpose: SimWorker에서 로그 수집 (Double Buffering)

  config:
    workerId: number
    fabId: number

  key methods:
    - setLoggerPort(port): Logger Worker 연결
    - logEdgeTransit(...): 로그 기록 (버퍼 가득 차면 자동 flush)
    - flush(): fabId 정보와 함께 Logger Worker로 전송
    - getRecordCount(): 현재 버퍼의 레코드 수
    - getFabId(): 현재 fabId

  data flow:
    logEdgeTransit() → buffer에 기록
    → MAX_RECORDS_PER_BUFFER 도달 시 flush()
    → LOG_BY_FAB 메시지로 Logger Worker 전송

src/logger/logger.worker.ts
  purpose: OPFS에 로그 저장하는 전용 Worker

  state:
    - mode: "OPFS" | "CLOUD"
    - sessionId: string
    - fabFileHandles: Map<number, FabFileHandle>

  file naming:
    - 통합: edge_transit_{sessionId}.bin
    - fab별: edge_transit_{sessionId}_fab{fabId}.bin

  key functions:
    - processLogByFabOPFS(fabId, buffer): fab별 파일에 기록
    - getOrCreateFabFileHandle(fabId): 파일 핸들 생성/조회
    - downloadByFabOPFS(fabId): 특정 fab 파일 다운로드
    - listFabIds(): 현재 세션의 fabId 목록 조회

  message handling:
    - INIT: 초기화 (mode, sessionId)
    - LOG_BY_FAB: fab별 파일에 기록
    - FLUSH: 모든 핸들 flush
    - CLOSE: 핸들 정리 및 종료
    - DOWNLOAD_BY_FAB: fab별 파일 다운로드
    - LIST_FAB_IDS: fabId 목록 조회

src/logger/LoggerController.ts
  purpose: Main Thread에서 Logger Worker 제어

  lifecycle:
    1. new LoggerController(config)
    2. await init()
    3. createPortForWorker() → SimWorker에 전달
    4. flush() / close()

  key methods:
    - init(): Worker 초기화
    - createPortForWorker(): SimWorker용 MessagePort 생성
    - flush(): 버퍼 플러시
    - close(): Worker 종료
    - download(): 현재 로그 다운로드
    - listFiles(): OPFS 파일 목록
    - listFabIds(): fabId 목록 조회
    - downloadByFab(fabId): fab별 파일 다운로드
    - deleteFile(fileName): 파일 삭제
    - deleteAllFiles(): 전체 삭제

src/logger/downloadLog.ts
  purpose: OPFS 로그 파일 다운로드 유틸리티

  functions:
    - downloadLogFromOPFS(sessionId): 세션 파일 다운로드
    - listLogFiles(): 전체 파일 목록
    - deleteLogFile(fileName): 파일 삭제
    - downloadLogFile(fileName): 특정 파일 다운로드
    - clearAllLogs(excludeSessionId?): 전체 삭제 (현재 세션 제외)

src/logger/DevLogger.ts
  purpose: 개발용 텍스트 로거 (OPFS text 파일, veh별 분리)

  environments:
    - Main Thread: Worker 통해 비동기 저장
    - Sim Worker: 직접 OPFS SyncAccessHandle 사용

  file structure (OPFS dev_logs/):
    - {workerId}_global.txt  : 전역 로그
    - {workerId}_veh{N}.txt  : veh별 로그

  state:
    - opfsGlobalHandle: 전역 로그 핸들
    - opfsVehHandles: Map<vehId, {handle, offset}>
    - pendingVehLogs: Map<vehId, Uint8Array[]>  # 핸들 생성 중 버퍼
    - creatingVehHandles: Set<vehId>  # 생성 중인 핸들 추적

  key methods:
    - init(workerId?): OPFS 초기화
    - debug/info/warn/error(msg): 전역 로그
    - vehDebug/vehInfo/vehWarn/vehError(vehId, msg): veh별 로그
    - flush(): 모든 핸들 flush
    - dispose(): 핸들 정리

  async handle creation:
    - ensureVehHandle(vehId, bytes): 핸들 생성 + 버퍼링
    - 핸들 생성 중 로그는 pendingVehLogs에 버퍼링
    - 핸들 생성 완료 후 버퍼된 로그 일괄 기록

  usage:
    import { devLog } from "@/logger";
    devLog.info("global message");
    devLog.veh(vehId).debug("veh-specific message");

src/logger/devLogUtils.ts
  purpose: DevLogger OPFS 파일 관리 유틸리티

  functions:
    - listDevLogFiles(): 파일 목록 조회
    - downloadDevLogFile(fileName): 단일 파일 다운로드
    - downloadMergedDevLogs(fileNames): 여러 파일 병합 다운로드
    - downloadAllDevLogs(): 전체 다운로드
    - deleteDevLogFile(fileName): 단일 삭제
    - deleteDevLogFiles(fileNames): 여러 파일 삭제
    - clearAllDevLogs(): 전체 삭제 (잠긴 파일 제외)
```

## Usage Example

```typescript
// 1. LoggerController 초기화 (Main Thread)
const logger = new LoggerController({
  mode: "OPFS",
  sessionId: `session_${Date.now()}`,
});
await logger.init();

// 2. SimWorker에 MessagePort 전달
const port = logger.createPortForWorker();
simWorker.postMessage({ type: "LOGGER_PORT", port }, [port]);

// 3. SimWorker에서 LogBuffer 사용
const logBuffer = new LogBuffer({ workerId: 0, fabId: 0 });
logBuffer.setLoggerPort(port);

// 로그 기록
logBuffer.logEdgeTransit(
  timestamp,  // 시뮬 시간 (ms)
  edgeId,     // Edge 인덱스
  vehId,      // Vehicle ID
  enterTime,  // 진입 시점
  exitTime,   // 통과 시점
  edgeLength, // Edge 길이 (m)
  "LINEAR"    // EdgeType
);

// 4. 다운로드 (Main Thread)
const fabIds = await logger.listFabIds();
for (const fabId of fabIds) {
  const { buffer, fileName } = await logger.downloadByFab(fabId);
  // buffer를 파일로 저장
}

// 5. 종료
await logger.close();
```

## Binary File Format

```
┌─────────────────────────────────────────────────────────────┐
│ edge_transit_{sessionId}_fab{fabId}.bin                     │
├─────────────────────────────────────────────────────────────┤
│ Record 0 (28 bytes)                                         │
│   [timestamp:4][wid:1][fid:1][eid:2][vid:4][enter:4]       │
│   [exit:4][len:4][type:1][pad:3]                           │
├─────────────────────────────────────────────────────────────┤
│ Record 1 (28 bytes)                                         │
│   ...                                                       │
├─────────────────────────────────────────────────────────────┤
│ Record N (28 bytes)                                         │
│   ...                                                       │
└─────────────────────────────────────────────────────────────┘

Total records = fileSize / 28
```

## External Tool Integration

fab별 파일에서 vehId별로 분리하는 외부 도구 예시:

```python
import struct

RECORD_SIZE = 28
RECORD_FORMAT = '<IBBHIIIfB3x'  # little-endian

def split_by_veh(fab_file_path):
    veh_records = {}

    with open(fab_file_path, 'rb') as f:
        while True:
            data = f.read(RECORD_SIZE)
            if not data:
                break

            record = struct.unpack(RECORD_FORMAT, data)
            veh_id = record[4]  # vehId at index 4

            if veh_id not in veh_records:
                veh_records[veh_id] = []
            veh_records[veh_id].append(data)

    # vehId별 파일 저장
    for veh_id, records in veh_records.items():
        with open(f'veh_{veh_id}.bin', 'wb') as f:
            f.write(b''.join(records))
```

## Critical Rules

1. **Thread 분리**: LogBuffer는 SimWorker에서만, LoggerController는 Main Thread에서만 사용
2. **Zero-Copy**: `ArrayBuffer.slice()`로 전송, `postMessage` transferable 사용
3. **파일 핸들 관리**: fabId당 하나의 SyncAccessHandle만 유지
4. **비동기 초기화**: 파일 핸들 생성 중 버퍼링으로 데이터 손실 방지

## Impact Map

| 수정 | 확인 필요 |
|------|-----------|
| protocol.ts 메시지 타입 | logger.worker.ts, LogBuffer.ts, LoggerController.ts |
| LogBuffer 버퍼 전략 | SimWorker에서 사용하는 모든 코드 |
| logger.worker 파일명 패턴 | downloadLog.ts, 외부 분석 도구 |
| LoggerController API | UI 컴포넌트 (LogFileManager 등) |

## Debugging

```typescript
// Logger Worker 상태 확인
const files = await logger.listFiles();
console.log('[Logger] OPFS files:', files);

const fabIds = await logger.listFabIds();
console.log('[Logger] Active fabIds:', fabIds);

// LogBuffer 상태 확인 (SimWorker 내부)
console.log('[LogBuffer] recordCount:', logBuffer.getRecordCount());
console.log('[LogBuffer] fabId:', logBuffer.getFabId());
```

## Log Analysis Tool (Python)

```yaml
tools/log_parser/
  venv/                    # Python 가상환경
  log_parser.py            # 바이너리 로그 파서 (.bin)
  sim_log_parser.py        # 텍스트 로그 파서 (.txt, 1GB+ 지원)
  requirements.txt
```

### sim_log_parser.py 사용법

```bash
# 가상환경 활성화
source tools/log_parser/venv/bin/activate

# 기본 요약
python sim_log_parser.py <파일.txt>

# 차량별 요약
python sim_log_parser.py <파일.txt> --veh-summary

# 태그별 요약
python sim_log_parser.py <파일.txt> --tag-summary

# ERROR/WARN만 보기
python sim_log_parser.py <파일.txt> --level ERROR WARN

# 특정 차량만
python sim_log_parser.py <파일.txt> --veh 24

# 메시지 검색
python sim_log_parser.py <파일.txt> --search "deadlock"

# 시간 범위 필터링
python sim_log_parser.py <파일.txt> --from 00:10:00 --to 00:15:00

# veh별 파일 분리
python sim_log_parser.py <파일.txt> --split ./output

# 필터링 후 파일 저장
python sim_log_parser.py <파일.txt> --level ERROR -o errors.txt
```

### 텍스트 로그 포맷

```
[HH:MM:SS.mmm] [LEVEL] [scope] [file:line] [tag] message

Examples:
[00:05:08.469] [INFO ] [global] [LockMgr.ts:238] [LockMgr] strategyType=BATCH
[00:12:00.981] [DEBUG] [veh:24] [LockMgr.ts:496] [requestLock] 상세: ...
```

## 차량 정지 원인 분석 (Vehicle Stuck Analysis)

사용자가 "로그 분석해줘", "왜 멈췄는지 확인해줘" 등 요청 시 아래 절차를 따른다.

### 로그 파일 위치

- **기본 경로**: `/mnt/c/dev/` (Windows 공유 폴더)
- `ls /mnt/c/dev/*.txt` 로 파일 확인

### 분석 절차

#### Step 1: 대상 차량 로그 추출

```bash
# python3 사용 (python 아님!)
python3 tools/log_parser/sim_log_parser.py <파일> --veh <N> --no-global --limit 5000
```

#### Step 2: 핵심 이벤트 추출 (Python 인라인 스크립트)

반복되는 프레임 로그를 제거하고 **상태 변화만** 추출한다. 아래 패턴의 python3 인라인 스크립트를 사용:

```python
python3 -c "
import re

LOG_PATTERN = re.compile(
    r'\[(\d{2}:\d{2}:\d{2}\.\d{3})\]\s*'
    r'\[(\w+)\s*\]\s*'
    r'\[([^\]]+)\]\s*'
    r'\[([^\]]+)\]\s*'
    r'\[([^\]]+)\]\s*'
    r'(.*)'
)

# processCP 상태 변화만 추출 (ratio 변화 무시하여 중복 제거)
last_msg = None
with open('<파일>', 'r') as f:
    for line in f:
        if 'veh:<N>' not in line:
            continue
        m = LOG_PATTERN.match(line.strip())
        if not m:
            continue
        tag = m.group(5)
        if tag != 'processCP':
            continue
        msg = m.group(6)
        ts = m.group(1)
        key = re.sub(r'curR=[\d.]+', 'curR=X', msg)
        if key != last_msg:
            print(f'[{ts}] {msg}')
            last_msg = key
"
```

#### Step 3: 시점별 상태 정밀 추출

문제 시점 전후의 **모든** veh 로그를 시간 범위로 추출:

```python
python3 -c "
import re
# ... LOG_PATTERN ...
with open('<파일>', 'r') as f:
    for line in f:
        if 'veh:<N>' not in line:
            continue
        m = LOG_PATTERN.match(line.strip())
        if not m:
            continue
        ts = m.group(1)
        if '<시작시간>' <= ts <= '<끝시간>':
            print(f'[{ts}] [{m.group(5)}] [{m.group(4)}] {m.group(6)}')
"
```

#### Step 4: 분석 보고서 작성

아래 항목을 **시점별로** 정리:

| 항목 | 설명 |
|------|------|
| **currentEdge** | 차량이 현재 어느 Edge 위에 있는지 |
| **ratio** | Edge 위의 위치 (0.0=시작, 1.0=끝) |
| **nextEdges** | `[N1, N2, N3, N4, N5]` - 앞으로 갈 Edge 목록 |
| **pathBuf** | 전체 경로 버퍼 (남은 경로) |
| **checkpoint** | 현재 CP의 edge, ratio, flags, head |
| **CP flags 의미** | PREP=다음 edge 채우기, REQ=lock 요청, WAIT=lock 대기 |
| **CP target** | PREP의 목표 edge (여기까지 nextEdges를 채움) |
| **처리 결과** | HIT 후 어떻게 됐는지 (flags→0? 다음 CP 로드?) |

#### 보고서 포맷 예시

```
### 시점 N: CP#X HIT (HH:MM:SS.mmm) - E???@ratio FLAGS→TARGET

  currentEdge = EXXX, ratio = X.XXX
  nextEdges   = [N1, N2, N3, N4, N5]
  pathBuf     = [...] len=XX
  checkpoint  = head=X, cpE=XXX, cpR=X.XXX, flags=X(의미)

  처리: (무슨 flag가 어떻게 처리됐는지)
  결과: (nextEdges 변화, flags 변화, 다음 CP 로드 여부)
```

### 핵심 로그 태그 해석

| 태그 | 의미 |
|------|------|
| `[processCP]` | Checkpoint 처리 (HIT/SKIP ratio/SKIP edge mismatch) |
| `[loadNextCP]` | 다음 Checkpoint 로드 (head 증가) |
| `[MOVE_PREP]` | PREP flag 처리 - nextEdges에 edge 채우기 |
| `[next_edge_memory] ENTER` | Edge 끝 도달, 전환 시도 |
| `[next_edge_memory] LOOP` | nextEdgeIdx로 다음 edge 전환 |
| `[SHIFT]` | pathBuf/nextEdges 이동 (edge 전환 완료) |
| `[fillNextEdges]` | checkpoint 외 방식으로 nextEdges 채우기 시도 |
| `[checkpoint] Created` | 경로에 대한 checkpoint 목록 생성 |
| `[pathBuff] DIJKSTRA` | 경로 탐색 결과 |

### Checkpoint Flags 값

| 값 | 이름 | 의미 |
|----|------|------|
| 1 | LOCK_REQUEST | Lock 요청 |
| 2 | LOCK_WAIT | Lock 대기 (멈춰야 함) |
| 4 | LOCK_RELEASE | Lock 해제 |
| 8 | MOVE_PREPARE (PREP) | nextEdges에 targetEdge까지 채우기 |
| 9 | REQ\|PREP | Lock 요청 + nextEdges 채우기 |

### 흔한 정지 패턴

1. **WAIT 미처리 → edge mismatch**: WAIT CP에서 lock 못 받았는데 차량이 안 멈추고 다음 edge로 넘어감 → CP head가 stuck → 이후 PREP가 실행 안 돼서 nextEdges 비어서 정지
2. **nextEdges 고갈**: PREP가 제때 실행되지 않아 nextEdges=[0,0,0,0,0] 상태로 edge 끝 도달
3. **pathBuf 비어있음**: 경로가 할당 안 됨
4. **checkpoint 없음**: count=0, 경로 할당 전

## Log Throttling

반복 로그 방지를 위한 throttle 적용 (2초):

```yaml
vehiclePosition.ts:
  MergeLockLogState: 상태 변경 또는 2초 경과 시에만 [MERGE_WAIT] 로그

edgeTransition.ts:
  EdgeTransitionLogState: 상태 변경 또는 2초 경과 시에만 로그
  - [EDGE_TRANSITION] blocked/대기
  - [next_edge_memory] ENTER (ratio >= 1일 때만)
  - LOOP# (첫 번째 루프만)
```
