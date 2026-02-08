# DevLogger → FbLogger 매핑 가이드

DevLogger 호출을 FbLogger로 변환하는 방법.

## 🎯 기본 원칙

```typescript
// DevLogger (텍스트)
devLog.veh(24).debug("[processCP] HIT detected");

// FbLogger (구조화)
const fbLog = getFbLog();
if (fbLog) {
  fbLog.checkpoint({
    vehId: 24,
    cpIndex: 3,
    edgeId: 722,
    ratio: 0.853,
    flags: 8,
    action: "HIT",
    details: "detected"
  });
}
```

**핵심:**
- DevLogger: 자유 형식 문자열
- FbLogger: 구조화된 필드

---

## 📋 매핑 패턴

### 1. Checkpoint 로그

#### DevLogger:
```typescript
devLog.veh(vehId).debug(`[processCP] HIT cp=${cpIndex} E${edgeId}@${ratio} flags=${flags}`);
devLog.veh(vehId).debug(`[processCP] SKIP edge mismatch`);
devLog.veh(vehId).debug(`[processCP] flags=0, loading next`);
```

#### FbLogger:
```typescript
import { getFbLog } from "@/logger";

const fbLog = getFbLog();
if (fbLog) {
  // HIT
  fbLog.checkpoint({
    vehId,
    cpIndex,
    edgeId,
    ratio,
    flags,
    action: "HIT",
  });

  // SKIP
  fbLog.checkpoint({
    vehId,
    cpIndex,
    edgeId,
    ratio,
    flags,
    action: "SKIP",
    details: "edge mismatch"
  });

  // LOAD_NEXT
  fbLog.checkpoint({
    vehId,
    cpIndex,
    edgeId,
    ratio,
    flags: 0,
    action: "LOAD_NEXT",
  });
}
```

---

### 2. Edge 전환 로그

#### DevLogger:
```typescript
devLog.veh(vehId).debug(`[EDGE_TRANSITION] E${fromEdge}→E${toEdge} next=[${nextEdges}]`);
devLog.veh(vehId).debug(`[SHIFT] pathBuf=${pathBufLen} nextEdges updated`);
```

#### FbLogger:
```typescript
const fbLog = getFbLog();
if (fbLog) {
  fbLog.edgeTransition({
    vehId,
    fromEdge,
    toEdge,
    nextEdges: [n1, n2, n3, n4, n5],
    pathBufLen,
  });
}
```

---

### 3. Lock 이벤트 로그

#### DevLogger:
```typescript
devLog.veh(vehId).debug(`[requestLock] Requested lock for E${edgeId}`);
devLog.veh(vehId).info(`[grantLock] Granted lock=${lockId} E${edgeId}`);
devLog.veh(vehId).warn(`[LOCK_WAIT] Waiting for lock=${lockId} (${waitMs}ms)`);
devLog.veh(vehId).debug(`[releaseLock] Released lock=${lockId}`);
```

#### FbLogger:
```typescript
const fbLog = getFbLog();
if (fbLog) {
  // REQUEST
  fbLog.lockEvent({
    vehId,
    lockId,
    eventType: "REQUEST",
    edgeId,
    waitTimeMs: 0,
  });

  // GRANT
  fbLog.lockEvent({
    vehId,
    lockId,
    eventType: "GRANT",
    edgeId,
    waitTimeMs,
  });

  // WAIT
  fbLog.lockEvent({
    vehId,
    lockId,
    eventType: "WAIT",
    edgeId,
    waitTimeMs,
  });

  // RELEASE
  fbLog.lockEvent({
    vehId,
    lockId,
    eventType: "RELEASE",
    edgeId,
    waitTimeMs: 0,
  });
}
```

---

### 4. 일반 디버그 로그

#### DevLogger:
```typescript
devLog.veh(vehId).debug(`[LockMgr] Processing checkpoint`);
devLog.veh(vehId).info(`Vehicle spawned at E${edgeId}`);
devLog.veh(vehId).warn(`High memory usage`);
devLog.veh(vehId).error(`Deadlock detected!`);
```

