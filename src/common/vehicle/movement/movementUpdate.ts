// common/vehicle/movement/movementUpdate.ts

import type { Edge } from "@/types/edge";
import { EdgeType } from "@/types";
import {
  VEHICLE_DATA_SIZE,
  MovementData,
  SensorData,
  MovingStatus,
  NextEdgeState,
  LogicData,
  StopReason,
  TrafficState,
} from "@/common/vehicle/initialize/constants";
import { calculateNextSpeed, calculateBrakeDistance, type SpeedConfig } from "@/common/vehicle/physics/speedCalculator";
import { handleEdgeTransition, type EdgeTransitionResult, type IEdgeTransitionStore } from "./edgeTransition";
import { interpolatePositionTo, type PositionResult } from "./positionInterpolator";
import { updateSensorPoints, type SensorPointsConfig } from "@/common/vehicle/helpers/sensorPoints";
import type { LockMgr } from "@/common/vehicle/logic/LockMgr";
import type { TransferMgr, VehicleLoop } from "@/common/vehicle/logic/TransferMgr";
import { TransferMode } from "@/shmSimulator/types";
import type { ISensorPointArray } from "@/common/vehicle/collision/sensorCollision";

export interface IVehicleDataArray {
  getData(): Float32Array;
}

export interface MovementConfig extends SpeedConfig, SensorPointsConfig {
  vehicleZOffset: number;
  curveMaxSpeed: number;
  curveAcceleration: number;
  /** 곡선 사전 감속에 사용할 감속도 (음수, m/s²) - 직선 구간에서 적용 */
  linearPreBrakeDeceleration?: number;
  /** 곡선 사전 감속 체크 주기 (ms) */
  curvePreBrakeCheckInterval?: number;
}

/**
 * Edge 통과 이벤트 콜백
 * @param vehId Vehicle index
 * @param fromEdgeIndex 떠나는 edge index
 * @param toEdgeIndex 진입하는 edge index
 * @param timestamp 현재 시뮬레이션 시간 (ms)
 */
export type OnEdgeTransitCallback = (
  vehId: number,
  fromEdgeIndex: number,
  toEdgeIndex: number,
  timestamp: number
) => void;

export interface MovementUpdateContext {
  vehicleDataArray: IVehicleDataArray;
  sensorPointArray: ISensorPointArray;
  edgeArray: Edge[];
  actualNumVehicles: number;
  vehicleLoopMap: Map<number, VehicleLoop>;
  edgeNameToIndex: Map<string, number>;
  store: IEdgeTransitionStore & { transferMode: TransferMode };
  lockMgr: LockMgr;
  transferMgr: TransferMgr;
  clampedDelta: number;
  config: MovementConfig;
  /** 시뮬레이션 누적 시간 (ms) - 로깅용 */
  simulationTime?: number;
  /** Edge 통과 이벤트 콜백 (로깅용) */
  onEdgeTransit?: OnEdgeTransitCallback;
  /** 곡선 사전 감속 체크를 위한 차량별 누적 시간 (ms) */
  curveBrakeCheckTimers?: Map<number, number>;
}

// Zero-GC Scratchpads
const SCRATCH_TRANSITION: EdgeTransitionResult = {
  finalEdgeIndex: 0,
  finalRatio: 0,
  activeEdge: null,
};

const SCRATCH_POS: PositionResult = {
  x: 0,
  y: 0,
  z: 0,
  rotation: 0,
};

const SCRATCH_MERGE_POS: PositionResult = {
  x: 0,
  y: 0,
  z: 0,
  rotation: 0,
};

const SCRATCH_ACCEL = {
  accel: 0,
  decel: 0,
};

const SCRATCH_TARGET_CHECK = {
  finalRatio: 0,
  finalVelocity: 0,
  reached: false,
};

// ============================================================================
// Vehicle Physics 계산 결과 타입
// ============================================================================

interface VehiclePhysicsResult {
  /** 계산된 새 속도 (m/s) */
  newVelocity: number;
  /** 새로운 Edge 비율 (0~1 범위 초과 가능) */
  rawNewRatio: number;
  /** 목표 비율 (clamped 0~1) */
  targetRatio: number;
  /** 현재 Edge 인덱스 */
  currentEdgeIndex: number;
  /** 현재 Edge 참조 */
  currentEdge: Edge;
  /** 센서 정지로 스킵해야 하는지 여부 */
  shouldSkip: boolean;
}

