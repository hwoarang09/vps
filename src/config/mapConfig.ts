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
export const getMapConfig = loadMapConfig;

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
export const getRailConfigPath = () => `/${mapConfig.RAIL_CONFIG_PATH}`;

// Export map file paths based on selected map folder
export const getMapFilePaths = (mapFolder: string) => {
  const basePath = getRailConfigPath();
  return {
    nodesPath: `${basePath}/${mapFolder}/nodes.cfg`,
    edgesPath: `${basePath}/${mapFolder}/edges.cfg`,
    stationsPath: `${basePath}/${mapFolder}/stations.cfg`
  };
};

// Get available map folders from config
export const getAvailableMapFolders = async (): Promise<string[]> => {
  const config = await loadMapConfig();
  return config.AVAILABLE_MAPS || ['dismantle'];
};

// Get auto-load map (returns null if empty string or not set)
export const getAutoLoadMap = async (): Promise<string | null> => {
  const config = await loadMapConfig();
  const autoLoadMap = config.AUTO_LOAD_MAP || '';
  return autoLoadMap.trim() === '' ? null : autoLoadMap;
};

// Config Getters
export const getMarkerConfig = () => mapConfig.MARKERS;
export const getRendererConfig = () => mapConfig.RENDERER;
export const getEdgeColorConfig = () => mapConfig.EDGE_COLORS;
export const getMapConfigSync = () => mapConfig; // Full sync access

