# Lock Issue Report: v0.3.70 — 경로 변경 시 미GRANT lock 큐 cancel

## 1. 요약
- **버전**: v0.3.70
- **커밋**: `16aba12`
- **날짜**: 2026-04-26
- **상태**: revert됨 (v0.3.71)

경로 변경 시 `releaseOrphanedLocks`에서 신 경로에도 있는 merge node의 미GRANT lock(큐 대기 중)을 cancel → 신 경로 checkpoint에서 물리적 순서에 맞게 재REQ하도록 수정.

## 2. 문제 상황 (수정 전 — v0.3.69 이전)

### 2.1 증상
경로 변경 후에도 구 경로 기준 큐 순서가 유지됨.
먼 우회 경로에서 REQ → 경로 변경 → merge 앞 대기열 뒤에 도착 → 물리적으로 뒤인 차량이 먼저 GRANT → deadlock.

### 2.2 이전 코드
```typescript
// v0.3.69: 신 경로에 merge가 있으면 무조건 큐 유지
if (newPathMergeNodes.has(nodeName)) continue;
```

## 3. 수정 내용

```diff
- if (newPathMergeNodes.has(nodeName)) continue; // 새 경로에 있음 → 유지
+ if (newPathMergeNodes.has(nodeName)) {
+   if (holder === vehicleId) {
+     continue; // GRANT 받은 lock → 유지
+   }
+   // 미GRANT → cancel → 신 경로 checkpoint에서 재REQ
+   cancelFromQueue(nodeName, vehicleId, state);
+   releases.splice(i, 1);
+   continue;
+ }
```

## 4. 부작용 → v0.3.71에서 revert

**문제**: 가까운 차량이 경로를 살짝 변경해도 큐에서 cancel됨.
merge 바로 앞에서 경로 변경 → cancel → 재REQ → 큐 맨 뒤로 밀림 → 뒤차가 GRANT.

**예시**: veh 33이 veh 161보다 앞인데 큐에서 밀려서 161이 GRANT 받는 priority inversion.