// Zero-GC Scratchpad for physics result
const SCRATCH_PHYSICS: VehiclePhysicsResult = {
  newVelocity: 0,
  rawNewRatio: 0,
  targetRatio: 0,
  currentEdgeIndex: 0,
  currentEdge: null as unknown as Edge,
  shouldSkip: false,
};

// ============================================================================
// Edge 전환 처리 결과 타입
// ============================================================================

interface VehicleTransitionResult {
  /** 최종 Edge 인덱스 */
  finalEdgeIndex: number;
  /** 최종 Edge 비율 */
  finalRatio: number;
  /** 활성 Edge (위치 계산용) */
  activeEdge: Edge | null;
  /** 최종 속도 (동일 Edge에서 target 도달 시 0) */
  finalVelocity: number;
}

// Zero-GC Scratchpad for transition result
const SCRATCH_VEHICLE_TRANSITION: VehicleTransitionResult = {
  finalEdgeIndex: 0,
  finalRatio: 0,
  activeEdge: null,
  finalVelocity: 0,
};

// ============================================================================
// 위치 계산 결과 타입
// ============================================================================

interface VehiclePositionResult {
  /** 최종 X 좌표 */
  finalX: number;
  /** 최종 Y 좌표 */
  finalY: number;
  /** 최종 Z 좌표 */
  finalZ: number;
  /** 최종 회전값 */
  finalRotation: number;
  /** 최종 Edge 비율 (merge 대기로 조정될 수 있음) */
  finalRatio: number;
  /** 최종 속도 (merge 대기 시 0) */
  finalVelocity: number;
}

// Zero-GC Scratchpad for position result
const SCRATCH_VEHICLE_POSITION: VehiclePositionResult = {
  finalX: 0,
  finalY: 0,
  finalZ: 0,
  finalRotation: 0,
  finalRatio: 0,
  finalVelocity: 0,
};

// ============================================================================
// Phase 1: calculateVehiclePhysics
// 가속도, 충돌 감지, 속도 계산을 담당
// ============================================================================

/**
 * 차량의 물리 계산을 수행합니다.
 * - 충돌 감지 (hitZone)
 * - 가속/감속 결정
 * - 곡선 사전 감속 체크
 * - 새 속도 및 Edge 비율 계산
 *
 * @param ctx Movement 업데이트 컨텍스트
 * @param vehicleIndex 차량 인덱스
 * @param data Float32Array 데이터
 * @param ptr 차량 데이터 포인터 (vehicleIndex * VEHICLE_DATA_SIZE)
 * @param out 결과를 저장할 scratchpad
 * @returns out 참조 (shouldSkip이 true면 이후 단계 스킵 필요)
 */
function calculateVehiclePhysics(
  ctx: MovementUpdateContext,
  vehicleIndex: number,
  data: Float32Array,
  ptr: number,
  out: VehiclePhysicsResult
): VehiclePhysicsResult {
  const { edgeArray, transferMgr, clampedDelta, config } = ctx;

  const currentEdgeIndex = data[ptr + MovementData.CURRENT_EDGE];
  const velocity = data[ptr + MovementData.VELOCITY];
  const acceleration = data[ptr + MovementData.ACCELERATION];
  const deceleration = data[ptr + MovementData.DECELERATION];
  const edgeRatio = data[ptr + MovementData.EDGE_RATIO];

  const currentEdge = edgeArray[currentEdgeIndex];

  // 충돌 감지 영역 계산
  const hitZone = calculateHitZone(data, ptr, deceleration);

  // 적용할 가속도/감속도 계산
  calculateAppliedAccelAndDecel(
    acceleration,
    deceleration,
    currentEdge,
    hitZone,
    config.curveAcceleration,
    SCRATCH_ACCEL
  );
  const appliedAccel = SCRATCH_ACCEL.accel;
  const appliedDecel = SCRATCH_ACCEL.decel;

  // 센서 정지 처리 (hitZone === 2이면 즉시 정지)
  if (checkAndProcessSensorStop(hitZone, data, ptr)) {
    out.shouldSkip = true;
    return out;
  }

  // 곡선 사전 감속 체크 (가속 전에 먼저 확인)
  const curveBrakeResult = checkCurvePreBraking({
    vehId: vehicleIndex,
    currentEdge,
    currentRatio: edgeRatio,
    currentVelocity: velocity,
    edgeArray,
    transferMgr,
    config,
    delta: clampedDelta,
    curveBrakeCheckTimers: ctx.curveBrakeCheckTimers,
  });

  // 감속 중이면 가속 막기
  const finalAccel = curveBrakeResult.shouldBrake ? 0 : appliedAccel;
  const finalDecel = curveBrakeResult.shouldBrake ? curveBrakeResult.deceleration : appliedDecel;

  // 새 속도 계산
  const newVelocity = calculateNextSpeed(
    velocity,
    finalAccel,
    finalDecel,
    currentEdge,
    clampedDelta,
    config
  );

  // 목표 비율 및 새 Edge 비율 계산
  const targetRatio = clampTargetRatio(data[ptr + MovementData.TARGET_RATIO]);
  const rawNewRatio = edgeRatio + (newVelocity * clampedDelta) / currentEdge.distance;

  // 결과 저장
  out.newVelocity = newVelocity;
  out.rawNewRatio = rawNewRatio;
  out.targetRatio = targetRatio;
  out.currentEdgeIndex = currentEdgeIndex;
  out.currentEdge = currentEdge;
  out.shouldSkip = false;

  return out;
}

