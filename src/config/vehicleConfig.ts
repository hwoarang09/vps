// Vehicle configuration interface
interface VehicleConfig {
  MAX_VEHICLES: number;          // Maximum number of vehicles
  VEHICLE_COLOR: string;         // Vehicle color (hex)
  EDGE_MARGIN: number;           // Margin from edge start/end (m)
  VEHICLE_SPACING: number;       // Spacing between vehicles (sensor to body distance) (m)
  CROSS_EDGE_SAFE_DISTANCE: number; // Safe distance when checking across edges (m)
  BODY: {
    LENGTH: number;              // Body length (X-axis, forward direction) (m)
    WIDTH: number;               // Body width (Y-axis, left/right) (m)
    HEIGHT: number;              // Body height (Z-axis, up/down) (m)
  };
  SENSOR: {
    LENGTH: number;              // Sensor length (X-axis, forward direction) (m)
    WIDTH: number;               // Sensor width (Y-axis, left/right) (m)
    HEIGHT: number;              // Sensor height (Z-axis, up/down) (m)
  };
  LABEL: {
    TEXT_HEIGHT: number;         // Label text height (m)
    Z_OFFSET: number;            // Label Z position offset (m)
  };
}

// Load vehicle configuration from JSON file
const loadVehicleConfig = async (): Promise<VehicleConfig> => {
  try {
    const response = await fetch('/config/vehicleConfig.json');
    if (!response.ok) {
      throw new Error(`Failed to load vehicle config: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Error loading vehicle config:', error);
    // Fallback to default values
    return {
      MAX_VEHICLES: 20000,
      VEHICLE_COLOR: "#4ecdc4",
      EDGE_MARGIN: 0.5,
      VEHICLE_SPACING: 0.6,
      CROSS_EDGE_SAFE_DISTANCE: 1.0,
      BODY: {
        LENGTH: 1.2,
        WIDTH: 0.6,
        HEIGHT: 0.3
      },
      SENSOR: {
        LENGTH: 0.6,
        WIDTH: 0.5,
        HEIGHT: 0.3
      },
      LABEL: {
        TEXT_HEIGHT: 0.6,
        Z_OFFSET: 0.9
      }
    };
  }
};

// Export config loader
export const getVehicleConfig = loadVehicleConfig;

// For synchronous access (will use default until loaded)
let vehicleConfig: VehicleConfig = {
  MAX_VEHICLES: 20000,
  VEHICLE_COLOR: "#4ecdc4",
  EDGE_MARGIN: 0.5,
  VEHICLE_SPACING: 0.6,
  CROSS_EDGE_SAFE_DISTANCE: 1.0,
  BODY: {
    LENGTH: 1.2,
    WIDTH: 0.6,
    HEIGHT: 0.3
  },
  SENSOR: {
    LENGTH: 0.6,
    WIDTH: 0.5,
    HEIGHT: 0.3
  },
  LABEL: {
    TEXT_HEIGHT: 0.6,
    Z_OFFSET: 0.9
  }
};

// Promise to track config loading
let configLoadedPromise: Promise<VehicleConfig>;

// Load config immediately
configLoadedPromise = loadVehicleConfig().then(config => {
  vehicleConfig = config;
  console.log('[VehicleConfig] Loaded:', config);
  return config;
});

// Export the promise for components that need to wait
export const waitForConfig = () => configLoadedPromise;

// Export synchronous getters
export const getMaxVehicles = () => vehicleConfig.MAX_VEHICLES;
export const getVehicleColor = () => vehicleConfig.VEHICLE_COLOR;
export const getEdgeMargin = () => vehicleConfig.EDGE_MARGIN;
export const getVehicleSpacing = () => vehicleConfig.VEHICLE_SPACING;

// Body dimensions
export const getBodyLength = () => vehicleConfig.BODY.LENGTH;
export const getBodyWidth = () => vehicleConfig.BODY.WIDTH;
export const getBodyHeight = () => vehicleConfig.BODY.HEIGHT;

// Sensor dimensions
export const getSensorLength = () => vehicleConfig.SENSOR.LENGTH;
export const getSensorWidth = () => vehicleConfig.SENSOR.WIDTH;
export const getSensorHeight = () => vehicleConfig.SENSOR.HEIGHT;

// Label config
export const getLabelTextHeight = () => vehicleConfig.LABEL.TEXT_HEIGHT;
export const getLabelZOffset = () => vehicleConfig.LABEL.Z_OFFSET;

// Export the config object itself
export const getVehicleConfigSync = () => vehicleConfig;

