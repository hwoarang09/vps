# Session Context (2026-03-08)

## 현재 상태: v0.3.21

0.3.12 베이스로 롤백 + React UI만 cherry-pick.

### 현재 포함된 것
- **시뮬레이션 엔진**: 0.3.12 기준 (AutoMgr + Lock 시스템 정상 동작)
- **React UI**: 0.3.16-18 cherry-pick (메뉴 버튼 스타일, 아이콘 교체, 툴팁)
- **Lock 시스템**: checkpoint 기반 (LockMgr, builder, checkpoint-processor 등)
- **TransferMgr**: pathBuffer + checkpoint + NEXT_EDGE 관리
- **AutoMgr**: 랜덤 station 목적지 할당 (Dijkstra 경로)

### 제거된 것 (0.3.13~0.3.20)

| 버전 | 제거 내용 | 비고 |
|------|-----------|------|
| 0.3.13 | OrderMgr (AutoMgr 리네임) + JobBatchMgr + JobState CYCLE | Lock 깨진 시점 |
| 0.3.14 | MOVE_TO_LOAD/UNLOAD 도착 판별 fix | OrderMgr 의존 |
| 0.3.15 | FOUP + TrayRenderer/FoupRenderer + JobState IDLE 초기화 | OrderMgr 의존 |
| 0.3.16-18 | React UI 변경 | cherry-pick으로 복원 완료 |
| 0.3.19 | config 폴더 도메인별 분리 + worker config 6개 + InstancedText static | worker 코드 건드림 |
| 0.3.20 | worker config 참조 연결 (7개 매니저 소스) | worker 코드 건드림 |

### 백업
- `backup-0.3.20` 브랜치: 롤백 전 전체 코드 보존

## 다음 작업 (미완료)

### 1. Lock 동작 확인
- 0.3.12 AutoMgr 기반으로 merge point에서 lock이 정상 동작하는지 확인 필요
- 안 되면 lock 시스템 자체 문제 (0.3.12 이전부터)

### 2. 반송 시스템 재구현 (OrderMgr)
- 0.3.13의 OrderMgr/JobBatchMgr이 lock을 깨뜨린 원인 분석 필요
- Lock이 정상 확인된 후, AutoMgr 위에 반송 기능을 안전하게 추가
- 필요 기능: pickup/dropoff 상태 머신, FOUP 표시, JobBatchMgr 자동 반송 생성

### 3. Vehicle Search 패널 반송 정보 (보류)
- IndividualControlPanel에 JobState/OrderData/FOUP 표시 코드 작성했으나 롤백으로 제거됨
- 반송 시스템 재구현 시 다시 추가

### 4. config 분리 (보류)
- 0.3.19-20에서 했던 config 도메인별 분리가 롤백됨
- Lock 안정화 후 다시 진행 가능

### 5. 로그 mode 하드코딩 (보류)
- logger-setup.ts에서 mode: 'ml' 하드코딩 → devLogEnabled 반영하도록 수정했으나 롤백됨
- devLogEnabled: true여도 dev 로그 안 남는 버그 여전히 존재