// ============================================================================
// Phase 2: processVehicleTransition
// Edge 전환 처리를 담당
// ============================================================================

/**
 * 차량의 Edge 전환을 처리합니다.
 * - Transfer 큐 트리거
 * - Edge 전환 로직 실행
 * - 동일 Edge에서의 target 도달 체크
 * - Merge Lock 해제
 *
 * @param ctx Movement 업데이트 컨텍스트
 * @param vehicleIndex 차량 인덱스
 * @param data Float32Array 데이터
 * @param ptr 차량 데이터 포인터
 * @param physics 이전 단계의 물리 계산 결과
 * @param out 결과를 저장할 scratchpad
 * @returns out 참조
 */
function processVehicleTransition(
  ctx: MovementUpdateContext,
  vehicleIndex: number,
  data: Float32Array,
  ptr: number,
  physics: VehiclePhysicsResult,
  out: VehicleTransitionResult
): VehicleTransitionResult {
  const { transferMgr, lockMgr } = ctx;
  const { rawNewRatio, targetRatio, currentEdgeIndex, currentEdge, newVelocity } = physics;

  // Transfer 큐 트리거 (ratio >= 0 && EMPTY 상태일 때)
  checkAndTriggerTransfer(transferMgr, data, ptr, vehicleIndex, rawNewRatio);

  // Edge 전환 로직 처리
  processEdgeTransitionLogic(
    ctx,
    vehicleIndex,
    currentEdgeIndex,
    currentEdge,
    rawNewRatio,
    targetRatio,
    SCRATCH_TRANSITION
  );

  const finalEdgeIndex = SCRATCH_TRANSITION.finalEdgeIndex;
  let finalRatio = SCRATCH_TRANSITION.finalRatio;
  const activeEdge = SCRATCH_TRANSITION.activeEdge;
  let finalVelocity = newVelocity;

  // 동일 Edge에서의 target 도달 체크
  // Edge 전환이 일어나면 momentum 유지, 동일 Edge면 target limit 체크
  if (processSameEdgeLogic(
    finalEdgeIndex === currentEdgeIndex,
    rawNewRatio,
    targetRatio,
    newVelocity,
    data,
    ptr,
    SCRATCH_TARGET_CHECK
  )) {
    finalRatio = SCRATCH_TARGET_CHECK.finalRatio;
    finalVelocity = SCRATCH_TARGET_CHECK.finalVelocity;
  }

  // Merge Lock 해제 (Edge 전환 시)
  checkAndReleaseMergeLock(lockMgr, finalEdgeIndex, currentEdgeIndex, currentEdge, vehicleIndex);

  // 결과 저장
  out.finalEdgeIndex = finalEdgeIndex;
  out.finalRatio = finalRatio;
  out.activeEdge = activeEdge;
  out.finalVelocity = finalVelocity;

  return out;
}

// ============================================================================
// Phase 3: updateVehiclePosition
// 실제 좌표 계산 및 merge 대기 처리
// ============================================================================

