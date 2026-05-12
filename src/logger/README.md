# Logger — Worker → OPFS / MQTT 이중 로그 시스템

시뮬레이션 이벤트(차량 이동, lock 요청/해제, 주문 완료 등)를 **Worker 안에서** 매 step 기록한다. 60FPS × 수천 대 × 10여 종 이벤트라 hot path 부담이 극심하므로 IndexedDB 같은 async DB는 못 쓰고, **OPFS의 `FileSystemSyncAccessHandle`**로 binary 버퍼를 직접 쓴다. 옵션으로 MQTT publish도 병행 (학습용 DB 적재).

---

## 1. OPFS (Origin Private File System) 무엇

브라우저가 origin별로 제공하는 **격리된 파일 시스템**. localStorage / IndexedDB / FS Access API와는 별개의 새 API.

### 다른 저장 옵션과 비교

| API | Sync? | 용량 | 권한 prompt | 속도 | 적합? |
|-----|-------|------|------------|------|------|
| `localStorage` | sync | 5MB | × | 느림, string only | ❌ |
| `IndexedDB` | **async** | 수 GB | × | tx 오버헤드 큼 | ❌ (Worker hot path 못 견딤) |
| File System Access API | async | 무제한 | **✓** (불편) | 보통 | ❌ |
| **OPFS** | **Worker만 sync 가능** | 수 GB+ | × | **매우 빠름** (블록 raw write) | ✅ |

### 접근 방법

```typescript
// 모든 스레드 공통: 디렉토리 핸들
const root = await navigator.storage.getDirectory();
const fileHandle = await root.getFileHandle('mylog.bin', { create: true });

// === Main thread ===
const file = await fileHandle.getFile();   // 읽기만 가능 (async)

// === Worker thread (이게 핵심) ===
const handle = await fileHandle.createSyncAccessHandle();
handle.write(buffer, { at: offset });      // sync! 매우 빠름
handle.flush();
handle.close();
```

**핵심 제약**: `createSyncAccessHandle()`은 **Worker thread에서만** 호출 가능. Main thread는 OPFS를 async API로만 다룰 수 있음. 우리 시스템에서 Logger가 Worker 안에 사는 이유.

**라이프사이클**: 같은 파일에 대해 sync handle은 동시에 1개만 열림. 다음 세션이 같은 파일을 열려면 이전 handle을 `close()`해야 함 (`SimLogger.ts:163-166`에 100ms 재시도 패턴 있음).

---

## 2. 시스템 구조

```
Worker thread (FabContext)
  │
  ├─ FabContext.step()
  │   └─ executeSimulationStep(ctx):
  │       ├─ checkCollisions()
  │       ├─ lockMgr.updateAll(...)
  │       │   └─ onLockEvent 콜백 → simLogger.logLock(ts, vehId, nodeIdx, ...)
  │       ├─ updateMovement(...)
  │       │   └─ onEdgeTransit 콜백 → simLogger.logEdgeTransit(...)
  │       └─ autoMgr.update(...)
  │           └─ onPathFound 콜백 → simLogger.logPath(...)
  │
  ▼
SimLogger (logger/SimLogger.ts)
  │
  │  EventBuffer per EventType:
  │  ┌──────────────────────────────────┐
  │  │ ArrayBuffer (FLUSH_THRESHOLD ×    │
  │  │   recordSize bytes, 메모리상)     │
  │  │                                   │
  │  │ count = 누적 레코드 수            │
  │  │ handle = FileSystemSyncAccessHandle│
  │  │ fileOffset = 파일 누적 bytes      │
  │  └──────────────────────────────────┘
  │
  ├─ count >= 512 → _flushBuffer()
  │                  └─ handle.write(slice, { at: fileOffset })
  │                  └─ handle.flush()
  │
  ├─ 10초 주기 setInterval → flush() (데이터 유실 방지)
  │
  └─ dispose() → final flush + handle.close()

병행 (옵션):
  └─ DbShipper (logger/DbShipper.ts)
       └─ push(record) → 메모리 buffer
       └─ 5초 주기 또는 2000 레코드 → MQTT publish
            └─ topic: VPS/logs/{sessionId}/{fabId}/{eventType}
            └─ payload: binary (OPFS 포맷과 동일)
```

