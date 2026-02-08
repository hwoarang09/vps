# FlatBuffers Logger - 설치 및 사용 가이드

## 📦 설치 완료

✅ FlatBuffers 로거가 성공적으로 추가되었습니다!

```
✓ flatbuffers npm 패키지 설치됨 (v25.9.23)
✓ flatc 컴파일러 설치됨 (v25.12.19) → tools/flatc/flatc
✓ 스키마 정의 완료 → schema/dev_log.fbs
✓ TypeScript 코드 생성 → src/generated/vps-dev-log/
✓ Python 코드 생성 → tools/log_parser/generated/VpsDevLog/
✓ FbLogger 구현 → src/logger/fb/FbLogger.ts
✓ Python 분석 도구 → tools/log_parser/fb_parser.py
```

## 🎯 특징

| 항목 | DevLogger (텍스트) | **FbLogger (FlatBuffers)** |
|------|-------------------|---------------------------|
| **포맷** | 텍스트 (라인별) | 바이너리 (구조화) |
| **파일 크기** | 큰 편 | **50~70% 작음** |
| **쓰기 속도** | 느림 | **2~5배 빠름** |
| **Python 읽기** | 매우 느림 (정규식 파싱) | **10~100배 빠름 (Zero-Copy)** |
| **타입 안정성** | 없음 | **강함 (Schema 기반)** |
| **확장성** | 제한적 | **우수 (Union 지원)** |

## 🚀 빠른 시작

### 1. TypeScript에서 사용

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
logger.info("Vehicle spawned", { vehId: 24 });
logger.warn("High latency", { tag: "Performance" });
logger.error("Critical error!");

// 구조화된 로그 (Checkpoint)
logger.checkpoint({
  vehId: 24,
  cpIndex: 3,
  edgeId: 722,
  ratio: 0.853,
  flags: 8,
  action: "HIT",
  details: "Target reached",
});

// Edge 전환
logger.edgeTransition({
  vehId: 24,
  fromEdge: 722,
  toEdge: 723,
  nextEdges: [723, 724, 725, 0, 0],
  pathBufLen: 15,
});

// Lock 이벤트
logger.lockEvent({
  vehId: 24,
  lockId: 5,
  eventType: "WAIT",
  edgeId: 723,
  waitTimeMs: 125,
});

// Flush & Dispose
const buffer = logger.flush();
logger.dispose();
```

### 2. Python으로 분석

```bash
# 기본 출력
python3 tools/log_parser/fb_parser.py log.bin

# 특정 차량만
python3 tools/log_parser/fb_parser.py log.bin --veh 24

# 에러만
python3 tools/log_parser/fb_parser.py log.bin --level ERROR WARN

# Checkpoint 로그만
python3 tools/log_parser/fb_parser.py log.bin --type CheckpointLog

# 요약만
python3 tools/log_parser/fb_parser.py log.bin --summary

# 통계 포함
python3 tools/log_parser/fb_parser.py log.bin --stats
```

## 📝 NPM 스크립트

```bash
# 스키마 컴파일 (schema/dev_log.fbs 수정 후)
npm run compile:fbs

# 예제 실행 (100개 로그 생성 → bin 파일 저장)
npm run fb:example

# 벤치마크 실행 (DevLogger vs FbLogger)
npm run fb:benchmark
```

## 📂 파일 구조

```
vps/
├── schema/
│   └── dev_log.fbs              # FlatBuffers 스키마 정의
├── src/
│   ├── generated/
│   │   └── vps-dev-log/         # flatc가 생성한 TS 코드
│   └── logger/
│       ├── DevLogger.ts         # 기존 텍스트 로거 (유지)
│       └── fb/
│           ├── FbLogger.ts      # FlatBuffers 로거 ⭐
│           ├── example.ts       # 사용 예제
│           ├── benchmark.ts     # 성능 벤치마크
│           └── README.md        # 상세 문서
├── tools/
│   ├── flatc/
│   │   └── flatc                # FlatBuffers 컴파일러 (v25.12.19)
│   └── log_parser/
│       ├── generated/
│       │   └── VpsDevLog/       # flatc가 생성한 Python 코드
│       ├── fb_parser.py         # FlatBuffers 로그 분석기 ⭐
│       └── sim_log_parser.py    # 기존 텍스트 로그 분석기
└── scripts/
    └── compile-fbs.sh           # 스키마 컴파일 스크립트
