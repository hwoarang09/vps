# Checkpoint Builder 작업 진행 상황

**작업 날짜**: 2026-02-06
**상태**: 구조 설계 완료, 로직 구현 대기

---

## 1. 자료구조 변경 완료

### 1.1 CheckpointBuildContext
```typescript
export interface CheckpointBuildContext {
  edgeIndices: number[];              // 경로 edge 인덱스 배열 (1-based)
  edgeArray: Edge[];                   // 전체 edge 배열 (0-based 접근)
  isMergeNode: (nodeName: string) => boolean;
  isDeadLockMergeNode: (nodeName: string) => boolean;  // ✅ 추가
}
```

### 1.2 MergeCheckpointOptions (간소화)
```typescript
export interface MergeCheckpointOptions {
  requestDistance: number;  // Lock 요청 거리 (m) - 5100 or 1000
  releaseRatio: number;     // Lock 해제 ratio (기본: 0.01)
  // 주의: Lock 대기 거리는 edge.waiting_offset 사용
}
```
**변경 이유:**
- lock 요청 거리: 파라미터로 설정 (5100m or 1000m)
- lock 대기 거리: edge.map의 `waiting_offset`에 이미 존재
- 직선/곡선 구분 제거 (단순화)

### 1.3 OnCurveCheckpointOptions (CurveCheckpointOptions에서 변경)
```typescript
export interface OnCurveCheckpointOptions {
  prepareRatio: number;  // 다음 edge 준비 시작 ratio (config에서 가져옴, 기본: 0.5)
}
```
**변경 이유:**
- 이름 변경: "On-Curve" = 곡선 edge 위에 있을 때
- `slowRatio` 제거: 곡선 위에서 감속은 의미 없음 (곡선 진입 전에 감속해야 함)

### 1.4 CheckpointBuildResult (간소화)
```typescript
export interface CheckpointBuildResult {
  checkpoints: Checkpoint[];  // 배열 맨 앞에 길이 저장하므로 이것만 필요
}
```

---

## 2. 함수 구조 변경

### 2.1 현재 구조
```typescript
// builder.ts

export function buildCheckpoints(
  ctx: CheckpointBuildContext,
  pathOptions: Partial<OnCurveCheckpointOptions> = {},
  lockOptions: Partial<MergeCheckpointOptions> = {}
): CheckpointBuildResult {
  const pathCps = buildPathCheckpoints(ctx, pathOptions);
  const lockCps = buildLockCheckpoints(ctx, lockOptions);

  const allCheckpoints = [...pathCps, ...lockCps];
  const deduplicated = deduplicateCheckpoints(allCheckpoints);

  return { checkpoints: deduplicated };
}

function buildPathCheckpoints(ctx, options): Checkpoint[] {
  // TODO: 구현
  // 1. On-Curve checkpoint (MOVE_PREPARE)
  // 2. On-Linear checkpoint? (MOVE_SLOW)
  // 3. 목적지 감속 checkpoint (MOVE_SLOW)
}

function buildLockCheckpoints(ctx, options): Checkpoint[] {
  // TODO: 구현
  // 1. 경로를 순회하며 merge node 찾기
  // 2. REQUEST: merge에서 역으로 5100m 지점 계산
  // 3. WAIT: merge에서 역으로 waiting_offset 지점 계산
  // 4. RELEASE: merge 통과 후 다음 edge releaseRatio 지점
}
```

### 2.2 문제점 발견

**정렬 문제:**
- pathCps와 lockCps를 따로 생성 후 합치면 **경로 순서대로 정렬이 어려움**
- Edge 번호는 비선형 (예: Edge1 → Edge5 → Edge3 → Edge10)
- 단순 edge 번호 정렬 ≠ 경로 순서 정렬