### 컴포넌트 한 줄 설명

| 파일 | 역할 |
|------|------|
| [`SimLogger.ts`](./SimLogger.ts) | 이벤트별 binary buffer + OPFS sync write. Worker 전용 |
| [`SnapshotLogger.ts`](./SnapshotLogger.ts) | 100ms 주기 전체 vehicle + edge queue 가변크기 snapshot |
| [`DbShipper.ts`](./DbShipper.ts) | MQTT publish (선택, OPFS와 병행 가능) |
| [`protocol.ts`](./protocol.ts) | 이벤트 enum, 레코드 크기, 파일명 규칙 |
| [`simLogUtils.ts`](./simLogUtils.ts) | Main thread용 — 파일 목록/다운로드/삭제 |

---

## 3. 이벤트 종류

### ML 이벤트 (학습용, 기본 on)

| EventType | 크기 | 내용 |
|-----------|-----:|------|
| `ML_ORDER_COMPLETE` | 44B | order 1건의 7-stage timestamp (pickup/drop) |
| `ML_EDGE_TRANSIT` | 24B | 차량이 edge 한 개를 통과한 시간 (EWMA / Dijkstra cost 학습용) |
| `ML_LOCK` | 16B | Lock REQUEST / GRANT / RELEASE / WAIT 이벤트 |
| `ML_REPLAY_SNAPSHOT` | 36B | 0.5초 + 속도→0 전환 시 vehicle 상태 (replay용) |

### Dev 이벤트 (디버그용, mode='dev'에서)

| EventType | 크기 | 내용 |
|-----------|-----:|------|
| `DEV_VEH_STATE` | 44B | 차량 전체 상태 (10~60Hz 설정) |
| `DEV_PATH` | 16B | Dijkstra 새 경로 (vehId, destEdge, pathLen) |
| `DEV_LOCK_DETAIL` | 20B | zone preempt / DZ gate 등 의심 케이스 |
| `DEV_TRANSFER` | 16B | edge 전환 이벤트 |
| `DEV_EDGE_QUEUE` | 16B | edgeVehicleQueue 변화 |
| `DEV_CHECKPOINT` | 24B | Lock checkpoint HIT / SKIP |

**모든 레코드는 고정 크기 + little-endian + DataView 직접 write** — 매 record 1번의 `setUint32` × 필드 수만 호출. JSON / serialize 없음.

### 파일명

```
{sessionId}_{fabId}_{eventType}.bin

예:
  20260512_1430_fab_0_0_edge_transit.bin    24B × N
  20260512_1430_fab_0_0_lock.bin            16B × N
  20260512_1430_fab_0_0_checkpoint.bin      24B × N
  20260512_1430_fab_0_0_snapshot.bin        가변 크기 block
```

fab별로 별도 파일 — 24 fab 시뮬이면 fab당 이벤트 종류 × 24 파일.

---

## 4. 사용 예제

### Worker 초기화 (이미 FabContext가 해줌)

```typescript
// shmSimulator/core/FabContext/index.ts
async setLoggerPort(port: MessagePort, workerId: number = 0): Promise<void> {
  this.simLogger = await setupLoggerPort(this.fabId, this.config, workerId);

  if (this.simLogger) {
    const sessionId = this.simLogger.getSessionId();
    this.snapshotLogger = new SnapshotLogger({ sessionId, fabId: this.fabId });
    await this.snapshotLogger.init();
  }
}
```

### Step 안에서 이벤트 기록 (logger/logger-setup.ts → SimLogger.init() 후)

