# FlatBuffers Log 해석 가이드

FbLogger가 기록한 바이너리 로그를 해석하는 방법.

## 📊 CheckpointLog 해석

### Flags (체크포인트 플래그)

비트 마스크 형태로 저장됨. 여러 플래그가 OR 연산으로 결합 가능.

| 값 (10진수) | 값 (16진수) | 이름 | 의미 |
|------------|------------|------|------|
| **0** | **0x00** | **COMPLETED** | **모든 플래그 처리 완료!** 다음 Checkpoint로 이동 가능 |
| 1 | 0x01 | LOCK_REQUEST | Lock 요청 필요 |
| 2 | 0x02 | LOCK_WAIT | Lock 대기 중 (차량 정지) |
| 4 | 0x04 | LOCK_RELEASE | Lock 해제 필요 |
| 8 | 0x08 | MOVE_PREPARE (PREP) | nextEdges 채우기 (목표 edge까지) |
| 9 | 0x09 | REQ\|PREP | Lock 요청 + nextEdges 채우기 |

#### ⭐ flags = 0의 특별한 의미

```
flags = 0 (COMPLETED)
  ↓
모든 flag가 처리되었음
  ↓
이 Checkpoint의 작업 완료
  ↓
다음 Checkpoint 로드 가능
```

**처리 흐름 예시:**
```
1. CP 도달: flags = 9 (LOCK_REQUEST | MOVE_PREPARE)
2. MOVE_PREPARE 처리 완료: flags = 1 (LOCK_REQUEST만 남음)
3. LOCK_REQUEST 처리 완료: flags = 0 (✅ COMPLETED!)
4. loadNextCheckpoint() 호출
```

**예시:**
```python
flags = 8  # → MOVE_PREPARE
flags = 9  # → LOCK_REQUEST | MOVE_PREPARE
flags = 3  # → LOCK_REQUEST | LOCK_WAIT
flags = 0  # → 처리 완료, 다음 CP 로드
```

### Action (체크포인트 동작)

| 값 | 의미 | 설명 |
|----|------|------|
| `"HIT"` | 도달 | Checkpoint에 정확히 도달하여 처리 완료 |
| `"SKIP"` | 스킵 | Edge 불일치로 스킵 (이미 지나침) |
| `"LOAD_NEXT"` | 다음 로드 | flags=0, 다음 Checkpoint 로드 |
| `"MISSED"` | 놓침 | 빠른 통과로 Checkpoint를 놓침 (Catch-up 처리) |

### Edge ID

1-based 인덱스. 0은 "없음"을 의미.

```python
edge_id = 722  # → "E722"
edge_id = 723  # → "E723"
edge_id = 0    # → "없음" (초기화 안 됨)
```

### Ratio (위치)

Edge 위의 위치를 0.0~1.0로 표현.

```python
ratio = 0.0    # Edge 시작점
ratio = 0.5    # Edge 중간
ratio = 0.853  # Edge 85.3% 지점
ratio = 1.0    # Edge 끝
```

### CP Index (체크포인트 인덱스)

0부터 시작하는 체크포인트 순번.

```python
cp_index = 0   # 첫 번째 CP
cp_index = 3   # 네 번째 CP
cp_index = 10  # 열한 번째 CP
```

---

## 🔄 EdgeTransitionLog 해석

### From/To Edge

```python
from_edge = 722  # → "E722"에서
to_edge = 723    # → "E723"으로 전환
```

### Next Edges (다음 Edge 배열)

최대 5개의 다음 edge를 미리 로드. 0은 "비어있음".

```python
next_edges = [723, 724, 725, 0, 0]
# → E723, E724, E725가 로드됨
# → 4번째, 5번째 슬롯은 비어있음
```

### Path Buf Length

경로 버퍼에 남은 edge 개수.

```python
path_buf_len = 15  # → 앞으로 15개 edge 남음
path_buf_len = 0   # → 경로 없음 (목적지 도착 또는 경로 없음)
```

---

## 🔒 LockEventLog 해석

### Event Type

| 값 | 의미 |
|----|------|
| `"REQUEST"` | Lock 요청 |
| `"GRANT"` | Lock 획득 |
| `"WAIT"` | Lock 대기 중 |
| `"RELEASE"` | Lock 해제 |

### Lock ID

