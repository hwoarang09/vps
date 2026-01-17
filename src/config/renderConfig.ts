// Render configuration for visualization

export interface RenderConfig {
  nodes: {
    defaultSize: number;
    selectedColor: string;
    selectedSize: number;
    markerColor: string;
    markerRadius: number;
    markerSegments: number;
    tmpMarkerColor: string;
    tmpMarkerRadius: number;
  };
  edges: {
    colors: {
      LINEAR: string;
      CURVE_90: string;
      CURVE_180: string;
      CURVE_CSC: string;
      S_CURVE: string;
      DEFAULT: string;
    };
    lineWidth: number;
    selectedColor: string;
  };
  vehicles: {
    defaultColor: string;
    showSensorEdges: {
      RAPIER_MODE: boolean;
      ARRAY_MODE: boolean;
      SHARED_MEMORY_MODE: boolean;
    };
    showPhysicsDebug: {
      RAPIER_MODE: boolean;
    };
  };
  stations: {
    types: {
      [key: string]: {
        zHeight: number;
        color: string;
        description: string;
      };
    };
    text: {
      zOffset: number;
      color: string;
      scale: number;
    };
    box: {
      width: number;
      depth: number;
    };
  };
  map: {
    markersZ: number;
    scale: number;
  };
}

// Load render configuration from JSON file
const loadRenderConfig = async (): Promise<RenderConfig> => {
  try {
    const response = await fetch('/config/renderConfig.json');
    if (!response.ok) {
      throw new Error(`Failed to load render config: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    // Fallback to default values
    return {
      nodes: {
        defaultSize: 1.0,
        selectedColor: "#ff6b6b",
        selectedSize: 0.1,
        markerColor: "#ff69b4",
        markerRadius: 0.05,
        markerSegments: 6,
        tmpMarkerColor: "#888888",
        tmpMarkerRadius: 0.025,
      },
      edges: {
        colors: {
          LINEAR: "#0066ff",
          CURVE_90: "#0066ff",
          CURVE_180: "#0066ff",
          CURVE_CSC: "#0066ff",
          S_CURVE: "#0066ff",
          DEFAULT: "#888888",
        },
        lineWidth: 1.0,
        selectedColor: "#ff9800",
      },
      vehicles: {
        defaultColor: "#ffffff",
        showSensorEdges: {
          RAPIER_MODE: true,
          ARRAY_MODE: true,
          SHARED_MEMORY_MODE: false,
        },
        showPhysicsDebug: {
          RAPIER_MODE: true,
        },
      },
      stations: {
        types: {
          EQ: {
            zHeight: 0,
            color: "#00ff00",
            description: "Equipment on floor",
          },
          OHB: {
            zHeight: 3,
            color: "#ff9800",
            description: "Overhead Buffer",
          },
          STK: {
            zHeight: 2.5,
            color: "#ff2211",
            description: "Stocker",
          },
          DEFAULT: {
            zHeight: 3.8,
            color: "#888888",
            description: "Default station type",
          },
        },
        text: {
          zOffset: -0.2,
          color: "#FFD700",
          scale: 0.6,
        },
        box: {
          width: 0.3,
          depth: 0.3,
        },
      },
      map: {
        markersZ: 3.8,
        scale: 0.6,
      },
    };
  }
};

// For synchronous access (will use default until loaded)
let renderConfig: RenderConfig = {
  nodes: {
    defaultSize: 1.0,
    selectedColor: "#ff6b6b",
    selectedSize: 0.1,
    markerColor: "#ff69b4",
    markerRadius: 0.05,
    markerSegments: 6,
    tmpMarkerColor: "#888888",
    tmpMarkerRadius: 0.025,
  },
  edges: {
    colors: {
      LINEAR: "#0066ff",
      CURVE_90: "#0066ff",
      CURVE_180: "#0066ff",
      CURVE_CSC: "#0066ff",
      S_CURVE: "#0066ff",
      DEFAULT: "#888888",
    },
    lineWidth: 1.0,
    selectedColor: "#ff9800",
  },
  vehicles: {
    defaultColor: "#ffffff",
    showSensorEdges: {
      RAPIER_MODE: true,
      ARRAY_MODE: true,
      SHARED_MEMORY_MODE: false,
    },
    showPhysicsDebug: {
      RAPIER_MODE: true,
    },
  },
  stations: {
    types: {
      EQ: {
        zHeight: 0,
        color: "#00ff00",
        description: "Equipment on floor",
      },
      OHB: {
        zHeight: 3,
        color: "#ff9800",
        description: "Overhead Buffer",
      },
      STK: {
        zHeight: 2.5,
        color: "#ff2211",
        description: "Stocker",
      },
      DEFAULT: {
        zHeight: 3.8,
        color: "#888888",
        description: "Default station type",
      },
    },
    text: {
      zOffset: -0.2,
      color: "#FFD700",
      scale: 0.6,
    },
    box: {
      width: 0.3,
      depth: 0.3,
    },
  },
  map: {
    markersZ: 3.8,
    scale: 0.6,
  },
};

// Load config immediately
loadRenderConfig().then(config => {
  renderConfig = config;
});

// Export synchronous getter
export const getRenderConfig = (): RenderConfig => renderConfig;

// Export async loader
export const waitForRenderConfig = (): Promise<RenderConfig> => loadRenderConfig();

// Individual getters for convenience
export const getNodeConfig = () => renderConfig.nodes;
export const getEdgeConfig = () => renderConfig.edges;
export const getVehicleRenderConfig = () => renderConfig.vehicles;
export const getStationConfig = () => renderConfig.stations;
export const getMapRenderConfig = () => renderConfig.map;

// Specific getters
export const getNodeDefaultSize = () => renderConfig.nodes.defaultSize;
export const getNodeSelectedColor = () => renderConfig.nodes.selectedColor;
export const getMarkerConfig = () => ({
  Z: renderConfig.map.markersZ,
  SEGMENTS: renderConfig.nodes.markerSegments,
  NORMAL: {
    RADIUS: renderConfig.nodes.markerRadius,
    COLOR: renderConfig.nodes.markerColor,
  },
  TMP: {
    RADIUS: renderConfig.nodes.tmpMarkerRadius,
    COLOR: renderConfig.nodes.tmpMarkerColor,
  },
});
export const getEdgeColors = () => renderConfig.edges.colors;
export const getStationType = (type: string) => renderConfig.stations.types[type] || renderConfig.stations.types.DEFAULT;