/**
 * Phase 3: 차량의 실제 좌표를 계산합니다.
 *
 * ## 왜 interpolatePositionTo를 2번 호출하는가?
 *
 * ### 1차 호출 (394-400줄)
 * - Edge transition 후의 기본 위치 계산
 * - finalRatio에 해당하는 실제 좌표(x, y, z, rotation) 계산
 *
 * ### 2차 호출 (418-424줄) - Merge 대기 시에만
 * - 차량이 대기 지점을 넘어간 경우에만 발생
 * - finalRatio가 대기 지점으로 변경되므로 좌표를 다시 계산해야 함
 *
 * #### 예시:
 * ```
 * 1. 속도 계산 후: finalRatio=0.85
 * 2. 1차 interpolatePositionTo(0.85) → 위치 A
 * 3. Merge 대기 체크: 대기 지점이 0.80
 * 4. shouldWait=true, finalRatio를 0.80으로 되돌림
 * 5. 2차 interpolatePositionTo(0.80) → 위치 B (대기 지점)
 * 6. 결과: 차량은 위치 B에 멈춤
 * ```
 *
 * @param ctx Movement 업데이트 컨텍스트
 * @param vehicleIndex 차량 인덱스
 * @param data Float32Array 데이터
 * @param ptr 차량 데이터 포인터
 * @param transition 이전 단계의 전환 결과
 * @param out 결과를 저장할 scratchpad
 * @returns out 참조
 */
function updateVehiclePosition(
  ctx: MovementUpdateContext,
  vehicleIndex: number,
  data: Float32Array,
  ptr: number,
  transition: VehicleTransitionResult,
  out: VehiclePositionResult
): VehiclePositionResult {
  const { edgeArray, lockMgr, config } = ctx;
  const { finalEdgeIndex, activeEdge } = transition;
  let { finalRatio, finalVelocity } = transition;

  // 기본 좌표값 (이전 값 유지)
  let finalX = data[ptr + MovementData.X];
  let finalY = data[ptr + MovementData.Y];
  let finalZ = data[ptr + MovementData.Z];
  let finalRotation = data[ptr + MovementData.ROTATION];

  // 1차 위치 보간: Edge transition 후 기본 위치 계산
  if (activeEdge) {
    interpolatePositionTo(activeEdge, finalRatio, SCRATCH_POS, config.vehicleZOffset);
    finalX = SCRATCH_POS.x;
    finalY = SCRATCH_POS.y;
    finalZ = SCRATCH_POS.z;
    finalRotation = SCRATCH_POS.rotation;
  }

  // Merge 대기 처리
  const finalEdge = edgeArray[finalEdgeIndex];
  const shouldWait = checkAndProcessMergeWait(
    lockMgr,
    finalEdge,
    vehicleIndex,
    finalRatio,
    data,
    ptr,
    SCRATCH_MERGE_POS
  );

  if (shouldWait) {
    // 차량이 대기 지점을 넘어간 경우: 대기 지점으로 되돌림
    finalRatio = SCRATCH_MERGE_POS.x;  // 새로운 ratio (대기 지점)

    // 2차 위치 보간: 변경된 ratio에 맞는 좌표 재계산
    if (activeEdge) {
      interpolatePositionTo(activeEdge, finalRatio, SCRATCH_POS, config.vehicleZOffset);
      finalX = SCRATCH_POS.x;
      finalY = SCRATCH_POS.y;
      finalZ = SCRATCH_POS.z;
      finalRotation = SCRATCH_POS.rotation;
    }
    finalVelocity = 0;  // 대기 중이므로 속도 0
  }

  // 결과 저장
  out.finalX = finalX;
  out.finalY = finalY;
  out.finalZ = finalZ;
  out.finalRotation = finalRotation;
  out.finalRatio = finalRatio;
  out.finalVelocity = finalVelocity;

  return out;
}

// ============================================================================
// Phase 4: commitVehicleState
// 최종 데이터 기록
// ============================================================================

/**
 * 차량의 최종 상태를 Float32Array에 기록합니다.
 * - 속도, Edge 비율, Edge 인덱스
 * - 좌표 (X, Y, Z) 및 회전값
 * - 센서 포인트 업데이트
 *
 * @param ctx Movement 업데이트 컨텍스트
 * @param vehicleIndex 차량 인덱스
 * @param data Float32Array 데이터
 * @param ptr 차량 데이터 포인터
 * @param finalEdgeIndex 최종 Edge 인덱스
 * @param position 이전 단계의 위치 계산 결과
 */
