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
import type { TransferMgr, VehicleLoop } from "@/common/vehicle/logic/TransferMgr";
import type { AutoMgr } from "@/common/vehicle/logic/AutoMgr";
import type { EdgeTransitTracker } from "@/logger";

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
  // Store
  store: {
    moveVehicleToEdge: (vehId: number, edgeIndex: number) => void;
    transferMode: TransferMode;
  };
  // Logger
  edgeTransitTracker: EdgeTransitTracker | null;
  // Timers
  collisionCheckTimers: Map<number, number>;
  curveBrakeCheckTimers: Map<number, number>;
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
    store,
    edgeTransitTracker,
    collisionCheckTimers,
    curveBrakeCheckTimers,
  } = ctx;
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
  const tracker = edgeTransitTracker;

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
    onEdgeTransit: tracker
      ? (vehId, fromEdgeIndex, toEdgeIndex, timestamp) => {
          // 이전 edge 통과 로그 (fromEdgeIndex is 1-based)
          const fromEdge = fromEdgeIndex >= 1 ? edges[fromEdgeIndex - 1] : undefined;
          if (fromEdge) {
            tracker.onEdgeExit(vehId, fromEdgeIndex, timestamp, fromEdge);
          }
          // 새 edge 진입 기록
          tracker.onEdgeEnter(vehId, toEdgeIndex, timestamp);
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
  autoMgr.update(
    store.transferMode,
    actualNumVehicles,
    vehicleDataArray,
    edges,
    edgeNameToIndex,
    transferMgr,
    lockMgr
  );
}
