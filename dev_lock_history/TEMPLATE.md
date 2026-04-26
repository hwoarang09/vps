# Lock Issue Report: v{VERSION} — {제목}

## 1. 요약
- **버전**: v{VERSION}
- **커밋**: `{HASH}`
- **날짜**: YYYY-MM-DD
- **상태**: 해결됨 / 미해결 / revert됨

{한 줄 요약}

## 2. 문제 상황

### 2.1 증상
- 어떤 fab에서 발생했는가
- 몇 분째에 멈췄는가
- stuck 차량 수

### 2.2 관련 차량
| 차량 | 역할 | 마지막 edge | 마지막 lock 상태 |
|------|------|-------------|-----------------|
| veh XX | 앞차 (물리적) | edge YYY | WAIT at node ZZZ |
| veh YY | 뒷차 (물리적) | edge YYY | GRANT at node ZZZ |

### 2.3 시간순 이벤트 (deadlock 발생 구간)
```
MM:SS.mmm  veh XX  EVENT  detail
MM:SS.mmm  veh YY  EVENT  detail
...
```

### 2.4 차량 이동 궤적 (마지막 N개 edge)
- **veh XX**: edge1 → edge2 → ... → edgeN
- **veh YY**: edge1 → edge2 → ... → edgeN

## 3. 원인 분석

### 3.1 이전 코드의 문제
```typescript
// 문제가 된 코드 (파일:라인)
```

### 3.2 왜 문제인가
{상세 설명}

### 3.3 발생 조건
1. 조건 1
2. 조건 2
3. 조건 3

## 4. 해결

### 4.1 수정 방향
{어떤 접근으로 해결했는가}

### 4.2 코드 변경 (diff 요약)
```diff
- 이전 코드
+ 수정 코드
```

### 4.3 부작용 검토
- 다른 케이스에 영향 없는지 확인한 내용

## 5. 로그 파일
- `logs/{session}_edge_transit.bin`
- `logs/{session}_lock.bin`
- `logs/{session}_transfer.bin`
- `logs/{session}_path.bin`

## 6. 분석 명령어
```bash
python scripts/log_parser/analyze.py logs/ --deadlock --pair XX YY --node ZZZ
python scripts/log_parser/analyze.py logs/ --stuck
python scripts/log_parser/analyze.py logs/ --veh XX --from MMSS --to MMSS
```
