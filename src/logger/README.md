# Edge Transit Logger

시뮬레이션 중 Vehicle의 Edge 통과 기록을 바이너리로 수집하고 파일로 저장하는 시스템.

## 구조

```
logger/
├── protocol.ts              # 바이너리 프로토콜 정의 (28 bytes/record)
├── LogBuffer.ts             # Worker 내 버퍼 (4KB, ~146 records)
├── EdgeTransitTracker.ts    # SimWorker에서 사용하는 트래커
├── logger.worker.ts         # 로그 수집 전용 워커
├── LoggerController.ts      # Main Thread 컨트롤러
├── downloadLog.ts           # OPFS 파일 다운로드 유틸리티
└── index.ts                 # Public exports
```

## 사용법

### 1. Main Thread에서 Logger 초기화

```typescript
import { LoggerController } from "@/logger";

// OPFS 모드로 초기화
const loggerController = new LoggerController({
  mode: "OPFS",
  sessionId: `sim_${Date.now()}`,
  onReady: () => console.log("Logger ready"),
  onClosed: (totalRecords) => console.log(`Logged ${totalRecords} records`),
  onError: (error) => console.error("Logger error:", error),
});

await loggerController.init();

// SimWorker에게 전달할 MessagePort 생성
const loggerPort = loggerController.createPortForWorker();
```

### 2. SimWorker에 MessagePort 전달

```typescript
// Main Thread에서
simWorker.postMessage(
  {
    type: "INIT_LOGGER",
    port: loggerPort,
  },
  [loggerPort]
);

// SimWorker에서
onmessage = (e) => {
  if (e.data.type === "INIT_LOGGER") {
    LogBuffer.setLoggerPort(e.data.port);
  }
};
```

### 3. SimWorker에서 로그 기록

```typescript
import { EdgeTransitTracker } from "@/logger";

// FabContext에 트래커 추가
const tracker = new EdgeTransitTracker(workerId, fabId);

// Vehicle이 Edge를 통과할 때
tracker.recordTransit(
  timestamp,
  edgeId,
  vehId,
  enterTime,
  exitTime,
  edgeLength,
  edgeType
);

// 시뮬레이션 종료 시
tracker.destroy();
```

### 4. 로그 파일 다운로드

```typescript
import {
  downloadLogFromOPFS,
  listLogFiles,
  deleteLogFile,
  clearAllLogs,
} from "@/logger";

// 저장된 로그 파일 목록 확인
const files = await listLogFiles();
console.log(files);
// [{ name: 'edge_transit_1234567890.bin', size: 11200, recordCount: 400 }]

// 특정 세션의 로그 다운로드
const result = await downloadLogFromOPFS("1234567890");
console.log(
  `Downloaded ${result.fileName} (${result.recordCount} records, ${result.fileSize} bytes)`
);

// 특정 로그 파일 삭제
await deleteLogFile("1234567890");

// 모든 로그 파일 삭제
const deletedCount = await clearAllLogs();
console.log(`Deleted ${deletedCount} log files`);
```

### 5. 시뮬레이션 종료 시

```typescript
// Logger 종료 및 파일 저장 완료
const totalRecords = await loggerController.close();
console.log(`Total records: ${totalRecords}`);

// 다운로드
await downloadLogFromOPFS(sessionId);
```

## 바이너리 포맷

각 레코드는 28 bytes:

| Field       | Type    | Size    | Offset | Description             |
| ----------- | ------- | ------- | ------ | ----------------------- |
| timestamp   | Uint32  | 4 bytes | 0      | 기록 시점 (tick, ms)    |
| workerId    | Uint8   | 1 byte  | 4      | 워커 ID (0~255)         |
| fabId       | Uint8   | 1 byte  | 5      | Fab ID (0~255)          |
| edgeId      | Uint16  | 2 bytes | 6      | Edge Index (0~65535)    |
| vehId       | Uint32  | 4 bytes | 8      | Vehicle ID (0~4B)       |
| enterTime   | Uint32  | 4 bytes | 12     | Edge 진입 시점 (ms)     |
| exitTime    | Uint32  | 4 bytes | 16     | Edge 통과 시점 (ms)     |
| edgeLength  | Float32 | 4 bytes | 20     | Edge 길이 (meters)      |
| edgeType    | Uint8   | 1 byte  | 24     | EdgeType enum index     |
| padding     | Uint8x3 | 3 bytes | 25     | 4-byte alignment        |

## 데이터 분석

```typescript
import { unpackAllRecords, EDGE_TYPE_REVERSE } from "@/logger";

// 바이너리 파일 로드 (예: fetch로 가져오기)
const response = await fetch("/logs/edge_transit_1234567890.bin");
const buffer = await response.arrayBuffer();

// 레코드 파싱
const recordCount = buffer.byteLength / 28;
const records = unpackAllRecords(buffer, recordCount);

// 분석
for (const record of records) {
  console.log(
    `Vehicle ${record.vehId} passed edge ${record.edgeId} ` +
      `(${EDGE_TYPE_REVERSE[record.edgeType]}) ` +
      `in ${record.exitTime - record.enterTime}ms`
  );
}
```

## 저장 모드

### OPFS (Origin Private File System)

- 브라우저 내부 파일시스템에 저장
- 빠른 쓰기 성능 (SyncAccessHandle 사용)
- 파일명: `edge_transit_{sessionId}.bin`
- 다운로드는 `downloadLogFromOPFS()` 사용

### CLOUD (미구현)

- S3/Cloudflare R2로 자동 업로드
- 5MB 단위로 chunk 업로드
- Presigned URL 필요 (TODO)

## 성능

- **버퍼 크기**: 4KB (~146 레코드)
- **레코드 크기**: 28 bytes
- **Flush 트리거**: 버퍼가 가득 차면 자동 전송
- **Zero-copy**: SharedArrayBuffer + DataView로 메모리 복사 최소화

## UI 통합 예시

```typescript
// SimulationController에서
async startSimulation() {
  const sessionId = `sim_${Date.now()}`;

  // Logger 초기화
  this.loggerController = new LoggerController({
    mode: "OPFS",
    sessionId,
    onClosed: async (totalRecords) => {
      console.log(`Simulation ended. ${totalRecords} records logged.`);

      // 자동 다운로드
      await downloadLogFromOPFS(sessionId);
    },
  });

  await this.loggerController.init();

  // SimWorker에 전달
  const loggerPort = this.loggerController.createPortForWorker();
  this.simWorker.postMessage({ type: "INIT_LOGGER", port: loggerPort }, [loggerPort]);

  // 시뮬레이션 시작...
}

async stopSimulation() {
  await this.loggerController.close();
}
```