#### FbLogger:
```typescript
const fbLog = getFbLog();
if (fbLog) {
  fbLog.debug("Processing checkpoint", { vehId, tag: "LockMgr" });
  fbLog.info(`Vehicle spawned at E${edgeId}`, { vehId, tag: "VehicleMgr" });
  fbLog.warn("High memory usage", { tag: "Performance" });
  fbLog.error("Deadlock detected!", { vehId, tag: "DeadlockDetector" });
}
```

---

### 5. 성능 로그

#### DevLogger:
```typescript
devLog.info(`[Performance] FPS=${fps} Memory=${memoryMb}MB Vehicles=${activeVehicles}`);
```

#### FbLogger:
```typescript
const fbLog = getFbLog();
if (fbLog) {
  fbLog.perf({
    fps,
    memoryMb,
    activeVehicles,
    lockQueueSize,
  });
}
```

---

## 🔧 실전 예제

### checkpoint-processor.ts

```typescript
import { devLog } from "@/logger/DevLogger";
import { getFbLog } from "@/logger";

// 기존 DevLogger
devLog.veh(vehicleId).debug(
  `[processCP] HIT cp=${cpState.cpIndex} E${cpState.cpEdge}@${cpState.cpRatio.toFixed(3)} flags=${cpState.flags}`
);

// FbLogger 추가
const fbLog = getFbLog();
if (fbLog) {
  fbLog.checkpoint({
    vehId: vehicleId,
    cpIndex: cpState.cpIndex,
    edgeId: cpState.cpEdge,
    ratio: cpState.cpRatio,
    flags: cpState.flags,
    action: "HIT",
  });
}
```

### lock-handlers.ts

```typescript
import { devLog } from "@/logger/DevLogger";
import { getFbLog } from "@/logger";

// Lock 요청
devLog.veh(vehicleId).debug(`[requestLock] Requested lock for E${targetEdge}`);

const fbLog = getFbLog();
if (fbLog) {
  fbLog.lockEvent({
    vehId: vehicleId,
    lockId: lockMgr.getLockId(targetEdge),
    eventType: "REQUEST",
    edgeId: targetEdge,
    waitTimeMs: 0,
  });
}
```

### vehicleTransition.ts

```typescript
import { devLog } from "@/logger/DevLogger";
import { getFbLog } from "@/logger";

// Edge 전환
devLog.veh(vehicleId).debug(`[EDGE_TRANSITION] E${fromEdge}→E${toEdge}`);

const fbLog = getFbLog();
if (fbLog) {
  fbLog.edgeTransition({
    vehId: vehicleId,
    fromEdge,
    toEdge,
    nextEdges: [n1, n2, n3, n4, n5],
    pathBufLen: pathBuffer.length,
  });
}
```

---

## 📝 체크리스트

각 DevLogger 호출 시 확인:

- [ ] **Checkpoint 관련**: `fbLog.checkpoint()` 사용
- [ ] **Edge 전환**: `fbLog.edgeTransition()` 사용
- [ ] **Lock 이벤트**: `fbLog.lockEvent()` 사용
- [ ] **일반 로그**: `fbLog.debug/info/warn/error()` 사용
- [ ] **성능 메트릭**: `fbLog.perf()` 사용
- [ ] `getFbLog()` null 체크 (if 문으로 감싸기)
- [ ] 필요한 데이터 모두 포함 (vehId, edgeId, flags 등)

---

## 🚀 자동화 도구 (향후)

```bash
# TODO: DevLogger → FbLogger 자동 변환 스크립트
npm run convert:devlog-to-fblog src/common/vehicle/logic/LockMgr/*.ts
```

---

## 📚 참고

- **FbLogger API**: `src/logger/fb/FbLogger.ts`
- **로그 해석**: `schema/LOG_INTERPRETATION.md`
- **스키마**: `schema/dev_log.fbs`
