# Lock System - AI Context

## 상태: 재설계 중

## FabContext.step() 순서

```
step(clampedDelta, simulationTime) {
  // 1. Collision Check (충돌 감지)
  //    → 센서 충돌로 멈출지 결정

  // 2. Lock 관리
  //    → 합류점에서 멈출지 결정
  //    → 멈출 차량: velocity=0 또는 플래그 설정

  // 3. Movement Update (움직임)
  //    → 1,2에서 멈추지 않은 차량만 이동
  //    → edge 전환 발생 가능

  // 4. Auto Routing (경로 설정)
  //    → edge 전환 후 새 경로 필요한 차량 처리
  //    → 다익스트라로 pathBuffer 갱신

  // 5. Write to Render Buffer (렌더링 데이터)
}
```

## LockMgr 구조

```typescript
class LockMgr {
  // 참조 (init에서 저장)
  private vehicleDataArray: Float32Array;
  private nodes: Node[];
  private edges: Edge[];

  // 락 상태
  private mergeNodes: Set<string>;           // merge node 목록
  private locks: Map<string, number>;        // nodeName → vehId (현재 점유)
  private queues: Map<string, number[]>;     // nodeName → vehId[] (대기 큐)

  // 초기화
  init(vehicleDataArray, nodes, edges): void

  // 매 프레임 호출 (step 2단계)
  updateAll(numVehicles, policy): void {
    for (let i = 0; i < numVehicles; i++) {
      this.processLock(i, policy);
    }
  }

  // 개별 차량 락 처리
  processLock(vehicleId, policy): void {
    // TODO: 구현 예정
  }
}
```

## processLock 로직 (TODO)

```
processLock(vehicleId, policy):
  1. vehicleDataArray에서 현재 상태 읽기
     - currentEdge, ratio, nextEdge 등

  2. 다음 edge의 to_node가 merge인지 확인
     - mergeNodes.has(nextEdge.to_node)

  3. merge면 락 처리
     - locks에 다른 차량 있으면 → queue에 추가, 멈춤 처리
     - locks에 없거나 본인이면 → 통과 허용

  4. 멈춤 처리 방법
     - velocity = 0
     - 또는 StopReason에 LOCKED 플래그 설정

  5. 통과 후 release
     - edge 전환 완료 시 locks에서 제거
     - queue 맨 앞 차량에게 grant
```

## 파일 위치

| 파일 | 역할 |
|------|------|
| `src/common/vehicle/logic/LockMgr.ts` | 락 시스템 메인 |
| `src/shmSimulator/core/FabContext.ts` | step()에서 updateAll 호출 |
| `.ai-agents/lock_agents.md` | 이 문서 |
