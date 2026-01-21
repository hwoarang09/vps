// Simulation configuration (all simulation logic parameters)
import type { SimulationConfig } from "@/shmSimulator/types";

/** Lock 승인 전략 타입 */
export type GrantStrategy = 'FIFO' | 'BATCH';

interface SimulationConfigFile {
  simulation: {
    maxVehicles: number;
    targetFps: number;
    maxDelta: number;
    collisionCheckInterval?: number;
    curvePreBrakeCheckInterval?: number;
  };
  log: {
    /** DevLogger 활성화 여부 (개발용 텍스트 로그) */
    devLogEnabled: boolean;
    /** EdgeTransitTracker 활성화 여부 (edge 통과 바이너리 로그) */
    edgeTransitLogEnabled: boolean;
  };
  lock: {
    /** 직선에서 합류할 때 대기 지점 - toNode 앞 거리 (m) */
    waitDistanceFromMergingStr: number;
    /** 직선에서 합류할 때 요청 시점 - toNode 앞 거리 (m) */
    requestDistanceFromMergingStr: number;
    /** 곡선에서 합류할 때 대기 지점 - fromNode 앞 거리 (m) */
    waitDistanceFromMergingCurve: number;
    /** 곡선에서 합류할 때 요청 시점 - fromNode 앞 거리 (m) */
    requestDistanceFromMergingCurve: number;
    /** 승인 전략: FIFO 또는 BATCH */
    grantStrategy: GrantStrategy;
  };
  vehicle: {
    body: {
      length: number;
      width: number;
      height: number;
      zOffset: number;
    };
    sensor: {
      length: number;
      width: number;
      height: number;
    };
    spacing: {
      vehicleSpacing: number;
      edgeMargin: number;
      crossEdgeSafeDistance: number;
    };
    label: {
      textHeight: number;
      zOffset: number;
    };
  };
  movement: {
    linear: {
      maxSpeed: number;
      acceleration: number;
      deceleration: number;
      preBrakeDeceleration: number;
    };
    curve: {
      maxSpeed: number;
      acceleration: number;
    };
    approach: {
      minSpeed: number;
    };
    brake: {
      minSpeed: number;
    };
  };
}

