# Checkpoint Splice 조사 (76번 N351 데드락)

## 배경

세션 `20260505_0325` fab_1_0 ts=1978348:
- 76번이 N351(0-based 350) 락 GRANT 받고 RELEASE 안 함 → 시뮬 끝까지 보유
- 184/57 무한 WAIT (holder=76), 94 REQ만 미해결
- 76은 e402 r=0.041에서 stop=0(LOCKED 아님)로 정지 = 데드락

## 핵심 발견 (코드 분석)

정상이라면 **e401 r=0.769** (직선 target, `straightRequestDistance=5.1m`)에 N351 LOCK_REQUEST cp가 발화해야 함. 그러나 76은 e401 r=0.769~0.901 통과 시점 락 이벤트 0건. 결국 r=0.92(LOCK_WAIT 위치 r=0.9145 부근)에서야 REQ + 즉시 GRANT.

**가장 의심되는 원인**: `MAX_CHECKPOINTS_PER_VEHICLE=100` 한도 초과로 `builder.ts:568` splice가 **N351 LOCK_REQUEST cp를 잘라냄**.
- 76 path: pathLen=33, edge당 평균 ~3 cp → 99~108개 (100 직전/초과)
- 184도 ts=1978795 path 변경 직후에야 N351 REQ — 비슷한 누락 패턴

## 1단계 — 적용 (완료)

`src/common/vehicle/initialize/constants.ts:131` 수정:
```ts
export const MAX_CHECKPOINTS_PER_VEHICLE = 100 → 200;
```
영향: 차량당 메모리 1.6KB → 3.2KB (200대 기준 +320KB). hard-code된 `100`은 0건이라 자동 전파.

## 2단계 — 재현 검증 (다음)

같은 시뮬 다시 돌려서:
| 결과 | 진단 | 액션 |
|---|---|---|
| 76이 정상 통과 | splice가 원인 확정 | 끝. 다만 200도 cap이라 더 긴 path에서 재발 가능 → 정책 개선 후속 검토 |
| 여전히 76 락 보유 정지 | splice 외 다른 원인 | 3단계로 |
| 다른 차량/노드에서 유사 데드락 | 일반 cp 미발화 패턴 | 3단계로 |

체크 포인트:
- 76번 lock.bin에서 N351 REQ가 **e401 r ≈ 0.77 부근**에 찍히는지 (정상 위치)
- 76의 N351 RELEASE가 e402 r ≈ 0.01 부근에 찍히는지

## 3단계 — 결정적 진단 (1·2단계로 안 풀리면)

`checkpoint-processor.ts:34`의 `onCheckpointEvent` 훅이 이미 존재 — SimLogger에 `DEV_CHECKPOINT_EVENT` 추가:

```
ts(4) vehId(4) cpEdge(2) cpFlags(1) action(1) cpRatio(f4) curEdge(2) curRatio(f4) = 22B
action: 0=HIT, 1=MISS, 2=WAIT_BLOCKED
```

이걸로 76번의 cp HIT/MISS 이벤트를 1대1 매칭하면 어느 cp가 발화했고 어느 게 빠졌는지 확정.

수정 위치 후보:
- `src/logger/protocol.ts` — EventType에 추가
- `src/logger/SimLogger.ts` — `logCheckpointEvent` 메서드
- LockMgr 초기화 시 `state.onCheckpointEvent`에 SimLogger 콜백 와이어
- `scripts/log_parser/log_parser.py` — checkpoint 타입 디코더 추가

## 4단계 — root cause별 fix

- **(A) builder 분기 버그** (DZ/곡선/직선 분류 잘못): 해당 분기 함수 (`createCheckpointsForCurveMerge`, `createCheckpointsForStraightMergeCurveTarget`, `createCheckpointsForOthers`) 단위 테스트 + 패치
- **(B) cp[head] 진행 stuck** (이전 cp가 안 풀려서 head advance 못함): `processCheckpoint` catch-up loop(`MAX_CATCHUP=10`) 점검, missed 처리 분기 강화
- **(C) splice 정책 개선** (200도 부족하면): `sortCheckpointsByPathOrder` 후 splice 시 LOCK_REQUEST/LOCK_WAIT를 우선 보존하고 MOVE_PREPARE만 후순위로 떨어뜨리는 정렬 변경

## 참고 코드 위치

- `src/common/vehicle/logic/checkpoint/builder.ts:451` — buildCheckpoints
- `src/common/vehicle/logic/checkpoint/builder.ts:568-570` — splice cap
- `src/common/vehicle/logic/LockMgr/checkpoint-processor.ts:68` — processCheckpoint
- `src/common/vehicle/logic/LockMgr/checkpoint-loader.ts:102-121` — isCpEdgeBehind (NEXT_EDGE_0~4 5개만 체크)
- `src/common/vehicle/logic/LockMgr/lock-handlers.ts:250` — handleMissedCheckpoint
- `src/common/vehicle/logic/LockMgr/lock-handlers.ts:546-642` — requestLockWithPriority (path-change reconcile)
- `src/common/vehicle/logic/LockMgr/index.ts:120-136` — buildMergeNodes (incoming ≥ 2)
