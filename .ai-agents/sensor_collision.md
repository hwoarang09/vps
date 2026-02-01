# Sensor & Collision System - AI Context

## File Map
```yaml
src/common/vehicle/collision/sensorPresets.ts:129
  exports:
    - DEFAULT_SENSOR_PRESETS: SensorPreset[]  # 기본 센서 프리셋 (6종)
    - PresetIndex: { STRAIGHT:0, CURVE_LEFT:1, CURVE_RIGHT:2, U_TURN:3, MERGE:4, BRANCH:5 }
    - getPreset(presetIdx, customPresets?): SensorPreset  # 프리셋 조회 헬퍼

  types:
    SensorPreset:
      zones: { approach, brake, stop }  # 각 zone별 SensorZone
      leftAngle, rightAngle: number     # 센서 각도 (degree)
      leftLength, rightLength: number   # 센서 길이

    SensorZone:
      leftAngle, rightAngle: number
      leftLength, rightLength: number
      dec: number  # 감속값 (-3, -4, -Infinity 등)

src/common/vehicle/collision/sensorCollision.ts:148
  constants:
    SENSOR_ZONE_COUNT: 3  # approach, brake, stop
    SENSOR_POINT_SIZE: 12  # 6 points * (x,y)
    SENSOR_DATA_SIZE: 36   # 3 zones * 12 floats

  exports:
    checkSensorCollision(sensorPointArray, sensorVehIdx, targetVehIdx): number
      - SAT 알고리즘 사용 (Zero-GC)
      - return: zone index (0=approach, 1=brake, 2=stop) or -1

    roughDistanceCheck(sensorPointArray, vehIdx1, vehIdx2, threshold): boolean
      - SAT 전 빠른 거리 필터

  SensorPoint offsets:
    FL_X:0, FL_Y:1, FR_X:2, FR_Y:3  # Front Left/Right
    BL_X:4, BL_Y:5, BR_X:6, BR_Y:7  # Back Left/Right
    SL_X:8, SL_Y:9, SR_X:10, SR_Y:11  # Sensor Left/Right

src/common/vehicle/collision/collisionCheck.ts:47
  exports:
    checkCollisions(ctx: CollisionCheckContext): void
      - 메인 충돌 체크 루프
      - 모든 edge 순회 → verifyEdgeCollision 호출

  types:
    CollisionCheckContext:
      vehicleArrayData: Float32Array
      edgeArray: Edge[]
      edgeVehicleQueue: IEdgeVehicleQueue
      sensorPointArray: ISensorPointArray
      config: CollisionConfig
      delta?: number  # 프레임 delta (초)
      collisionCheckTimers?: Map<number, number>  # 차량별 누적 시간

src/common/vehicle/collision/collisionCommon.ts:165
  types:
    CollisionConfig:
      approachMinSpeed: number
      brakeMinSpeed: number
      bodyLength: number
      collisionCheckInterval?: number  # ms, 기본값 33
      customSensorPresets?: SensorPreset[]  # fab별 오버라이드

  exports:
    getCollisionCheckParams(data, ptr, config): object
    determineLinearHitZone(distance, stopDist, brakeDist, approachDist): HitZone
    applyCollisionZoneLogic(hitZone, data, ptr, targetVehId, config): void
      - HitZone에 따라 VELOCITY, DECELERATION, MOVING_STATUS 설정
    shouldCheckCollision(vehId, delta, timers, interval): boolean
      - 차량별 충돌 체크 주기 관리

src/common/vehicle/collision/verifyEdgeCollision.ts:29
  - 단일 edge 충돌 검증 오케스트레이터
  - verifyNextPathCollision → verifyFollowingCollision → verifyMergeZoneCollision

src/common/vehicle/collision/verifyFollowingCollision.ts:67
  - 같은 edge 내 앞차 충돌 검사
  - edge.vos_rail_type 있으면 checkSensorCollision 사용
  - 없으면 determineLinearHitZone (단순 거리 기반)

src/common/vehicle/collision/verifyNextPathCollision.ts:115
  - 다음 edge 진입 차량과의 충돌 검사
  - BFS로 짧은 linear edge 연쇄 탐색

src/common/vehicle/collision/verifyMergeCollision.ts:172
  - 합류 구역 충돌 검사
  - 다른 incoming edge의 차량과 경쟁 상황 처리

src/common/vehicle/helpers/sensorPoints.ts:86
  exports:
    updateSensorPoints(sensorPointArray, vehIdx, x, y, rot, presetIdx, config): void
      - 차량 위치/회전 기반으로 센서 포인트 좌표 계산
      - 시각화 + 충돌 감지 모두에 사용

  types:
    SensorPointsConfig:
      bodyLength, bodyWidth: number
      customSensorPresets?: SensorPreset[]

src/common/vehicle/initialize/constants.ts
  HitZone:
    NONE: -1      # 감지 안됨
    APPROACH: 0   # 접근 (약한 감속)
    BRAKE: 1      # 제동 (강한 감속)
    STOP: 2       # 정지 (velocity=0)

  MovementData offsets:
    VELOCITY: 5
    DECELERATION: 8
    MOVING_STATUS: 10

  SensorData offsets:
    PRESET_IDX: 15
    HIT_ZONE: 16
    COLLISION_TARGET: 17

src/shmSimulator/types.ts
  SimulationConfig:
    customSensorPresets?: SensorPreset[]  # L129
    collisionCheckInterval?: number       # L117
```