```typescript
// simulation-step.ts 안
if (simLogger) {
  // Lock 이벤트는 LockMgr 콜백으로 등록
  lockMgr.setOnLockEvent((vehId, nodeIdx, eventType, waitMs, holderVehId) => {
    simLogger.logLock(simulationTime, vehId, nodeIdx, eventType, waitMs, holderVehId);
  });

  // Edge transit은 updateMovement 콜백
  movementCtx.onEdgeTransit = (vehId, fromEdge, toEdge, timestamp) => {
    if (enterTs > 0) {
      simLogger.logEdgeTransit(timestamp, vehId, fromEdge, enterTs, timestamp, edgeLen);
    }
  };
}

// Path는 autoMgr 콜백
autoMgr.onPathFound = (vehId, destEdge, pathLen) => {
  simLogger.logPath(simulationTime, vehId, destEdge, pathLen);
};
```

### 종료 / cleanup

```typescript
// FabContext.dispose()
this.simLogger?.dispose();        // → flush + handle.close()
this.snapshotLogger?.close();
```

`dispose()`를 안 부르고 탭만 닫아도 데이터는 안전 — `setInterval(10s)`로 주기적 flush + OPFS는 브라우저 종료 후에도 파일 유지. 단 직전 10초 분량은 in-memory에서 유실될 수 있음.

---

## 5. Main Thread에서 파일 관리

`simLogUtils.ts`가 Main에서 호출 가능한 헬퍼 제공.

```typescript
import { listSimLogFiles, downloadSimLogFile, clearAllSimLogs } from '@/logger';

// 파일 목록
const files = await listSimLogFiles();
// → [{ fileName: "20260512_..._edge_transit.bin", size: 24576,
//      recordCount: 1024, eventType: "edge_transit" }, ...]

// 다운로드 (브라우저 다운로드 폴더로)
await downloadSimLogFile("20260512_1430_fab_0_0_edge_transit.bin");

// 전체 삭제 (OPFS 정리)
const { deleted, failed } = await clearAllSimLogs();
```

UI에서 보통 LogControlPanel 같은 패널에서 위 함수를 호출 → 사용자가 .bin 파일을 다운로드 → Downloads 폴더에서 `logs/{sessionId}/`로 옮기고 Python parser로 분석.

---

## 6. 분석 워크플로우

```
Browser (Worker)
  ├─ OPFS에 .bin 파일 누적
  └─ (옵션) MQTT publish → PostgreSQL DB

         ↓ 사용자 다운로드 (simLogUtils.downloadSimLogFile)

Local: /mnt/c/Users/.../Downloads/*.bin

         ↓ mv → logs/{sessionId}/

scripts/log_parser/
  ├─ log_parser.py      # .bin → DataFrame
  ├─ analyze.py         # event 종류별 분석
  └─ snapshot_streaming.py   # 큰 snapshot.bin용 (>200MB 시 OOM 회피)
```

분석 모듈은 `.ai-agents/log_agents.md` "분석 도구" 섹션 참조.

---

## 7. 왜 이렇게 만들었나

### OPFS

브라우저에서 도는 시뮬레이션의 로그를 어딘가 영구 저장해야 했는데, 파일시스템에 바로 쓸 수 있는 방법이 OPFS였다. `localStorage`는 string 5MB 한계, `IndexedDB`는 async + tx 오버헤드라 매 step 수천 건 들어가는 hot path를 못 견디고, File System Access API는 매번 사용자 권한 prompt가 떠서 사용성이 떨어진다. OPFS는 Worker thread 안에서 sync로 raw byte를 그냥 write할 수 있어서 — 따로 직렬화 / 트랜잭션 없이 메모리 buffer를 그대로 파일에 떨어뜨릴 수 있다.

### Binary 포맷

회사에서 text로 로그 남기는 시스템을 봤는데, 차량 800대로 하루 돌려도 100GB 가까이 쌓였다. 그 정도면 분석은커녕 디스크 관리부터 부담이다. 그런데 정작 로그에서 중요한 건 **문제 생긴 부분만** 잘 보면 되는 거지, 평상시 정상 동작 로그를 GB 단위로 들고 있을 이유가 없다.