function commitVehicleState(
  ctx: MovementUpdateContext,
  vehicleIndex: number,
  data: Float32Array,
  ptr: number,
  finalEdgeIndex: number,
  position: VehiclePositionResult
): void {
  const { sensorPointArray, config } = ctx;
  const { finalVelocity, finalRatio, finalX, finalY, finalZ, finalRotation } = position;

  // Movement 데이터 기록
  data[ptr + MovementData.VELOCITY] = finalVelocity;
  data[ptr + MovementData.EDGE_RATIO] = finalRatio;
  data[ptr + MovementData.CURRENT_EDGE] = finalEdgeIndex;

  // 좌표 데이터 기록
  data[ptr + MovementData.X] = finalX;
  data[ptr + MovementData.Y] = finalY;
  data[ptr + MovementData.Z] = finalZ;
  data[ptr + MovementData.ROTATION] = finalRotation;

  // 센서 포인트 업데이트
  const presetIdx = Math.trunc(data[ptr + SensorData.PRESET_IDX]);
  updateSensorPoints(sensorPointArray, vehicleIndex, finalX, finalY, finalRotation, presetIdx, config);
}

// ============================================================================
// Main Entry Point: updateMovement
// 4단계 파이프라인으로 차량 움직임을 업데이트
// ============================================================================

export function updateMovement(ctx: MovementUpdateContext) {
  const {
    vehicleDataArray,
    edgeArray,
    actualNumVehicles,
    vehicleLoopMap,
    edgeNameToIndex,
    store,
    transferMgr,
    clampedDelta,
  } = ctx;

  const data = vehicleDataArray.getData();

  // Transfer 큐 처리 (루프 시작 전에 한 번만 실행)
  transferMgr.processTransferQueue(
    vehicleDataArray,
    edgeArray,
    vehicleLoopMap,
    edgeNameToIndex,
    store.transferMode
  );

  // 각 차량에 대해 4단계 파이프라인 실행
  for (let i = 0; i < actualNumVehicles; i++) {
    const ptr = i * VEHICLE_DATA_SIZE;

    // 업데이트 스킵 조건 체크 (PAUSED, STOPPED 등)
    if (shouldSkipUpdate(data, ptr)) {
      continue;
    }

    // Phase 1: 물리 계산 (가속도, 충돌 감지, 속도)
    calculateVehiclePhysics(ctx, i, data, ptr, SCRATCH_PHYSICS);
    if (SCRATCH_PHYSICS.shouldSkip) {
      continue;
    }

    // Phase 2: Edge 전환 처리
    processVehicleTransition(ctx, i, data, ptr, SCRATCH_PHYSICS, SCRATCH_VEHICLE_TRANSITION);

    // Phase 3: 위치 계산 및 merge 대기 처리
    updateVehiclePosition(ctx, i, data, ptr, SCRATCH_VEHICLE_TRANSITION, SCRATCH_VEHICLE_POSITION);

    // Phase 4: 최종 상태 기록
    commitVehicleState(
      ctx,
      i,
      data,
      ptr,
      SCRATCH_VEHICLE_TRANSITION.finalEdgeIndex,
      SCRATCH_VEHICLE_POSITION
    );
  }
}

function shouldSkipUpdate(data: Float32Array, ptr: number): boolean {
  const status = data[ptr + MovementData.MOVING_STATUS];

  if (status === MovingStatus.PAUSED) {
    return true;
  }

  if (status === MovingStatus.STOPPED) {
    data[ptr + MovementData.VELOCITY] = 0;
    return true;
  }

  if (status !== MovingStatus.MOVING) {
    data[ptr + MovementData.VELOCITY] = 0;
    return true;
  }

  return false;
}

function checkAndTriggerTransfer(
  transferMgr: TransferMgr,
  data: Float32Array,
  ptr: number,
  vehIdx: number,
  ratio: number
) {
  const nextEdgeState = data[ptr + MovementData.NEXT_EDGE_STATE];
  if (ratio >= 0 && nextEdgeState === NextEdgeState.EMPTY) {
    data[ptr + MovementData.NEXT_EDGE_STATE] = NextEdgeState.PENDING;
    transferMgr.enqueueVehicleTransfer(vehIdx);
  }
}

