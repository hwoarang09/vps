// Movement configuration interface
interface MovementConfig {
  LINEAR_MAX_SPEED: number;      // Maximum speed on straight sections (m/s)
  LINEAR_ACCELERATION: number;   // Acceleration on straight sections (m/s²)
  LINEAR_DECELERATION: number;   // Deceleration (Braking) (m/s²)
  CURVE_MAX_SPEED: number;       // Maximum speed on curved sections (m/s)
  APPROACH_MIN_SPEED: number;    // Minimum speed in approach zone (m/s)
  BRAKE_MIN_SPEED: number;       // Minimum speed in brake zone (m/s)
  CURVE_ACCELERATION: number;    // Acceleration on curved sections (m/s²)
  MAX_DELTA: number;             // Maximum delta time per frame (s)
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
      LINEAR_MAX_SPEED: 5.0,
      LINEAR_ACCELERATION: 3.0,
      LINEAR_DECELERATION: 5.0, // Stronger braking by default
      CURVE_MAX_SPEED: 1.0,
      APPROACH_MIN_SPEED: 1.0,
      BRAKE_MIN_SPEED: 0.5,
      CURVE_ACCELERATION: 0.0,
      MAX_DELTA: 0.1
    };
  }
};

// Export config loader
export const getMovementConfig = loadMovementConfig;

// For synchronous access (will use default until loaded)
let movementConfig: MovementConfig = {
  LINEAR_MAX_SPEED: 5,
  LINEAR_ACCELERATION: 3,
  LINEAR_DECELERATION: 5,
  CURVE_MAX_SPEED: 1,
  APPROACH_MIN_SPEED: 2,
  BRAKE_MIN_SPEED: 1,
  CURVE_ACCELERATION: 0,
  MAX_DELTA: 0.1
};

// Load config immediately
loadMovementConfig().then(config => {
  movementConfig = config;
  console.log('[MovementConfig] Loaded:', config);
});

// Export synchronous getters
export const getLinearMaxSpeed = () => movementConfig.LINEAR_MAX_SPEED;
export const getLinearAcceleration = () => movementConfig.LINEAR_ACCELERATION;
export const getLinearDeceleration = () => movementConfig.LINEAR_DECELERATION;
export const getCurveMaxSpeed = () => movementConfig.CURVE_MAX_SPEED;
export const getApproachMinSpeed = () => movementConfig.APPROACH_MIN_SPEED;
export const getBrakeMinSpeed = () => movementConfig.BRAKE_MIN_SPEED;
export const getCurveAcceleration = () => movementConfig.CURVE_ACCELERATION;
export const getMaxDelta = () => movementConfig.MAX_DELTA;

// Export the config object itself
export const getMovementConfigSync = () => movementConfig;

