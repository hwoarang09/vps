// Simulation configuration (all simulation logic parameters)
import type { SimulationConfig } from "@/shmSimulator/types";

interface SimulationConfigFile {
  simulation: {
    maxVehicles: number;
    targetFps: number;
    maxDelta: number;
    collisionCheckInterval?: number;
    curvePreBrakeCheckInterval?: number;
  };
  lock: {
    /** 대기 지점 - toNode 앞 거리 (m) */
    waitDistance: number;
    /** 요청 시점 - toNode 앞 거리 (m). 직선이 이보다 짧으면 진입 즉시 요청 */
    requestDistance: number;
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
    console.error('Error loading simulation config:', error);
    // Fallback to default values
    return {
      simulation: {
        maxVehicles: 200000,
        targetFps: 60,
        maxDelta: 0.1,
        collisionCheckInterval: 33,
        curvePreBrakeCheckInterval: 100,
      },
      lock: {
        waitDistance: 1.89,
        requestDistance: 5.1,
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
  lock: {
    waitDistance: 1.89,
    requestDistance: 5.1,
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
  console.log('[SimulationConfig] Loaded:', config);
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

    // Vehicle
    bodyLength: simulationConfig.vehicle.body.length,
    bodyWidth: simulationConfig.vehicle.body.width,
    bodyHeight: simulationConfig.vehicle.body.height,
    sensorLength: simulationConfig.vehicle.sensor.length,
    sensorWidth: simulationConfig.vehicle.sensor.width,
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
export const getLockWaitDistance = () => simulationConfig.lock.waitDistance;
export const getLockRequestDistance = () => simulationConfig.lock.requestDistance;
