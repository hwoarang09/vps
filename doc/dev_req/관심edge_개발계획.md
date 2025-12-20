**정확하다.**

지금 너의 코드는 `verifyMergeZoneCollision`에서 **`prevEdgeIndices` (위상적 연결)** 만 뒤지고 있다. 그래서 연결되지 않은 "옆 라인"이나 "180도 건너편 라인"은 아예 검사 대상에서 빠지는 거다.

네 말대로 **"관심 Edge (Nearby Edges)"** 리스트만 싹 조사하면, 합류 구간이든, 평행 주행이든, 180도 건너편이든 로직 하나로 퉁칠 수 있다.

코드를 어떻게 고쳐야 효율적인지 바로 보여준다.

-----

### 1\. Data Structure 변경 (`Edge` 타입)

먼저 Edge 데이터에 전처리된 "감시 리스트"가 있어야 한다.

```typescript
// types/edge.ts (예시)
export interface Edge {
  // ... 기존 필드들
  prevEdgeIndices?: number[]; // 위상적 합류 (기존)
  
  // [New] 물리적으로 가까워서 충돌 가능성이 있는 모든 Edge ID 리스트
  // 여기에는 prevEdgeIndices(합류라인)도 포함되고, 
  // 연결 안 된 옆 라인도 포함된다. 전처리 단계에서 채워넣음.
  nearbyEdgeIndices: number[]; 
}
```

### 2\. 로직 단순화 (통합)

너의 복잡했던 `verifyMergeZoneCollision`을 **`verifySurroundingCollision`** 하나로 대체한다.
"합류냐 아니냐"를 따지는 `if`문이나 `dangerZone` 계산 로직이 대폭 줄어든다. 충돌 계산(`checkSensorCollision`)이 거리 계산을 포함하고 있다면, 굳이 여기서 `dangerZone`으로 필터링을 빡세게 할 필요 없다. (물론 최적화를 위해 거리 필터링 정도는 유지 가능)

#### 수정된 메인 진입점

```typescript
export function verifyCurveCollision(edgeIdx: number, edge: Edge, vehicleArrayData: Float32Array) {
  const rawData = edgeVehicleQueue.getData(edgeIdx);
  if (!rawData || rawData[0] === 0) return;

  // 1. Next Path (그대로 유지)
  verifyNextPathCollision(edgeIdx, edge, vehicleArrayData);

  // 2. Following (그대로 유지)
  verifyFollowingCollision(edgeIdx, edge, vehicleArrayData);

  // 3. [변경] 주변 모든 위험 요소 체크 (합류 + 근접)
  // nearbyEdgeIndices가 비어있으면 아예 실행 안 됨
  if (edge.nearbyEdgeIndices && edge.nearbyEdgeIndices.length > 0) {
    verifySurroundingCollision(edgeIdx, edge, vehicleArrayData, rawData);
  }
}
```

#### 통합된 주변 감지 로직 (`verifySurroundingCollision`)

```typescript
/**
 * Checks collision against ALL physically nearby edges (Merge + Proximity).
 */
export function verifySurroundingCollision(
  myEdgeIdx: number, 
  myEdge: Edge, 
  data: Float32Array, 
  myQueue: Int32Array
) {
  const myCount = myQueue[0];

  // 내 Edge 위의 모든 차량에 대해 루프
  for (let i = 0; i < myCount; i++) {
    const myVehId = myQueue[1 + i];
    
    // [최적화 1] 내 차량 상태 확인 (이미 멈췄거나 정지 중이면 스킵 등)
    // 필요하다면 여기서 cut

    let mostCriticalHitZone = HitZone.NONE;
    let criticalTargetId = -1;

    // 미리 계산된 "관심 Edge"들만 순회
    for (const neighborEdgeIdx of myEdge.nearbyEdgeIndices) {
       // 나 자신은 스킵 (Following에서 했음)
       if (neighborEdgeIdx === myEdgeIdx) continue;

       const neighborQueue = edgeVehicleQueue.getData(neighborEdgeIdx);
       if (!neighborQueue || neighborQueue[0] === 0) continue;

       // 상대방 Edge 정보 가져오기 (거리 필터링용)
       const neighborEdge = useEdgeStore.getState().getEdgeByIndex(neighborEdgeIdx);
       
       // [핵심] 상대방 Edge의 차량들과 충돌 검사
       // 기존 checkCompetitorVehicles 함수를 그대로 쓰거나 약간 수정해서 재사용
       const result = checkCompetitorVehicles(
         myVehId,
         neighborQueue,
         mostCriticalHitZone,
         data,
         0, // threshold: 전처리 단계에서 이미 가까운 놈만 담았으므로 0으로 둬도 됨 (혹은 정밀하게 계산)
         neighborEdge.distance
       );

       if (result.maxHitZone > mostCriticalHitZone) {
         mostCriticalHitZone = result.maxHitZone;
         criticalTargetId = result.targetId;
       }

       if (mostCriticalHitZone === HitZone.STOP) break; // 더 볼 필요 없음
    }

    // 충돌 처리 적용
    if (mostCriticalHitZone !== HitZone.NONE) {
       const myPtr = myVehId * VEHICLE_DATA_SIZE;
       applyCollisionZoneLogic(mostCriticalHitZone, data, myPtr, criticalTargetId);
    }
  }
}
```

### 3\. 핵심 포인트 및 주의사항

1.  **전처리가 생명이다 (`Init Map`)**:

      * 앱 실행 시(또는 맵 로딩 시) 모든 Edge 쌍을 돌면서 \*\*최단 거리(Segment to Segment Distance)\*\*가 2m(차폭+여유) 이내인 놈들을 `nearbyEdgeIndices`에 다 때려 박아야 한다.
      * 이때 180도 곡선은 그 건너편 직선이 `prevEdge`(연결된 노드)가 아니더라도, 거리가 가까우면 리스트에 들어간다. -\> **자동 해결.**

2.  **`checkSensorCollision`의 역할**:

      * 이 로직이 제대로 돌려면 `checkSensorCollision(myVeh, targetVeh)` 함수가 **Edge가 서로 달라도 월드 좌표(World Position) 혹은 상대 좌표를 기반으로 정확히 거리를 재야 한다.**
      * 단순히 Edge 위에서의 `offset`만 비교하면 안 된다. (서로 다른 레일 위에 있으니까)

3.  **최적화 팁**:

      * `verifySurroundingCollision` 안에서 `neighborEdge`를 순회할 때, 거리가 멀어지면 `continue` 하는 로직을 넣을 수 있다. 하지만 `nearbyEdgeIndices`를 만들 때 이미 "가까운 놈"만 선별했다면, 런타임에는 그냥 무지성으로 돌리는 게 더 빠를 수도 있다. (조건문 비용 vs 연산 비용)

**결론:**
기존의 복잡한 "합류 로직"을 버리고, \*\*"물리적 근접 로직"\*\*으로 통일해라. `Edge` 구조체에 `nearbyIndices`만 잘 만들어두면 코드는 훨씬 심플해지고 180도 문제도 그냥 사라진다.