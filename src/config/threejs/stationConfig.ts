// Station configuration (delegates to renderConfig)
// This file is kept for backward compatibility
import { getStationConfig as getRenderStationConfig, getStationType as getRenderStationType } from "./renderConfig";

// Station type configuration interface (for backward compatibility)
interface StationTypeConfig {
  Z_HEIGHT: number;
  COLOR: string;
  DESCRIPTION: string;
}

// Export synchronous getters (delegates to renderConfig)
export const getStationTypeConfig = (stationType: string): StationTypeConfig => {
  const type = stationType.toUpperCase();
  const config = getRenderStationType(type);
  return {
    Z_HEIGHT: config.zHeight,
    COLOR: config.color,
    DESCRIPTION: config.description,
  };
};

export const getStationTextConfig = () => {
  const config = getRenderStationConfig();
  return {
    Z_OFFSET: config.text.zOffset,
    COLOR: config.text.color,
    SCALE: config.text.scale,
  };
};

export const getStationBoxConfig = () => {
  const config = getRenderStationConfig();
  return {
    WIDTH: config.box.width,
    DEPTH: config.box.depth,
  };
};
