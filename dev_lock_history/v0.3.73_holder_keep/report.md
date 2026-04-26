# Lock Issue Report: v0.3.73 — HOLDER lock 무조건 유지

## 1. 요약
- **버전**: v0.3.73
- **커밋**: `e1438d4`
- **날짜**: 2026-04-26
- **상태**: 부분 해결 (v0.3.74 이슈 잔존)

v0.3.72에서 HOLDER에도 직진/우회 판별이 적용되어 통과 중인 lock이 해제되는 버그 수정.

## 2. 수정 내용

```diff
  if (newPathMergeNodes.has(nodeName)) {
+   if (holder === vehicleId) {
+     continue; // HOLDER → 무조건 유지
+   }
    // 큐 대기 중 → 직진/우회 판별
    ...
  }
```

## 3. 해결한 것
- HOLDER의 lock이 경로 변경으로 해제되는 문제 ✅

## 4. 남은 문제 → v0.3.74

**직진/우회 판별이 `releaseEdgeIdx`(구 경로 기준)로 작동하는 한계.**

차량이 이미 WAIT 상태(merge 직전에 정지)인데:
1. 경로 재할당 발생
2. 구 경로의 `releaseEdgeIdx`가 신 경로에 없음
3. "우회"로 판정 → 큐에서 cancel
4. 재REQ 시 큐 맨 뒤로 밀림
5. 물리적으로 뒤인 차량이 GRANT → deadlock

**핵심**: WAIT 상태 = 이미 물리적으로 merge 직전에 도달.
이 상태에서 큐 cancel은 물리적 순서를 무시하는 결과를 낳음.
