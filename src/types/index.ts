/**
 * Common types used throughout the application
 */

// ============================================================================
// NODE TYPES
// ============================================================================

// Node 타입은 node.ts에서 정의 (topology, deadlock zone 필드 포함)
export type { Node } from "./node";

// ============================================================================
// EDGE TYPES
// ============================================================================

/**
 * Edge Types Enum
 */
export enum EdgeType {
  LINEAR = "LINEAR",
  CURVE_90 = "CURVE_90",
  CURVE_180 = "CURVE_180",
  CURVE_CSC = "CURVE_CSC",
  S_CURVE = "S_CURVE",
  LEFT_CURVE = "LEFT_CURVE",
  RIGHT_CURVE = "RIGHT_CURVE",
}

/**
 * Edge interface - matches edges.cfg format
 * CFG 필수 데이터 + 렌더링용 옵셔널 데이터
 */
export type { Edge } from "./edge";



// ============================================================================
// MENU TYPES
// ============================================================================

/**
 * Main menu types
 */
export type MainMenuType =
  | "MapLoader"
  | "Statistics"
  | "Operation"
  | "MQTT"
  | "DevTools"
  | "Search"
  | "Visualization";











// ============================================================================
// VEHICLE TYPES
// ============================================================================

/**
 * Vehicle interface - represents a vehicle in the system
 */


/**
 * VehicleConfig interface - matches vehicles.cfg format
 * Used for initial vehicle placement
 */
export interface VehicleConfig {
  vehId: string; // Vehicle ID
  edgeName: string; // Edge name where vehicle is placed
  ratio: number; // Position ratio on edge (0.0 ~ 1.0)
}