**예시:**
```
경로: Edge1 → Edge5 → Edge3 → Edge10

pathCps:  [{edge:5, ratio:0.5}, {edge:10, ratio:0.8}]
lockCps:  [{edge:3, ratio:0.7}, {edge:5, ratio:0.9}]

합치면 정렬이 깨짐!
올바른 순서:
1. edge:5, ratio:0.5  (pathCps)
2. edge:5, ratio:0.9  (lockCps)  ← 같은 edge면 ratio 순서
3. edge:3, ratio:0.7  (lockCps)
4. edge:10, ratio:0.8 (pathCps)
```

### 2.3 해결 방안

**Edge 순회 방식으로 변경:**
- 경로의 edge를 순서대로 순회
- 각 edge마다 pathCP와 lockCP를 계산
- 같은 위치(edge + ratio)면 flags 합치기
- 순서대로 추가 → 정렬 보장

```typescript
function buildCheckpoints(ctx, pathOptions, lockOptions) {
  const checkpoints: Checkpoint[] = [];

  // 경로를 순회 (순서 보장)
  for (let i = 0; i < ctx.edgeIndices.length; i++) {
    const edgeIdx = ctx.edgeIndices[i];
    const edge = ctx.edgeArray[edgeIdx - 1];

    // 이 edge에 대한 모든 checkpoint 계산
    const edgeCps = buildEdgeCheckpoints(
      edge, edgeIdx, ctx, i,
      pathOptions, lockOptions
    );

    // 같은 edge 내에서 ratio 순서로 정렬
    edgeCps.sort((a, b) => a.ratio - b.ratio);

    checkpoints.push(...edgeCps);
  }

  return { checkpoints };
}

function buildEdgeCheckpoints(
  edge: Edge,
  edgeIdx: number,
  ctx: CheckpointBuildContext,
  pathIndex: number,
  pathOptions: OnCurveCheckpointOptions,
  lockOptions: MergeCheckpointOptions
): Checkpoint[] {
  const tempCps: Map<string, Checkpoint> = new Map();

  // 1. Path checkpoint 계산
  const pathCp = calculatePathCheckpoint(edge, edgeIdx, pathOptions);
  if (pathCp) {
    const key = `${pathCp.edge}_${pathCp.ratio}`;
    tempCps.set(key, pathCp);
  }

  // 2. Lock checkpoint 계산 (이 edge에 해당하는 것만)
  const lockCps = calculateLockCheckpointsForEdge(
    edge, edgeIdx, ctx, pathIndex, lockOptions
  );
  for (const lockCp of lockCps) {
    const key = `${lockCp.edge}_${lockCp.ratio}`;
    if (tempCps.has(key)) {
      // 같은 위치 → flags 합치기
      const existing = tempCps.get(key)!;
      existing.flags |= lockCp.flags;
    } else {
      tempCps.set(key, lockCp);
    }
  }

  return Array.from(tempCps.values());
}
```

---

## 3. 다음 작업 (TODO)

### 3.1 buildEdgeCheckpoints 구현

**이 함수에서 해야 할 일:**
1. **Path checkpoint 계산**
   - On-Curve checkpoint (MOVE_PREPARE)
   - On-Linear checkpoint? (MOVE_SLOW - 곡선 진입 전 감속)
   - 목적지 감속 checkpoint (MOVE_SLOW)

2. **Lock checkpoint 계산**
   - 이 edge에 해당하는 lock checkpoint만 계산
   - REQUEST: merge 5100m 전 지점이 이 edge에 있는가?
   - WAIT: merge waiting_offset 전 지점이 이 edge에 있는가?
   - RELEASE: merge 통과 후 다음 edge가 현재 edge인가?

3. **같은 위치 checkpoint 병합**
   - 같은 edge + ratio → flags 합치기 (bitmask OR)

### 3.2 필요한 헬퍼 함수

