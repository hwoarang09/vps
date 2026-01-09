// Visualization configuration interface
interface VisualizationConfig {
  RAPIER_MODE: {
    SHOW_PHYSICS_DEBUG: boolean;
    SHOW_SENSOR_EDGES: boolean;
  };
  ARRAY_MODE: {
    SHOW_SENSOR_EDGES: boolean;
  };
  SHARED_MEMORY_MODE: {
    SHOW_SENSOR_EDGES: boolean;
  };
}

// Load visualization configuration from JSON file
const loadVisualizationConfig = async (): Promise<VisualizationConfig> => {
  try {
    const response = await fetch('/config/visualizationConfig.json');
    if (!response.ok) {
      throw new Error(`Failed to load visualization config: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Error loading visualization config:', error);
    // Fallback to default values
    return {
      RAPIER_MODE: {
        SHOW_PHYSICS_DEBUG: true,
        SHOW_SENSOR_EDGES: false
      },
      ARRAY_MODE: {
        SHOW_SENSOR_EDGES: true
      },
      SHARED_MEMORY_MODE: {
        SHOW_SENSOR_EDGES: false
      }
    };
  }
};

// Export config loader


// For synchronous access (will use default until loaded)
let visualizationConfig: VisualizationConfig = {
  RAPIER_MODE: {
    SHOW_PHYSICS_DEBUG: true,
    SHOW_SENSOR_EDGES: false
  },
  ARRAY_MODE: {
    SHOW_SENSOR_EDGES: false
  },
  SHARED_MEMORY_MODE: {
    SHOW_SENSOR_EDGES: false
  }
};

// Load config immediately
loadVisualizationConfig().then(config => {
  visualizationConfig = config;
});

// Synchronous getters for each mode
export const getRapierModeConfig = () => visualizationConfig.RAPIER_MODE;


// Synchronous getter for entire config