// Load simulation configuration from JSON file
const loadSimulationConfig = async (): Promise<SimulationConfigFile> => {
  try {
    const response = await fetch('/config/simulationConfig.json');
    if (!response.ok) {
      throw new Error(`Failed to load simulation config: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    // Fallback to default values
    return {
      simulation: {
        maxVehicles: 200000,
        targetFps: 60,
        maxDelta: 0.1,
        collisionCheckInterval: 33,
        curvePreBrakeCheckInterval: 100,
      },
      log: {
        devLogEnabled: true,
        edgeTransitLogEnabled: true,
      },
      lock: {
        waitDistanceFromMergingStr: 1.89,
        requestDistanceFromMergingStr: 5.1,
        waitDistanceFromMergingCurve: 1.89,
        requestDistanceFromMergingCurve: 5.1,
        grantStrategy: 'FIFO',
      },
      vehicle: {
        body: {
          length: 1.2,
          width: 0.6,
          height: 0.3,
          zOffset: 3.8,
        },
        sensor: {
          length: 0.6,
          width: 0.5,
          height: 0.3,
        },
        spacing: {
          vehicleSpacing: 0.6,
          edgeMargin: 0.5,
          crossEdgeSafeDistance: 1.0,
        },
        label: {
          textHeight: 0.6,
          zOffset: 0.9,
        },
      },
      movement: {
        linear: {
          maxSpeed: 5.0,
          acceleration: 2.0,
          deceleration: -3.0,
          preBrakeDeceleration: -2.0,
        },
        curve: {
          maxSpeed: 1.0,
          acceleration: 1.0,
        },
        approach: {
          minSpeed: 2.0,
        },
        brake: {
          minSpeed: 1.2,
        },
      },
    };
  }
};

// For synchronous access (will use default until loaded)
let simulationConfig: SimulationConfigFile = {
  simulation: {
    maxVehicles: 200000,
    targetFps: 60,
    maxDelta: 0.1,
    collisionCheckInterval: 33,
    curvePreBrakeCheckInterval: 100,
  },
  log: {
    devLogEnabled: true,
    edgeTransitLogEnabled: true,
  },
  lock: {
    waitDistanceFromMergingStr: 1.89,
    requestDistanceFromMergingStr: 5.1,
    waitDistanceFromMergingCurve: 1.89,
    requestDistanceFromMergingCurve: 5.1,
    grantStrategy: 'FIFO',
  },
  vehicle: {
    body: {
      length: 1.2,
      width: 0.6,
      height: 0.3,
      zOffset: 3.8,
    },
    sensor: {
      length: 0.6,
      width: 0.5,
      height: 0.3,
    },
    spacing: {
      vehicleSpacing: 0.6,
      edgeMargin: 0.5,
      crossEdgeSafeDistance: 1.0,
    },
    label: {
      textHeight: 0.6,
      zOffset: 0.9,
    },
  },
  movement: {
    linear: {
      maxSpeed: 5.0,
      acceleration: 2.0,
      deceleration: -3.0,
      preBrakeDeceleration: -2.0,
    },
    curve: {
      maxSpeed: 1.0,
      acceleration: 1.0,
    },
    approach: {
      minSpeed: 2.0,
    },
    brake: {
      minSpeed: 1.2,
    },
  },
};

// Load config immediately
loadSimulationConfig().then(config => {
  simulationConfig = config;
});

// Export synchronous getter (flattened for SimulationConfig type)
export const getSimulationConfig = (): SimulationConfig => {
  return {
    // Simulation
    maxVehicles: simulationConfig.simulation.maxVehicles,
    targetFps: simulationConfig.simulation.targetFps,
    maxDelta: simulationConfig.simulation.maxDelta,
    collisionCheckInterval: simulationConfig.simulation.collisionCheckInterval,
    curvePreBrakeCheckInterval: simulationConfig.simulation.curvePreBrakeCheckInterval,

    // Log
    devLogEnabled: simulationConfig.log.devLogEnabled,
    edgeTransitLogEnabled: simulationConfig.log.edgeTransitLogEnabled,

    // Vehicle
    bodyLength: simulationConfig.vehicle.body.length,
    bodyWidth: simulationConfig.vehicle.body.width,
    bodyHeight: simulationConfig.vehicle.body.height,
    vehicleZOffset: simulationConfig.vehicle.body.zOffset,
    vehicleSpacing: simulationConfig.vehicle.spacing.vehicleSpacing,
    edgeMargin: simulationConfig.vehicle.spacing.edgeMargin,
    crossEdgeSafeDistance: simulationConfig.vehicle.spacing.crossEdgeSafeDistance,

    // Movement
    linearMaxSpeed: simulationConfig.movement.linear.maxSpeed,
    linearAcceleration: simulationConfig.movement.linear.acceleration,
    linearDeceleration: simulationConfig.movement.linear.deceleration,
    curveMaxSpeed: simulationConfig.movement.curve.maxSpeed,
    curveAcceleration: simulationConfig.movement.curve.acceleration,
    approachMinSpeed: simulationConfig.movement.approach.minSpeed,
    brakeMinSpeed: simulationConfig.movement.brake.minSpeed,

    // Lock
    lockWaitDistanceFromMergingStr: simulationConfig.lock.waitDistanceFromMergingStr,
    lockRequestDistanceFromMergingStr: simulationConfig.lock.requestDistanceFromMergingStr,
    lockWaitDistanceFromMergingCurve: simulationConfig.lock.waitDistanceFromMergingCurve,
    lockRequestDistanceFromMergingCurve: simulationConfig.lock.requestDistanceFromMergingCurve,
    lockGrantStrategy: simulationConfig.lock.grantStrategy,
  };
};

// Export async loader
export const waitForSimulationConfig = (): Promise<SimulationConfig> => {
  return loadSimulationConfig().then(() => getSimulationConfig());
};

// Individual getters - Simulation
export const getMaxVehicles = () => simulationConfig.simulation.maxVehicles;
export const getTargetFps = () => simulationConfig.simulation.targetFps;
export const getMaxDelta = () => simulationConfig.simulation.maxDelta;

// Individual getters - Vehicle
export const getBodyLength = () => simulationConfig.vehicle.body.length;
export const getBodyWidth = () => simulationConfig.vehicle.body.width;
export const getBodyHeight = () => simulationConfig.vehicle.body.height;
export const getVehicleZOffset = () => simulationConfig.vehicle.body.zOffset;
export const getSensorLength = () => simulationConfig.vehicle.sensor.length;
export const getSensorWidth = () => simulationConfig.vehicle.sensor.width;
export const getSensorHeight = () => simulationConfig.vehicle.sensor.height;
export const getVehicleSpacing = () => simulationConfig.vehicle.spacing.vehicleSpacing;
export const getEdgeMargin = () => simulationConfig.vehicle.spacing.edgeMargin;
export const getCrossEdgeSafeDistance = () => simulationConfig.vehicle.spacing.crossEdgeSafeDistance;

// Individual getters - Movement
export const getLinearMaxSpeed = () => simulationConfig.movement.linear.maxSpeed;
export const getLinearAcceleration = () => simulationConfig.movement.linear.acceleration;
export const getLinearDeceleration = () => simulationConfig.movement.linear.deceleration;
export const getLinearPreBrakeDeceleration = () => simulationConfig.movement.linear.preBrakeDeceleration;
export const getCurveMaxSpeed = () => simulationConfig.movement.curve.maxSpeed;
export const getCurveAcceleration = () => simulationConfig.movement.curve.acceleration;
export const getApproachMinSpeed = () => simulationConfig.movement.approach.minSpeed;
export const getBrakeMinSpeed = () => simulationConfig.movement.brake.minSpeed;

// Individual getters - Lock
export const getLockWaitDistanceFromMergingStr = () => simulationConfig.lock.waitDistanceFromMergingStr;
export const getLockRequestDistanceFromMergingStr = () => simulationConfig.lock.requestDistanceFromMergingStr;
export const getLockWaitDistanceFromMergingCurve = () => simulationConfig.lock.waitDistanceFromMergingCurve;
export const getLockRequestDistanceFromMergingCurve = () => simulationConfig.lock.requestDistanceFromMergingCurve;
export const getLockGrantStrategy = () => simulationConfig.lock.grantStrategy;

// Individual getters - Log
export const getDevLogEnabled = () => simulationConfig.log.devLogEnabled;
export const getEdgeTransitLogEnabled = () => simulationConfig.log.edgeTransitLogEnabled;
