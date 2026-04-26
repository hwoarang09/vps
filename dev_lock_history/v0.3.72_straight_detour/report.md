# Lock Issue Report: v0.3.72 — 직진/우회 판별로 lock 처리 개선

## 1. 요약
- **버전**: v0.3.72
- **커밋**: `5bf7d49`
- **날짜**: 2026-04-26
- **상태**: 부분 버그 있음 → v0.3.73에서 수정

v0.3.70(무조건 cancel)과 v0.3.71(무조건 유지)의 중간 접근:
신 경로에서 releaseEdge 위치를 확인하여 직진/우회를 판별.

## 2. 수정 방향

`releaseOrphanedLocks`에서 신 경로에도 있는 merge node에 대해:
- **직진** (releaseEdge가 신 경로 앞쪽 10개 edge 이내) → lock/queue 유지
- **우회** (releaseEdge가 멀리 있거나 없음) → release/cancel

```typescript
const MAX_DIRECT_MERGE_EDGES = 10;

if (newPathMergeNodes.has(nodeName)) {
  let posInPath = -1;
  for (let j = 0; j < newPathEdges.length; j++) {
    if (newPathEdges[j] === releaseEdgeIdx) { posInPath = j; break; }
  }
  if (posInPath >= 0 && posInPath < MAX_DIRECT_MERGE_EDGES) {
    continue; // 직진 → 유지
  }
  // 우회 → release/cancel
}
```

## 3. 해결한 것
- veh 75 케이스 (먼 우회): cancel → 재REQ → 물리적 순서 반영 ✅
- veh 33 케이스 (가까이 직진): queue 유지 ✅

## 4. 남은 버그
**HOLDER에도 직진/우회 판별이 적용됨.**
이미 merge 통과 중인 차량의 `releaseEdgeIdx`(구 경로 기준)가 신 경로에 없으면
"우회"로 오판 → 통과 중인 lock 해제 → priority inversion.

→ v0.3.73에서 수정: HOLDER는 직진/우회 판별 건너뛰기.