function processEdgeTransitionLogic(
  ctx: MovementUpdateContext,
  vehicleIndex: number,
  currentEdgeIndex: number,
  currentEdge: Edge,
  rawNewRatio: number,
  targetRatio: number,
  out: EdgeTransitionResult
) {
  const data = ctx.vehicleDataArray.getData();
  const ptr = vehicleIndex * VEHICLE_DATA_SIZE;
  const nextEdgeState = data[ptr + MovementData.NEXT_EDGE_STATE];

  // Transition conditions:
  // 1. Reached end (rawNewRatio >= 1) AND targetRatio === 1 (normal case)
  // 2. Reached end (rawNewRatio >= 1) AND NEXT_EDGE is ready (MQTT command with nextEdge)
  //    - This handles case where targetRatio < currentRatio but nextEdge is set
  const shouldTransition = rawNewRatio >= 1 && (targetRatio === 1 || nextEdgeState === NextEdgeState.READY);

  if (shouldTransition) {
    // In MQTT_CONTROL mode, preserve TARGET_RATIO (don't overwrite with 1)
    const preserveTargetRatio = ctx.store.transferMode === TransferMode.MQTT_CONTROL;

    // Check if there's a reserved target ratio for the next edge (fixes premature target application bug)
    const nextTargetRatio = ctx.transferMgr.consumeNextEdgeReservation(vehicleIndex);

    handleEdgeTransition({
      vehicleDataArray: ctx.vehicleDataArray,
      store: ctx.store,
      vehicleIndex: vehicleIndex,
      initialEdgeIndex: currentEdgeIndex,
      initialRatio: rawNewRatio,
      edgeArray: ctx.edgeArray,
      target: out,
      preserveTargetRatio: preserveTargetRatio,
      nextTargetRatio: nextTargetRatio
    });

    // Edge transit 콜백 호출 (로깅용)
    if (ctx.onEdgeTransit && out.finalEdgeIndex !== currentEdgeIndex) {
      ctx.onEdgeTransit(
        vehicleIndex,
        currentEdgeIndex,
        out.finalEdgeIndex,
        ctx.simulationTime ?? 0
      );
    }

    // Edge 전환 완료 - 경로에서 지나간 Edge 제거
    if (out.finalEdgeIndex !== currentEdgeIndex) {
      const passedEdge = ctx.edgeArray[out.finalEdgeIndex];
      if (passedEdge) {
        ctx.transferMgr.onEdgeTransition(vehicleIndex, passedEdge.edge_name);
      }
    }
  } else {
    // Just update position on current edge
    out.finalEdgeIndex = currentEdgeIndex;
    out.finalRatio = rawNewRatio;
    out.activeEdge = currentEdge;
  }
}

/**
 * Merge 대기 로직 처리
 *
 * @returns true = 대기 필요 (차량이 대기 지점을 넘어가서 위치 조정 필요)
 *          false = 대기 불필요 (통과 가능 또는 대기 지점 도달 전)
 *
 * ## 중요: return true일 때 위치 재계산이 필요한 이유
 *
 * 차량이 속도 계산 후 대기 지점(waitDistance)을 넘어갔을 때:
 * 1. target.x에 대기 지점의 ratio를 설정 (차량을 뒤로 당김)
 * 2. 호출자는 이 새로운 ratio로 interpolatePositionTo를 재호출해야 함
 *
 * 예시:
 * - 현재 위치: ratio=0.75
 * - 속도 계산 후: ratio=0.85 (너무 멀리 감)
 * - 대기 지점: waitDist=0.80
 * - 결과: target.x=0.80으로 설정, return true
 * - 호출자: ratio를 0.80으로 변경하고 좌표 재계산 필요
 */