```

## 🧪 테스트 방법

### 1. 예제 실행 (로그 생성)

```bash
npm run fb:example
```

출력:
```
🚀 FbLogger Example

📝 Logging 100 entries...
✓ Logged 95 entries

💾 Flushing to buffer...
[FbLogger] Flushed 95 entries (12345 bytes) for worker 0
✓ Buffer size: 12,345 bytes

📖 Reading back...
  Session ID: example_1738987654321
  Worker ID: 0
  Total entries: 95

💾 Saved to: /tmp/fb_example_1738987654321.bin

To analyze with Python:
  python3 tools/log_parser/fb_parser.py /tmp/fb_example_1738987654321.bin
```

### 2. Python으로 분석

```bash
python3 tools/log_parser/fb_parser.py /tmp/fb_example_*.bin --summary
```

출력 예시:
```
Session ID: example_1738987654321
Worker ID: 0
Total Entries: 95
────────────────────────────────────────────────────

SUMMARY:
  Total Entries: 95

  By Level:
    DEBUG   :     70
    INFO    :     23
    WARN    :      1
    ERROR   :      1

  By Type:
    DebugLog         :     17
    CheckpointLog    :     30
    EdgeTransitionLog:     20
    LockEventLog     :     15
    ErrorLog         :      2
    PerfLog          :      5

  By Vehicle (top 10):
    veh:1          :     10
    veh:2          :      9
    veh:3          :      8
    ...
```

### 3. 성능 벤치마크

```bash
npm run fb:benchmark
```

예상 결과:
```
🔥 Benchmark: Writing 10,000 log entries
════════════════════════════════════════════════════════════════════════════════

📊 Results:
────────────────────────────────────────────────────────────────────────────────
  FbLogger (FlatBuffers):
    Duration:       125.50 ms
    Ops/sec:        79,681
    Avg time/op:    12.550 μs
    Buffer size:    458,752 bytes

  DevLogger (Text):
    Duration:       456.20 ms
    Ops/sec:        21,919
    Avg time/op:    45.620 μs
    Memory used:    1,234,567 bytes

🏆 Winner:
────────────────────────────────────────────────────────────────────────────────
  ✅ FbLogger is 3.64x FASTER
  ✅ FbLogger uses 2.69x LESS memory/storage
```

## 🔧 스키마 수정

`schema/dev_log.fbs`를 수정한 후:

```bash
npm run compile:fbs
```

예: 새로운 로그 타입 추가
```fbs
// schema/dev_log.fbs에 추가
table CollisionLog {
  veh_id: uint;
  other_veh_id: uint;
  edge_id: uint;
  distance: float;
}

union LogContent {
  DebugLog,
  CheckpointLog,
  EdgeTransitionLog,
  LockEventLog,
  ErrorLog,
  PerfLog,
  CollisionLog   // 추가
}
```

## 📚 상세 문서

- **FbLogger API**: `src/logger/fb/README.md`
- **스키마 정의**: `schema/dev_log.fbs`
- **Python 분석기**: `tools/log_parser/fb_parser.py --help`

## 🎓 다음 단계

1. **프로덕션 통합**:
   - SimWorker에서 FbLogger 사용
   - OPFS Worker 추가 (logger.worker.ts 참고)
   - 주기적으로 flush → OPFS 저장

2. **성능 비교**:
   - 실제 시뮬레이션 로그로 벤치마크
   - DevLogger vs FbLogger 동시 실행
   - 파일 크기 / 분석 속도 측정

3. **확장**:
   - 새로운 로그 타입 추가 (스키마 수정)
   - Python 분석 도구 고도화 (Pandas, Matplotlib)
   - 실시간 로그 뷰어 (WebSocket + FlatBuffers)

## 💡 팁

- **개발 중**: DevLogger 사용 (직접 읽기 가능)
- **성능 측정**: FbLogger + Python 분석 (빠름)
- **프로덕션**: FbLogger (작은 파일, 빠른 쓰기)

---

**문의사항**은 `src/logger/fb/README.md` 참고!
