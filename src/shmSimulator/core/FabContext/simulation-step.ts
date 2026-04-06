// FabContext/simulation-step.ts
// 시뮬레이션 스텝 로직

import { checkCollisions, CollisionCheckContext } from "@/common/vehicle/collision/collisionCheck";
import { updateMovement, MovementUpdateContext } from "@/common/vehicle/movement/movementUpdate";
import type { Edge } from "@/types/edge";
import type { SimulationConfig, UnusualMoveData, TransferMode } from "../../types";
import type { VehicleDataArrayBase } from "@/common/vehicle/memory/VehicleDataArrayBase";
import type { SensorPointArrayBase } from "@/common/vehicle/memory/SensorPointArrayBase";
import type { EdgeVehicleQueue } from "@/common/vehicle/memory/EdgeVehicleQueue";
import type { LockMgr } from "@/common/vehicle/logic/LockMgr/index";
import type { TransferMgr, VehicleLoop, VehicleBayLoop } from "@/common/vehicle/logic/TransferMgr";
import type { AutoMgr } from "@/common/vehicle/logic/AutoMgr";
import type { SimLogger } from "@/logger";
import { VEHICLE_DATA_SIZE, MovementData } from "@/common/vehicle/initialize/constants";

/**
 * 시뮬레이션 스텝 실행 컨텍스트
 */
export interface SimulationStepContext {
  // Timing
  clampedDelta: number;
  simulationTime: number;
  // Data Arrays
  vehicleDataArray: VehicleDataArrayBase;
  sensorPointArray: SensorPointArrayBase;
  edgeVehicleQueue: EdgeVehicleQueue;
  // Map Data
  edges: Edge[];
  edgeNameToIndex: Map<string, number>;
  vehicleLoopMap: Map<number, VehicleLoop>;
  // Counts & Config
  actualNumVehicles: number;
  config: SimulationConfig;
  fabId: string;
  // Managers
  lockMgr: LockMgr;
  transferMgr: TransferMgr;
  autoMgr: AutoMgr;
  vehicleBayLoopMap: Map<number, VehicleBayLoop>;
  // Store
  store: {
    moveVehicleToEdge: (vehId: number, edgeIndex: number) => void;
    transferMode: TransferMode;
    transferEnabled: boolean;
    transferRateMode: 'utilization' | 'throughput';
    transferUtilizationPercent: number;
    transferThroughputPerHour: number;
  };
  // Logger
  simLogger: SimLogger | null;
  // Edge enter time tracking (vehId → simulationTime when vehicle entered current edge)
  edgeEnterTimes: Map<number, number>;
  // Timers
  collisionCheckTimers: Map<number, number>;
  curveBrakeCheckTimers: Map<number, number>;
  // Replay snapshot state
  lastReplaySnapshotTime: number;
  prevVehicleSpeeds: Float32Array | null;
}

/**
 * 시뮬레이션 스텝 실행 - 핵심 로직
 *
 * 동작:
 * 1. Collision Check - 충돌 감지 → 멈출지 결정
 * 2. Lock 처리 - 합류점에서 멈출지 결정
 * 3. Movement Update - 1,2에서 멈추지 않은 차량만 이동
 * 4. Auto Routing - edge 전환 후 새 경로 필요한 차량 처리
 */