## Logic Flow

### Collision Check Loop (매 프레임)
```
SimulationEngine.step()
→ FabContext.checkCollisions()
→ collisionCheck.checkCollisions(ctx)
  for each edge:
    → verifyEdgeCollision(edgeIdx, edge, ctx)
       → verifyNextPathCollision  # 다음 edge 앞차
       → verifyFollowingCollision # 같은 edge 앞차
       → verifyMergeZoneCollision # 합류점 경쟁차
```

### Sensor Point Update (매 프레임)
```
VehiclePhysics.updateVehicle()
→ updateSensorPoints(sensorPointArray, vehIdx, x, y, rot, presetIdx, config)
  → getPreset(presetIdx, config.customSensorPresets)
  → 각 zone(approach/brake/stop)별 6개 점 좌표 계산
```

### Collision Detection
```
checkSensorCollision(sensorPointArray, myIdx, targetIdx)
→ SAT (Separating Axis Theorem) 알고리즘
→ zone 2(stop) → 1(brake) → 0(approach) 순 체크 (inner→outer)
→ 충돌 발생 시 해당 zone index 반환

applyCollisionZoneLogic(hitZone, data, ptr, targetVehId, config)
→ HitZone.STOP: velocity=0, MOVING_STATUS=STOPPED
→ HitZone.BRAKE: velocity > brakeMinSpeed면 deceleration 적용
→ HitZone.APPROACH: velocity > approachMinSpeed면 deceleration 적용
→ HitZone.NONE: deceleration=0, STOPPED→MOVING
```

### Custom Preset Flow (fab별 센서 설정)
```
VehicleSharedMemoryMode.tsx
→ fabConfigStore.getFabSensorPresets(fabIndex)
→ configOverride = { customSensorPresets: sensorPresets }
→ initMultiFab({ fabs: [...], config })

Worker 측:
→ SimulationEngine.init(payload)
→ FabContext 생성 시 config.customSensorPresets 저장
→ checkCollisions/updateSensorPoints에서 getPreset(idx, customPresets) 사용
```

## Critical Rules

**getPreset 헬퍼 사용:**
- 직접 `DEFAULT_SENSOR_PRESETS[idx]` 접근 금지
- 반드시 `getPreset(presetIdx, config.customSensorPresets)` 사용
- fab별 커스텀 프리셋이 없으면 자동으로 기본값 사용

**Zone 우선순위:**
- 충돌 체크 시 inner(stop) → outer(approach) 순서
- 가장 가까운 zone이 우선 (강한 감속)

**충돌 체크 주기:**
- `collisionCheckInterval` (기본 33ms)
- 매 프레임마다 체크하지 않음 → 성능 최적화
- `shouldCheckCollision()`으로 스킵 여부 판단

**Zero-GC:**
- `checkSensorCollision`은 GC 발생 없음
- `tempRange` 객체 재사용
- 배열 생성 없이 인덱스 직접 접근

## Config

### SimulationConfig (src/shmSimulator/types.ts)
```yaml
customSensorPresets: SensorPreset[]  # fab별 커스텀 (없으면 DEFAULT_SENSOR_PRESETS)
collisionCheckInterval: number       # ms, 기본 33
approachMinSpeed: number             # 이 속도 이하면 approach 감속 안함
brakeMinSpeed: number                # 이 속도 이하면 brake 감속 안함
```

### SensorPreset 구조
```yaml
zones:
  approach: { leftAngle, rightAngle, leftLength, rightLength, dec: -3 }
  brake:    { leftAngle, rightAngle, leftLength, rightLength, dec: -4 }
  stop:     { leftAngle, rightAngle, leftLength, rightLength, dec: -Infinity }
leftAngle, rightAngle: number  # 시각화용 (degree)
leftLength, rightLength: number  # 시각화용
```

### PresetIndex 매핑
```yaml
0: STRAIGHT    # 직선 주행
1: CURVE_LEFT  # 좌회전
2: CURVE_RIGHT # 우회전
3: U_TURN      # 유턴
4: MERGE       # 합류
5: BRANCH      # 분기
```

## Impact Map

| 수정 | 확인 필요 |
|------|-----------|
| sensorPresets.ts 프리셋 값 변경 | 충돌 감지 거리/각도 달라짐, 시각화 확인 |
| getPreset 로직 변경 | 모든 collision verify 함수, updateSensorPoints |
| CollisionConfig 필드 추가 | FabContext, collisionCommon, verify* 파일들 |
| HitZone 상수 변경 | applyCollisionZoneLogic, 모든 hitZone 비교 로직 |
| customSensorPresets 전달 경로 | VehicleSharedMemoryMode → Worker → FabContext |
| 충돌 체크 주기 변경 | shouldCheckCollision, 모든 verify* 함수 |

## Debugging

### 센서 프리셋 적용 확인
```typescript
// sensorPresets.ts getPreset()에서
console.log('[getPreset]', { presetIdx, hasCustom: !!customPresets, result: preset });
```

### 충돌 감지 확인
```typescript
// sensorCollision.ts checkSensorCollision()에서
if (zone !== -1) {
  console.log('[Collision]', { sensorVehIdx, targetVehIdx, zone });
}
```

### fab별 설정 확인
```typescript
// VehicleSharedMemoryMode.tsx configOverride 생성 후
console.log('[FabConfig]', { fabId, hasSensorOverride, sensorPresets });
```