```typescript
// Path checkpoint 계산
function calculatePathCheckpoint(
  edge: Edge,
  edgeIdx: number,
  options: OnCurveCheckpointOptions
): Checkpoint | null {
  // TODO: 구현
  // - 곡선이면 MOVE_PREPARE
  // - 목적지 직전이면 MOVE_SLOW
}

// Lock checkpoint 계산 (이 edge에 해당하는 것만)
function calculateLockCheckpointsForEdge(
  edge: Edge,
  edgeIdx: number,
  ctx: CheckpointBuildContext,
  pathIndex: number,
  options: MergeCheckpointOptions
): Checkpoint[] {
  // TODO: 구현
  // - Merge node 찾기
  // - Merge에서 역산하여 이 edge에 해당하는 checkpoint만 반환
}

// Merge에서 역으로 거리 계산
function findDistanceBackward(
  ctx: CheckpointBuildContext,
  mergeNodeIndex: number,
  distanceInMeters: number
): { edge: number; ratio: number } | null {
  // TODO: 구현
  // - Merge node에서 역으로 distanceInMeters만큼 떨어진 지점 계산
  // - 어느 edge의 몇 % 지점인지 반환
}
```

---

## 4. 핵심 개념 정리

### 4.1 Distance 단위
- **모든 distance는 m(미터) 단위**
- Lock 요청 거리: 5100m 또는 1000m (파라미터)
- Lock 대기 거리: edge.waiting_offset (edge.map에 정의)

### 4.2 Ratio 저장 방식
- **생성 시**: Float (0.0 ~ 1.0)
- **저장 시**: Int (0 ~ 10000) - `Math.round(ratio * 10000)`
- **비교 시**: Int로 변환하여 비교

### 4.3 Checkpoint 위치 표현
- `{edge: number, ratio: number, flags: number}`
- edge: 1-based index
- ratio: 0.0 ~ 1.0 (Float) 또는 0 ~ 10000 (Int)
- flags: CheckpointFlags bitmask

### 4.4 배열 구조 (1-based standard)
```typescript
checkpointArray[0] = MAX_CHECKPOINTS_PER_VEHICLE (메타)
checkpointArray[1 + vehicleId * SECTION_SIZE] = count (실제 개수)
checkpointArray[1 + vehicleId * SECTION_SIZE + 1 + cpIdx * 3 + 0] = edge
checkpointArray[1 + vehicleId * SECTION_SIZE + 1 + cpIdx * 3 + 1] = ratio (Int)
checkpointArray[1 + vehicleId * SECTION_SIZE + 1 + cpIdx * 3 + 2] = flags
```

---

## 5. 파일 위치

| 파일 | 역할 |
|------|------|
| `src/common/vehicle/logic/checkpoint/types.ts` | ✅ 타입 정의 완료 |
| `src/common/vehicle/logic/checkpoint/builder.ts` | 🚧 구조만 완료, 로직 구현 대기 |
| `src/common/vehicle/logic/checkpoint/utils.ts` | 유틸 함수 (distanceToRatio 등) |
| `src/common/vehicle/logic/checkpoint/index.ts` | Export 모듈 |

---

## 6. 내일 할 일

### Step 1: buildEdgeCheckpoints 로직 정리
- [ ] 이 함수에서 해야 할 일 구체화 (사용자가 알려줄 예정)
- [ ] 필요한 헬퍼 함수 리스트 작성

### Step 2: 헬퍼 함수 구현
- [ ] `calculatePathCheckpoint()`
- [ ] `calculateLockCheckpointsForEdge()`
- [ ] `findDistanceBackward()` (merge에서 역산)

### Step 3: buildCheckpoints 완성
- [ ] 전체 로직 연결
- [ ] 테스트

---

## 부록: CheckpointFlags

```typescript
export const CheckpointFlags = {
  NONE: 0,
  LOCK_REQUEST: 1 << 0,   // 0x01 - Lock 요청
  LOCK_WAIT: 1 << 1,      // 0x02 - Lock 대기
  LOCK_RELEASE: 1 << 2,   // 0x04 - Lock 해제
  MOVE_PREPARE: 1 << 3,   // 0x08 - 다음 edge 준비
  MOVE_SLOW: 1 << 4,      // 0x10 - 감속 구간
} as const;
```

**Bitmask 사용 예:**
```typescript
// 같은 위치에 여러 checkpoint 필요한 경우
flags = LOCK_RELEASE | LOCK_REQUEST  // 0x05 (Release + Request 동시)
```
