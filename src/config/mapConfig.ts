// Load map configuration from JSON file
const loadMapConfig = async () => {
  try {
    const response = await fetch('/config/mapConfig.json');
    if (!response.ok) {
      throw new Error(`Failed to load map config: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Error loading map config:', error);
    // Fallback to default values
    return {
      RAIL_CONFIG_PATH: 'railConfig',
      AVAILABLE_MAPS: ['dismantle'],
      AUTO_LOAD_MAP: '',
      MARKERS: {
        Z: 3.8,
        SEGMENTS: 6,
        NORMAL: { RADIUS: 0.05, COLOR: "#ff69b4" },
        TMP: { RADIUS: 0.025, COLOR: "#888888" }
      },
      RENDERER: {
        SCALE: 0.6,
        NODE_COLOR: "#ff69b4",
        EDGE_COLOR: "#ff9800",
        VEHICLE_COLOR: "#ffffff"
      },
      EDGE_COLORS: {
        LINEAR: "#0066ff",
        CURVE_90: "#ff69b4",
        CURVE_180: "#ff69b4",
        CURVE_CSC: "#ff69b4",
        S_CURVE: "#0066ff",
        DEFAULT: "#888888"
      }
    };
  }
};

// Export config loader


// For synchronous access (will use default until loaded)
let mapConfig = {
  RAIL_CONFIG_PATH: 'railConfig',
  AVAILABLE_MAPS: ['dismantle'],
  AUTO_LOAD_MAP: '',
  MARKERS: {
    Z: 3.8,
    SEGMENTS: 6,
    NORMAL: { RADIUS: 0.05, COLOR: "#ff69b4" },
    TMP: { RADIUS: 0.025, COLOR: "#888888" }
  },
  RENDERER: {
    SCALE: 0.6,
    NODE_COLOR: "#ff69b4",
    EDGE_COLOR: "#ff9800",
    VEHICLE_COLOR: "#ffffff"
  },
  EDGE_COLORS: {
    LINEAR: "#0066ff",
    CURVE_90: "#ff69b4",
    CURVE_180: "#ff69b4",
    CURVE_CSC: "#ff69b4",
    S_CURVE: "#0066ff",
    DEFAULT: "#888888"
  }
};

// Load config immediately
loadMapConfig().then(config => {
  mapConfig = config;
});

// Export rail config base path


// Get available map folders from config
export const getAvailableMapFolders = async (): Promise<string[]> => {
  const config = await loadMapConfig();
  return config.AVAILABLE_MAPS || ['dismantle'];
};

// Get auto-load map (returns null if empty string or not set)


// Config Getters
export const getMarkerConfig = () => mapConfig.MARKERS;
export const getRendererConfig = () => mapConfig.RENDERER;
export const getEdgeColorConfig = () => mapConfig.EDGE_COLORS;


