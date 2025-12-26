// @types/edgeColors.ts
import { EdgeType } from "@/types";
import { getEdgeColorConfig } from "@/config/mapConfig";

// Helper to get colors (will use config defaults initially, can be updated if config loads)
// Note: This might be called before config is fully loaded async, so it relies on sync default or sync access
const getColors = () => getEdgeColorConfig();

/**
 * VOS rail type에 따른 색상 반환
 * @param vosRailType VOS rail type (LINEAR, CURVE_90, CURVE_180 등)
 * @returns 색상 hex 코드
 */
export const getEdgeColor = (vosRailType: string | EdgeType): string => {
  const colors = getColors();

  switch (vosRailType) {
    case EdgeType.LINEAR:
    case "S":
      return colors.LINEAR;
    case EdgeType.CURVE_90:
    case EdgeType.CURVE_180:
    case EdgeType.CURVE_CSC:
      return colors.CURVE_180; // Map generic curve types to a curve color
    case EdgeType.S_CURVE:
      return colors.S_CURVE;
    default:
      return colors.DEFAULT;
  }
};
