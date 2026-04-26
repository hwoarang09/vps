# Lock 개발 히스토리

Lock 관련 버그/수정 이력을 기록하는 폴더.
각 이슈는 버전별 서브폴더에 정리한다.

## 구조

```
dev_lock_history/
├── README.md                  ← 이 파일
├── TEMPLATE.md                ← 새 이슈 작성 시 복사할 템플릿
├── v0.3.70_priority_inversion/
│   ├── report.md              ← 문제/분석/해결 보고서
│   └── logs/                  ← 재현 로그 (.bin 파일)
├── v0.3.71_revert/
│   └── report.md
└── ...
```

## 작성 규칙

1. Lock 관련 git commit 시, 해당 버전으로 폴더 생성
2. `TEMPLATE.md`를 복사하여 `report.md` 작성
3. 재현 가능한 로그 파일(.bin)은 `logs/` 에 보관
4. 분석 스크립트: `scripts/log_parser/analyze.py --deadlock --pair VEH1 VEH2 --node NODE`

## 이슈 목록

| 버전 | 폴더 | 요약 |
|------|------|------|
| v0.3.70 | [v0.3.70_cancel_non_granted](v0.3.70_cancel_non_granted/) | 경로 변경 시 미GRANT cancel → 가까운 차량 밀림 부작용 |
| v0.3.71 | [v0.3.71_revert](v0.3.71_revert/) | v0.3.70 revert |
| v0.3.72 | [v0.3.72_straight_detour](v0.3.72_straight_detour/) | 직진/우회 판별 도입 → HOLDER에도 적용되는 버그 |
| v0.3.73 | [v0.3.73_holder_keep](v0.3.73_holder_keep/) | HOLDER 무조건 유지 → WAIT 상태 차량 cancel 문제 미해결 |
| v0.3.74 | [v0.3.74_wait_cancel_deadlock](v0.3.74_wait_cancel_deadlock/) | WAIT 상태 차량이 경로 변경 시 큐에서 제거되어 deadlock |