function processMergeLogicInline(
  lockMgr: LockMgr,
  currentEdge: Edge,
  vehId: number,
  currentRatio: number,
  data: Float32Array,
  ptr: number,
  target: PositionResult
): boolean {
  // Merge Node가 아니면 자유 통행
  if (!lockMgr.isMergeNode(currentEdge.to_node)) {
    const currentReason = data[ptr + LogicData.STOP_REASON];
    if ((currentReason & StopReason.LOCKED) !== 0) {
      data[ptr + LogicData.STOP_REASON] = currentReason & ~StopReason.LOCKED;
    }
    data[ptr + LogicData.TRAFFIC_STATE] = TrafficState.FREE;
    return false;
  }

  // 처음 진입 시 Lock 요청
  const currentTrafficState = data[ptr + LogicData.TRAFFIC_STATE];
  if (currentTrafficState === TrafficState.FREE) {
    lockMgr.requestLock(currentEdge.to_node, currentEdge.edge_name, vehId);
  }

  // Lock 획득 여부 확인
  const isGranted = lockMgr.checkGrant(currentEdge.to_node, vehId);
  const currentReason = data[ptr + LogicData.STOP_REASON];

  if (isGranted) {
    // Lock 획득 성공 - 통과 가능
    if ((currentReason & StopReason.LOCKED) !== 0) {
      data[ptr + LogicData.STOP_REASON] = currentReason & ~StopReason.LOCKED;
    }
    data[ptr + LogicData.TRAFFIC_STATE] = TrafficState.ACQUIRED;
    return false;
  }

  // Lock 획득 실패 - 대기 상태
  data[ptr + LogicData.TRAFFIC_STATE] = TrafficState.WAITING;

  const waitDist = lockMgr.getWaitDistance(currentEdge);
  const currentDist = currentRatio * currentEdge.distance;

  // 핵심: 차량이 대기 지점을 넘어갔는지 체크
  if (currentDist >= waitDist) {
    // 차량이 너무 멀리 갔으므로 대기 지점으로 되돌림
    data[ptr + LogicData.STOP_REASON] = currentReason | StopReason.LOCKED;
    // target.x에 새로운 ratio를 저장 (호출자가 위치 재계산에 사용)
    target.x = waitDist / currentEdge.distance;
    return true; // 위치 재계산 필요!
  }

  // 대기 지점 이전이면 현재 위치 유지
  if ((currentReason & StopReason.LOCKED) !== 0) {
    data[ptr + LogicData.STOP_REASON] = currentReason & ~StopReason.LOCKED;
  }

  return false;
}

function checkAndProcessMergeWait(
  lockMgr: LockMgr,
  finalEdge: Edge,
  vehIdx: number,
  ratio: number,
  data: Float32Array,
  ptr: number,
  outPos: PositionResult
): boolean {
  const shouldWait = processMergeLogicInline(
    lockMgr,
    finalEdge,
    vehIdx,
    ratio,
    data,
    ptr,
    outPos
  );

  return shouldWait;
}

function checkAndReleaseMergeLock(
  lockMgr: LockMgr,
  finalEdgeIndex: number,
  currentEdgeIndex: number,
  currentEdge: Edge,
  vehId: number
) {
  if (finalEdgeIndex === currentEdgeIndex) return;
  const prevToNode = currentEdge.to_node;
  if (lockMgr.isMergeNode(prevToNode)) {
    lockMgr.releaseLock(prevToNode, vehId);
  }
}

function calculateHitZone(
  data: Float32Array,
  ptr: number,
  deceleration: number
): number {
  const rawHit = Math.trunc(data[ptr + SensorData.HIT_ZONE]);
  let hitZone = -1;
  if (rawHit === 2) {
    hitZone = 2;
  } else if (deceleration !== 0) {
    hitZone = rawHit;
  }
  return hitZone;
}

function calculateAppliedAccelAndDecel(
  acceleration: number,
  deceleration: number,
  currentEdge: Edge,
  hitZone: number,
  curveAcceleration: number,
  target: typeof SCRATCH_ACCEL
) {
  let appliedAccel = acceleration;
  let appliedDecel = 0;

  // Override acceleration for curves
  if (currentEdge.vos_rail_type !== EdgeType.LINEAR) {
    appliedAccel = curveAcceleration;
  }

  if (hitZone >= 0) {
    appliedAccel = 0;
    appliedDecel = deceleration;
  }

  target.accel = appliedAccel;
  target.decel = appliedDecel;
}

function checkAndProcessSensorStop(
  hitZone: number,
  data: Float32Array,
  ptr: number
): boolean {
  if (hitZone === 2) {
    data[ptr + MovementData.VELOCITY] = 0;
    data[ptr + MovementData.DECELERATION] = 0;

    const currentReason = data[ptr + LogicData.STOP_REASON];
    data[ptr + LogicData.STOP_REASON] = currentReason | StopReason.SENSORED;
    return true;
  } else {
    const currentReason = data[ptr + LogicData.STOP_REASON];
    if ((currentReason & StopReason.SENSORED) !== 0) {
      data[ptr + LogicData.STOP_REASON] = currentReason & ~StopReason.SENSORED;
    }
    return false;
  }
}

function clampTargetRatio(ratio: number): number {
  if (ratio < 0) return 0;
  if (ratio > 1) return 1;
  return ratio;
}

function checkTargetReached(
  rawNewRatio: number,
  targetRatio: number,
  currentVelocity: number,
  out: typeof SCRATCH_TARGET_CHECK
) {
  if (rawNewRatio >= targetRatio) {
    out.finalRatio = targetRatio;
    out.finalVelocity = 0;
    out.reached = true;
  } else {
    out.finalRatio = rawNewRatio;
    out.finalVelocity = currentVelocity;
    out.reached = false;
  }
}