export function executeSimulationStep(ctx: SimulationStepContext): void {
  // 구조 분해
  const {
    clampedDelta,
    simulationTime,
    vehicleDataArray,
    sensorPointArray,
    edgeVehicleQueue,
    edges,
    edgeNameToIndex,
    vehicleLoopMap,
    actualNumVehicles,
    config,
    fabId,
    lockMgr,
    transferMgr,
    autoMgr,
    vehicleBayLoopMap,
    store,
    simLogger,
    edgeEnterTimes,
    collisionCheckTimers,
    curveBrakeCheckTimers,
  } = ctx;
  // 0. Lock 이벤트 콜백 설정 (SimLogger 연결)
  if (simLogger) {
    lockMgr.setOnLockEvent((vehId, nodeIdx, eventType, waitMs) => {
      simLogger.logLock(simulationTime, vehId, nodeIdx, eventType, waitMs);
    });
  }

  // 1. Collision Check (충돌 감지 → 멈출지 결정)
  const collisionCtx: CollisionCheckContext = {
    vehicleArrayData: vehicleDataArray.getData(),
    edgeArray: edges,
    edgeVehicleQueue,
    sensorPointArray,
    config,
    delta: clampedDelta,
    collisionCheckTimers,
  };
  checkCollisions(collisionCtx);

  // 2. Lock 처리 (합류점에서 멈출지 결정)
  lockMgr.updateAll(actualNumVehicles, { default: 'FIFO' });

  // 3. Movement Update (1,2에서 멈추지 않은 차량만 이동)
  const logger = simLogger;

  const movementCtx: MovementUpdateContext = {
    vehicleDataArray,
    sensorPointArray,
    edgeArray: edges,
    actualNumVehicles,
    vehicleLoopMap,
    edgeNameToIndex,
    store,
    lockMgr,
    transferMgr,
    clampedDelta,
    config,
    simulationTime,
    onEdgeTransit: logger
      ? (vehId, fromEdgeIndex, toEdgeIndex, timestamp) => {
          // edge transit 로그 기록
          const fromEdge = fromEdgeIndex >= 1 ? edges[fromEdgeIndex - 1] : undefined;
          if (fromEdge) {
            const enterTs = edgeEnterTimes.get(vehId) ?? 0;
            logger.logEdgeTransit(
              timestamp,
              vehId,
              fromEdgeIndex,
              enterTs,
              timestamp,
              fromEdge.distance
            );
          }
          // DEV_TRANSFER 로그 기록
          if (logger.isDevMode()) {
            logger.logTransfer(timestamp, vehId, fromEdgeIndex, toEdgeIndex);
          }
          // 새 edge 진입 시간 기록
          edgeEnterTimes.set(vehId, timestamp);
        }
      : undefined,
    onUnusualMove: (event) => {
      // Worker에서 Main Thread로 UnusualMove 이벤트 전송
      const data: UnusualMoveData = {
        vehicleIndex: event.vehicleIndex,
        fabId,
        prevEdge: {
          name: event.prevEdgeName,
          toNode: event.prevEdgeToNode,
        },
        nextEdge: {
          name: event.nextEdgeName,
          fromNode: event.nextEdgeFromNode,
        },
        position: { x: event.posX, y: event.posY },
        timestamp: simulationTime,
      };
      globalThis.postMessage({ type: "UNUSUAL_MOVE", data });
    },
    curveBrakeCheckTimers,
  };
  updateMovement(movementCtx);

  // 4. Auto Routing (edge 전환 후 새 경로 필요한 차량 처리)
  if (simLogger?.isDevMode()) {
    autoMgr.onPathFound = (vehId, destEdge, pathLen) => {
      simLogger.logPath(simulationTime, vehId, destEdge, pathLen);
    };
  }
  autoMgr.update({
    mode: store.transferMode,
    numVehicles: actualNumVehicles,
    vehicleDataArray,
    edgeArray: edges,
    edgeNameToIndex,
    transferMgr,
    lockMgr,
    vehicleBayLoopMap,
    transferEnabled: store.transferEnabled,
    transferRateMode: store.transferRateMode,
    transferUtilizationPercent: store.transferUtilizationPercent,
    transferThroughputPerHour: store.transferThroughputPerHour,
    dt: clampedDelta,
  });

  // 5. Replay Snapshot (0.5초 주기 + 속도 0 전환 감지)
  if (simLogger?.isReplayEnabled()) {
    const REPLAY_INTERVAL = 0.5; // seconds
    const doPeriodicSnapshot = simulationTime - ctx.lastReplaySnapshotTime >= REPLAY_INTERVAL;

    for (let i = 0; i < actualNumVehicles; i++) {
      const speed = vehicleDataArray.getVelocity(i);
      const prevSpeed = ctx.prevVehicleSpeeds ? ctx.prevVehicleSpeeds[i] : speed;
      const stoppedNow = speed === 0 && prevSpeed > 0;

      if (doPeriodicSnapshot || stoppedNow) {
        const pos = vehicleDataArray.getPosition(i);
        simLogger.logReplaySnapshot(
          simulationTime, i,
          pos.x, pos.y, pos.z,
          vehicleDataArray.getData()[i * VEHICLE_DATA_SIZE + MovementData.CURRENT_EDGE],
          vehicleDataArray.getEdgeRatio(i),
          speed,
          vehicleDataArray.getMovingStatus(i),
        );
      }

      if (ctx.prevVehicleSpeeds) {
        ctx.prevVehicleSpeeds[i] = speed;
      }
    }

    if (doPeriodicSnapshot) {
      ctx.lastReplaySnapshotTime = simulationTime;
    }

    // 최초 호출 시 prevVehicleSpeeds 초기화
    if (!ctx.prevVehicleSpeeds) {
      ctx.prevVehicleSpeeds = new Float32Array(actualNumVehicles);
      for (let i = 0; i < actualNumVehicles; i++) {
        ctx.prevVehicleSpeeds[i] = vehicleDataArray.getVelocity(i);
      }
    }
  }
}
