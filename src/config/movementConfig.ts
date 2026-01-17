// Movement configuration
export interface MovementConfig {
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
}

// Load movement configuration from JSON file
const loadMovementConfig = async (): Promise<MovementConfig> => {
  try {
    const response = await fetch('/config/movementConfig.json');
    if (!response.ok) {
      throw new Error(`Failed to load movement config: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Error loading movement config:', error);
    // Fallback to default values
    return {
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
    };
  }
};

// For synchronous access (will use default until loaded)
let movementConfig: MovementConfig = {
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
};

// Load config immediately
loadMovementConfig().then(config => {
  movementConfig = config;
  console.log('[MovementConfig] Loaded:', config);
});

// Export synchronous getter
export const getMovementConfig = () => movementConfig;

// Individual getters
export const getLinearMaxSpeed = () => movementConfig.linear.maxSpeed;
export const getLinearAcceleration = () => movementConfig.linear.acceleration;
export const getLinearDeceleration = () => movementConfig.linear.deceleration;
export const getLinearPreBrakeDeceleration = () => movementConfig.linear.preBrakeDeceleration;
export const getCurveMaxSpeed = () => movementConfig.curve.maxSpeed;
export const getCurveAcceleration = () => movementConfig.curve.acceleration;
export const getApproachMinSpeed = () => movementConfig.approach.minSpeed;
export const getBrakeMinSpeed = () => movementConfig.brake.minSpeed;