그래서 binary로 쌓기로 했다. 같은 정보를 text로 쓰면 timestamp / vehId / edge / status 한 줄에 수십 바이트 들어가는데, binary 고정 크기 record로 쓰면 16~44바이트로 끝난다 — text 대비 5~10배 압축. 분석할 때 Python에서 `numpy.fromfile`로 한 번에 읽으면 되니까 파싱 비용도 거의 0. 문제 생긴 구간만 timestamp로 잘라서 그 부분만 보면 된다.

### 이벤트별 파일 분리

이벤트마다 record 크기가 다르고 (`ML_LOCK` 16B vs `ML_ORDER_COMPLETE` 44B), 분석할 때도 lock 문제 따로 / edge transit 따로 보는 게 자연스러워서 파일을 종류별로 분리했다. 한 파일에 다 섞으면 record마다 type tag + 가변 길이 처리가 들어가서 binary의 장점이 사라진다.

### OPFS와 MQTT 병행

OPFS는 단일 세션 로컬 기록용 — 다운받아서 그 세션만 Python으로 분석할 때. MQTT publish는 별도로 PostgreSQL에 적재하는 경로다 — 여러 세션을 모아서 비교하거나 ML 학습 dataset으로 쓸 때 필요하다. 둘이 독립이라 MQTT 끊겨도 OPFS는 무사하고, 반대도 마찬가지.

### Hot-path 부담

이벤트마다 즉시 write하면 OPFS sync call이 매 step 수천 번 일어나니까, 메모리 buffer에 512건 모았다가 한 번에 write한다. 10초 주기로 강제 flush해서 브라우저가 갑자기 닫혀도 직전 10초 분량만 잃는다. `DataView.setUint32` 호출 자체는 수십 ns라 hot path에서 사실상 무료.

### 스키마 관리 — 양쪽 수동 + AI 작성

write side (`SimLogger.ts` / `protocol.ts`)와 read side (`scripts/log_parser/*.py`)에 같은 byte layout이 적혀 있다. 새 이벤트 추가할 때 두 곳 동시에 손대야 함:

```
TS:     buf.view.setUint32(off+0, ts, true);      // 4 bytes
        buf.view.setUint32(off+4, vehId, true);   // 4 bytes
        buf.view.setUint16(off+8, nodeIdx, true); // 2 bytes
        ...

Python: dtype = np.dtype([('ts','<u4'),('vehId','<u4'),('nodeIdx','<u2'),...])
        arr = np.fromfile(path, dtype=dtype)
```

AI에게 한 번에 양쪽 만들게 하면 sync 비용이 거의 0이라 IDL을 따로 두지 않았다.

#### FlatBuffers 시도 흔적

[`schema/dev_log.fbs`](../../schema/dev_log.fbs) 정의하고 `flatc`로 [`src/generated/vps-dev-log/`](../generated/vps-dev-log/) TS 코드 생성까지 한 번 해봤는데, 지금 방식으로도 그럭저럭 돌아가서 일단 보류. ML 학습용 데이터 파이프라인을 본격적으로 짤 때 그때 제대로 도입해볼 예정.

---

## 8. 관련 문서

- [`SYSTEM_ARCHITECTURE.md` §6.2 시뮬레이션 루프](../../doc/SYSTEM_ARCHITECTURE.md)
- [`shmSimulator/core/README.md` step() 흐름](../shmSimulator/core/README.md#step-흐름--7-단계) — logger 콜백 등록 시점
- [`.ai-agents/log_agents.md`](../../.ai-agents/log_agents.md) — 분석 도구 / event type 매핑 / parser 사용법
- [`tools/log_db/`](../../tools/log_db/) — PostgreSQL + FastAPI + MQTT 인프라 (DbShipper 수신측)