merge node의 인덱스 (통상적으로).

```python
lock_id = 5  # → merge node #5의 Lock
```

### Wait Time

Lock 대기 시간 (밀리초).

```python
wait_time_ms = 0     # 즉시 획득
wait_time_ms = 125   # 125ms 대기
wait_time_ms = 3000  # 3초 대기 (⚠️ 오래 기다림)
```

---

## ⚠️ ErrorLog 해석

### Error Code

| 코드 | 의미 |
|------|------|
| `"ERR_001"` | 일반 에러 |
| `"WARN_DEADLOCK"` | Deadlock 경고 |
| `"ERR_PATH_NOT_FOUND"` | 경로 없음 |
| `"WARN_HIGH_QUEUE"` | Lock queue 과다 |

---

## 📈 PerfLog 해석

### FPS (Frames Per Second)

```python
fps = 60.0   # 정상
fps = 30.0   # 약간 느림
fps = 10.0   # 매우 느림 (⚠️ 성능 문제)
```

### Memory

```python
memory_mb = 256.5  # 256.5 MB 사용 중
memory_mb = 1024.0 # 1 GB 사용 중 (⚠️ 메모리 많이 사용)
```

### Active Vehicles

```python
active_vehicles = 1500  # 1500대 활성 차량
```

### Lock Queue Size

```python
lock_queue_size = 23   # 23개 Lock 대기 중
lock_queue_size = 100  # 100개 대기 중 (⚠️ 병목 가능)
```

---

## 🔍 분석 예시

### 예시 1: Checkpoint HIT

```
[00:05:08.469] [DEBUG] [veh:24] [checkpoint-processor.ts:91] CheckpointLog
  CP#3 E722@0.853 flags=8(MOVE_PREPARE) HIT | cur=E722 head=3
```

**해석:**
- 차량 24번이 체크포인트 #3에 도달
- Edge 722의 85.3% 지점
- MOVE_PREPARE 플래그 (nextEdges 채우기)
- 처리 완료 (HIT)

### 예시 2: Edge 전환

```
[00:05:09.124] [DEBUG] [veh:24] [edgeTransition.ts:45] EdgeTransitionLog
  E722→E723 next=[E723,E724,E725,E0,E0] pathLen=15
```

**해석:**
- 차량 24번이 E722에서 E723으로 전환
- 다음 3개 edge가 로드됨 (E723, E724, E725)
- 경로에 15개 edge 남음

### 예시 3: Lock 대기

```
[00:05:09.458] [INFO] [veh:24] [lock-handlers.ts:125] LockEventLog
  Lock#5 WAIT E723 wait=125ms
```

**해석:**
- 차량 24번이 Lock #5 대기 중
- Edge 723 진입 시도
- 125ms 동안 대기함

---

## 💡 팁

### 1. Flags 디코딩 (Python)

```python
def decode_flags(flags):
    names = []
    if flags & 0x01: names.append("LOCK_REQUEST")
    if flags & 0x02: names.append("LOCK_WAIT")
    if flags & 0x04: names.append("LOCK_RELEASE")
    if flags & 0x08: names.append("MOVE_PREPARE")
    return "|".join(names) if names else "NONE"

# 사용
print(decode_flags(8))   # → "MOVE_PREPARE"
print(decode_flags(9))   # → "LOCK_REQUEST|MOVE_PREPARE"
```

### 2. Edge 이름 매핑

실제 edge 이름을 알고 싶다면 layout JSON 파일 참조:

```json
{
  "edges": [
    { "id": 722, "name": "Main_Line_01", ... },
    { "id": 723, "name": "Branch_A", ... }
  ]
}
```

### 3. fb_parser.py는 자동 해석

```bash
# 자동으로 flags, edge 이름 해석됨
python3 tools/log_parser/fb_parser.py log.bin
```

출력:
```
[00:05:08.469] [DEBUG] [veh:24] [CheckpointLog] CP#3 E722@0.853 flags=8(MOVE_PREPARE) HIT
                                                                      ↑ 자동 해석!
```

---

## 📚 참고

- **스키마**: `schema/dev_log.fbs`
- **분석기**: `tools/log_parser/fb_parser.py`
- **상수 정의**: `src/common/vehicle/initialize/constants.ts` (CheckpointFlags)
