# v0.3.80 계획: 경로 변경 시 Lock 처리 통합

## 현재 문제
경로 변경 관련 lock 처리가 여기저기 흩어져 있어 복잡하고 버그 발생:

### 현재 흩어진 위치
1. **processPathCommand** (TransferMgr) — `releaseOrphanedLocks` 호출
2. **buildCheckpoints** (TransferMgr) — checkpoint 전체 rebuild + head 리셋
3. **checkAutoRelease** (LockMgr, Step 2) — 자동 해제
4. **Step 4.5** (simulation-step) — v0.3.79 임시 재처리

### 발생한 버그들
| 버전 | 문제 | 원인 |
|------|------|------|
| v0.3.70 | 먼 우회인데 lock 유지 | cancel 안 함 |
| v0.3.71 | 가까운 차량 큐 밀림 | cancel 너무 공격적 |
| v0.3.72~73 | HOLDER lock 해제 | 직진/우회 오판 |
| v0.3.74 | WAIT 차량 cancel → deadlock | WAIT 상태 cancel |
| v0.3.75 | edge count 기반 부정확 | 물리 거리 미사용 |
| v0.3.76 | HOLDER 무조건 유지 | 멀리 우회해도 유지 |
| v0.3.79 | checkpoint rebuild → REQ 1프레임 딜레이 | step 순서 |

### 근본 원인
- checkpoint rebuild 시 head=0 리셋 → 이미 처리한 REQ가 날아감
- 경로 변경이 Step 4에서 발생하는데 lock 처리는 Step 2에서 이미 끝남
- releaseOrphanedLocks가 processPathCommand 안에서 호출 → lock 로직이 TransferMgr에 섞임

## 수정 방안: Step 4.5에서 통합 처리

### 원칙
- **processPathCommand에서는 lock 처리 안 함** — 경로/checkpoint만 세팅
- **Step 4.5에서 경로 변경된 차량의 lock을 한번에 처리**

### Step 4.5 처리 내용
경로 변경된 차량(transferMgr.getPathChangedVehicles())에 대해:

1. **orphaned lock 처리** (기존 releaseOrphanedLocks 이동)
   - 신 경로에 없는 merge → release/cancel
   - 신 경로에 있는 merge → 물리 거리 기준 유지/cancel

2. **checkpoint missed 즉시 처리**
   - rebuild된 checkpoint 중 이미 지나친 것 → 즉시 processCheckpoint
   - 이미 큐에 있는 merge의 REQ는 건너뜀 (중복 방지)

3. **큐 순서 정합성 확인**
   - HOLDER인데 merge에서 멀어진 경우 → release + grant next
   - 큐에 있는데 이미 merge를 지난 경우 → cancel

### 수정 파일
- `simulation-step.ts` — Step 4.5 로직 확장
- `TransferMgr/index.ts` — processPathCommand에서 releaseOrphanedLocks 제거, pathChangedVehicles에 경로 정보도 함께 저장
- `LockMgr/lock-handlers.ts` — releaseOrphanedLocks를 Step 4.5에서 호출 가능하도록 인터페이스 정리
- `LockMgr/index.ts` — Step 4.5용 통합 메서드 추가

### 주의사항
- releaseOrphanedLocks에 필요한 정보(newPathEdges, newPathMergeNodes)를 pathChangedVehicles와 함께 저장해야 함
- processPathCommand에서 lock 관련 코드 제거 시 기존 동작 깨지지 않는지 확인
- 이중 GRANT 방지: 이미 큐에 있는 차량의 재REQ 차단

## 관련 케이스
- fab_3_0 N0195: 경로 변경 → checkpoint rebuild → REQ 1프레임 딜레이 → priority inversion
- fab_0_0 N0183: 경로 변경 → 멀리 우회 → lock 유지 → 물리적 역전
- fab_1_1 N0250 / fab_2_1 N0049: merge 양쪽 센서 간섭 (별도 이슈)
