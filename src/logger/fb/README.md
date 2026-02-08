# FbLogger - FlatBuffers Logger

FlatBuffers 기반 고성능 로거. DevLogger와 성능 비교를 위해 추가됨.

## 특징

- ✅ **Zero-Copy 읽기**: Python 분석 시 파싱 부하 없음
- ✅ **타입 안정성**: TS ↔ Python 자동 동기화
- ✅ **압축된 바이너리**: 텍스트 대비 50~70% 작은 파일 크기
- ✅ **확장성**: Union으로 다양한 로그 타입 지원
- ✅ **구조화**: 로그 타입별 필드 정의 (DebugLog, CheckpointLog, EdgeTransitionLog 등)

## 파일 구조

```
src/logger/fb/
  ├── FbLogger.ts           # 메인 로거
  ├── benchmark.ts          # 성능 벤치마크
  └── README.md             # 이 파일

schema/dev_log.fbs          # FlatBuffers 스키마
src/generated/vps-dev-log/  # 생성된 TS 코드
tools/log_parser/
  ├── generated/VpsDevLog/  # 생성된 Python 코드
  └── fb_parser.py          # Python 분석 도구
```

## 사용법

### TypeScript (로그 기록)

```typescript
import { FbLogger } from "@/logger/fb/FbLogger";

// 로거 생성
const logger = new FbLogger({
  sessionId: "my-session",
  workerId: 0,
  flushInterval: 5000, // 5초마다 자동 flush
});

// 일반 로그
logger.debug("Starting simulation", { vehId: 0, tag: "SimEngine" });
logger.info("Vehicle spawned", { vehId: 24, tag: "VehicleMgr" });
logger.warn("High latency detected", { tag: "Performance" });
logger.error("Critical error", { tag: "System" });

// Checkpoint 로그 (구조화)
logger.checkpoint({
  vehId: 24,
  cpIndex: 3,
  edgeId: 722,
  ratio: 0.853,
  flags: 8, // MOVE_PREPARE
  action: "HIT",
  details: "Target reached",
});

// Edge 전환 로그
logger.edgeTransition({
  vehId: 24,
  fromEdge: 722,
  toEdge: 723,
  nextEdges: [723, 724, 725, 0, 0],
  pathBufLen: 15,
});

// Lock 이벤트 로그
logger.lockEvent({
  vehId: 24,
  lockId: 5,
  eventType: "WAIT",
  edgeId: 723,
  waitTimeMs: 125,
});

// 성능 로그
logger.perf({
  fps: 60.0,
  memoryMb: 256.5,
  activeVehicles: 1500,
  lockQueueSize: 23,
});

// 수동 flush
const buffer = logger.flush();
// buffer를 OPFS나 서버로 전송...

// 종료
logger.dispose();
```

### Python (로그 분석)

```bash
# 기본 출력
python3 tools/log_parser/fb_parser.py log.bin

# 특정 차량만
python3 tools/log_parser/fb_parser.py log.bin --veh 24

# 에러만
python3 tools/log_parser/fb_parser.py log.bin --level ERROR WARN

# 특정 타입만
python3 tools/log_parser/fb_parser.py log.bin --type CheckpointLog EdgeTransitionLog

# 요약만
python3 tools/log_parser/fb_parser.py log.bin --summary

# 통계 포함
python3 tools/log_parser/fb_parser.py log.bin --stats
```

### Python (프로그래밍)

```python
from VpsDevLog import LogBatch, LogEntry, LogContent
from VpsDevLog import CheckpointLog

# 파일 읽기
with open("log.bin", "rb") as f:
    data = f.read()

batch = LogBatch.LogBatch.GetRootAs(data, 0)

# 로그 순회
for i in range(batch.LogsLength()):
    entry = batch.Logs(i)

    # Union 타입 확인
    if entry.ContentType() == LogContent.LogContent.CheckpointLog:
        content = CheckpointLog.CheckpointLog()
        content.Init(entry.Content().Bytes, entry.Content().Pos)

        print(f"CP#{content.CpIndex()} veh:{content.VehId()} "
              f"E{content.EdgeId()}@{content.Ratio():.3f}")
```

## 성능 벤치마크

```bash
# 10,000 로그 엔트리 벤치마크
npm run benchmark:fb-logger

# 커스텀 반복 횟수
npm run benchmark:fb-logger 50000
```

예상 결과:
- **쓰기 속도**: FbLogger가 DevLogger보다 2~5배 빠름
- **파일 크기**: FbLogger가 50~70% 작음
- **읽기 속도**: Python에서 10~100배 빠름 (파싱 없음)

## 스키마 수정

스키마를 수정하려면:

1. `schema/dev_log.fbs` 수정
2. 코드 재생성:
   ```bash
   # TypeScript
   ./tools/flatc/flatc --ts -o src/generated schema/dev_log.fbs

   # Python
   ./tools/flatc/flatc --python -o tools/log_parser/generated schema/dev_log.fbs
   ```

## 로그 타입 (Union)

| 타입 | 용도 | 주요 필드 |
|------|------|-----------|
| `DebugLog` | 일반 디버그 로그 | vehId, tag, message |
| `CheckpointLog` | Checkpoint 처리 | cpIndex, edgeId, ratio, flags, action |
| `EdgeTransitionLog` | Edge 전환 | fromEdge, toEdge, nextEdges |
| `LockEventLog` | Lock 이벤트 | lockId, eventType, edgeId, waitTimeMs |
| `ErrorLog` | 에러/경고 | errorCode, message, stackTrace |
| `PerfLog` | 성능 메트릭 | fps, memoryMb, activeVehicles |

## DevLogger와 비교

| 항목 | DevLogger | FbLogger |
|------|-----------|----------|
| 포맷 | 텍스트 | 바이너리 |
| 파일 크기 | 큰 편 | 작음 (50~70%) |
| 쓰기 속도 | 느림 | 빠름 (2~5배) |
| Python 읽기 | 매우 느림 (파싱) | 매우 빠름 (Zero-Copy) |
| 가독성 | 높음 (직접 읽기 가능) | 낮음 (도구 필요) |
| 확장성 | 제한적 | 우수 (Union) |
| 타입 안정성 | 없음 | 강함 (Schema) |

## 마이그레이션 팁

기존 DevLogger 코드를 FbLogger로 전환:

```typescript
// Before (DevLogger)
devLog.veh(vehId).debug("[processCP] HIT detected");

// After (FbLogger)
logger.checkpoint({
  vehId,
  cpIndex,
  edgeId,
  ratio,
  flags,
  action: "HIT",
});
```

구조화된 로그로 전환하면 Python 분석이 훨씬 쉬워진다:
- 필드별 필터링 가능
- 타입 안정성
- 쿼리 성능 향상
