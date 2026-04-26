# Lock Issue Report: v0.3.71 — v0.3.70 revert

## 1. 요약
- **버전**: v0.3.71
- **커밋**: `08dd86a`
- **날짜**: 2026-04-26
- **상태**: 중간 단계 (v0.3.72에서 개선)

v0.3.70의 "미GRANT 무조건 cancel" 정책이 가까운 차량의 큐 순서를 깨뜨리는 부작용 발생.
원래 로직(신 경로에 merge 있으면 큐 유지)으로 롤백.

## 2. revert 이유

v0.3.70에서 경로 변경 시 미GRANT lock을 큐에서 cancel하면:
- merge 가까이 있는 차량이 경로 살짝 변경 → cancel → 재REQ → 큐 맨 뒤
- 물리적으로 뒤에 있는 차량이 GRANT 받음 → priority inversion

## 3. 코드 변경

v0.3.70의 cancel 로직 전부 제거, 원래 `continue` 복원:
```typescript
if (newPathMergeNodes.has(nodeName)) continue; // 새 경로에 있음 → 유지
```

## 4. 남은 문제

원래 문제(먼 우회에서 큐 유지)는 다시 발생 가능.
→ v0.3.72에서 "직진/우회 판별" 접근으로 개선.
