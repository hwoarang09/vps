// Station type configuration
interface StationTypeConfig {
  Z_HEIGHT: number;
  COLOR: string;
  DESCRIPTION: string;
}

// Station configuration interface
interface StationConfig {
  STATION_TYPES: {
    EQ: StationTypeConfig;
    OHB: StationTypeConfig;
    STK: StationTypeConfig;
    DEFAULT: StationTypeConfig;
  };
  TEXT: {
    Z_OFFSET: number;
    COLOR: string;
    SCALE: number;
  };
  BOX: {
    WIDTH: number;
    DEPTH: number;
  };
}

// Load station configuration from JSON file
const loadStationConfig = async (): Promise<StationConfig> => {
  try {
    const response = await fetch('/config/stationConfig.json');
    if (!response.ok) {
      throw new Error(`Failed to load station config: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Error loading station config:', error);
    // Fallback to default values
    return {
      STATION_TYPES: {
        EQ: {
          Z_HEIGHT: 0,
          COLOR: "#00ff00",
          DESCRIPTION: "Equipment on floor"
        },
        OHB: {
          Z_HEIGHT: 3,
          COLOR: "#ff9800",
          DESCRIPTION: "Overhead Buffer"
        },
        STK: {
          Z_HEIGHT: 2.5,
          COLOR: "#2196f3",
          DESCRIPTION: "Stocker"
        },
        DEFAULT: {
          Z_HEIGHT: 3.8,
          COLOR: "#888888",
          DESCRIPTION: "Default station type"
        }
      },
      TEXT: {
        Z_OFFSET: 0.05,
        COLOR: "#FFD700",
        SCALE: 0.6
      },
      BOX: {
        WIDTH: 0.3,
        DEPTH: 0.3
      }
    };
  }
};

// Export config loader
export const getStationConfig = loadStationConfig;

// For synchronous access (will use default until loaded)
let stationConfig: StationConfig = {
  STATION_TYPES: {
    EQ: {
      Z_HEIGHT: 0,
      COLOR: "#00ff00",
      DESCRIPTION: "Equipment on floor"
    },
    OHB: {
      Z_HEIGHT: 3,
      COLOR: "#ff9800",
      DESCRIPTION: "Overhead Buffer"
    },
    STK: {
      Z_HEIGHT: 2.5,
      COLOR: "#2196f3",
      DESCRIPTION: "Stocker"
    },
    DEFAULT: {
      Z_HEIGHT: 3.8,
      COLOR: "#888888",
      DESCRIPTION: "Default station type"
    }
  },
  TEXT: {
    Z_OFFSET: 0.05,
    COLOR: "#FFD700",
    SCALE: 0.6
  },
  BOX: {
    WIDTH: 0.3,
    DEPTH: 0.3
  }
};

// Load config immediately
loadStationConfig().then(config => {
  stationConfig = config;
  console.log('[StationConfig] Loaded:', config);
});

// Export synchronous getters
export const getStationTypeConfig = (stationType: string): StationTypeConfig => {
  const type = stationType.toUpperCase();
  if (type in stationConfig.STATION_TYPES) {
    return stationConfig.STATION_TYPES[type as keyof typeof stationConfig.STATION_TYPES];
  }
  return stationConfig.STATION_TYPES.DEFAULT;
};

export const getStationTextConfig = () => stationConfig.TEXT;
export const getStationBoxConfig = () => stationConfig.BOX;
export const getStationConfigSync = () => stationConfig;