function processSameEdgeLogic(
  isSameEdge: boolean,
  rawNewRatio: number,
  targetRatio: number,
  currentVelocity: number,
  data: Float32Array,
  ptr: number,
  out: typeof SCRATCH_TARGET_CHECK
): boolean {
  if (!isSameEdge) {
    return false;
  }

  checkTargetReached(rawNewRatio, targetRatio, currentVelocity, out);

  if (out.reached) {
    data[ptr + MovementData.MOVING_STATUS] = MovingStatus.STOPPED;
  }

  return true;
}

interface CurveBrakeCheckResult {
  shouldBrake: boolean;
  deceleration: number;
  distanceToCurve: number;
}

/**
 * 곡선 사전 감속 체크
 * calculateNextSpeed 전에 호출하여 감속 필요 여부 판단
 * config.curvePreBrakeCheckInterval 주기로만 새로운 체크 수행
 */
function checkCurvePreBraking({
  vehId,
  currentEdge,
  currentRatio,
  currentVelocity,
  edgeArray,
  transferMgr,
  config,
  delta,
  curveBrakeCheckTimers,
}: {
  vehId: number;
  currentEdge: Edge;
  currentRatio: number;
  currentVelocity: number;
  edgeArray: Edge[];
  transferMgr: TransferMgr;
  config: MovementConfig;
  delta: number;
  curveBrakeCheckTimers?: Map<number, number>;
}): CurveBrakeCheckResult {
  const preBrakeDecel = config.linearPreBrakeDeceleration ?? -2;
  const brakeState = transferMgr.getCurveBrakeState(vehId);

  const noResult: CurveBrakeCheckResult = {
    shouldBrake: false,
    deceleration: 0,
    distanceToCurve: Infinity
  };

  // 현재 Edge가 곡선이면 감속 상태 초기화
  if (currentEdge.vos_rail_type !== EdgeType.LINEAR) {
    if (brakeState.isBraking) {
      transferMgr.clearCurveBrakeState(vehId);
    }
    // 타이머도 초기화
    if (curveBrakeCheckTimers) {
      curveBrakeCheckTimers.delete(vehId);
    }
    return noResult;
  }

  // 이미 감속 중이면 항상 감속 계속 (체크 스킵 없이)
  if (brakeState.isBraking) {
    if (currentVelocity > config.curveMaxSpeed) {
      return {
        shouldBrake: true,
        deceleration: preBrakeDecel,
        distanceToCurve: 0  // 이미 감속 중이므로 거리는 중요하지 않음
      };
    }
    return noResult;
  }

  // 감속 중이 아닐 때만 주기적 체크 수행
  const checkInterval = config.curvePreBrakeCheckInterval ?? 100; // 기본값 100ms

  if (curveBrakeCheckTimers) {
    const elapsed = (curveBrakeCheckTimers.get(vehId) ?? 0) + delta * 1000; // delta는 초 단위, ms로 변환

    // 아직 interval이 지나지 않았으면 체크 스킵
    if (elapsed < checkInterval) {
      curveBrakeCheckTimers.set(vehId, elapsed);
      return noResult;
    }

    // interval 지났으면 타이머 리셋하고 체크 수행
    curveBrakeCheckTimers.set(vehId, 0);
  }

  // 경로에서 다음 곡선 찾기
  const curveInfo = transferMgr.findDistanceToNextCurve(
    vehId,
    currentEdge,
    currentRatio,
    edgeArray
  );

  // 경로에 곡선 없음
  if (!curveInfo) {
    return noResult;
  }

  // 감속 필요 거리 계산 (체크포인트)
  const brakeDistance = calculateBrakeDistance(
    config.linearMaxSpeed,
    config.curveMaxSpeed,
    preBrakeDecel
  );

  const distanceToCurve = curveInfo.distance;
  const checkpointDistance = distanceToCurve - brakeDistance;

  // 체크포인트 지났는지 확인
  if (checkpointDistance <= 0) {
    transferMgr.startCurveBraking(vehId, curveInfo.curveEdge);

    if (currentVelocity > config.curveMaxSpeed) {
      return {
        shouldBrake: true,
        deceleration: preBrakeDecel,
        distanceToCurve
      };
    }
  }

  return noResult;
}

