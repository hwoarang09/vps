import * as THREE from "three";
/**
 * Common types used throughout the application
 */

// ============================================================================
// NODE TYPES
// ============================================================================

/**
 * Node interface - matches nodes.cfg format
 * CFG 필수 데이터 + 렌더링용 옵셔널 데이터
 */
export interface Node {
  // CFG 필수 데이터 (무조건 있어야 함)
  node_name: string; // 노드 이름 (고유 식별자)
  editor_x: number; // X 좌표
  editor_y: number; // Y 좌표
  editor_z: number; // Z 좌표
  barcode: number; // 바코드 (당분간 0)

  // 렌더링/UI용 옵셔널 데이터
  color?: string; // 노드 색상
  size?: number; // 노드 크기
  rendering_mode?: "normal" | "preview"; // 렌더링 모드
  source?: "config" | "user" | "system"; // 데이터 소스
  readonly?: boolean; // 읽기 전용 여부
}

// ============================================================================
// EDGE TYPES
// ============================================================================

/**
 * Edge interface - matches edges.cfg format
 * CFG 필수 데이터 + 렌더링용 옵셔널 데이터
 */
export interface Edge {
  // CFG 필수 데이터 (무조건 있어야 함)
  edge_name: string; // 엣지 이름 (고유 식별자)
  from_node: string; // 시작 노드 이름 (waypoints[0]과 같음)
  to_node: string; // 끝 노드 이름 (waypoints[-1]과 같음)
  waypoints: string[]; // 전체 경로 노드들 (from_node부터 to_node까지)
  vos_rail_type: string; // 레일 타입 (S, C90, C180 등)
  distance: number; // 거리
  radius?: number; // 곡선 반지름 (m 단위, 기본값 0.5m)
  rotation?: number; // 회전각 (도 단위, C90=90도, C180=180도 등)
  axis?: "x" | "y" | "z"; // 좌표축 (x, y, z)
  // 렌더링/UI용 옵셔널 데이터
  color?: string; // 엣지 색상
  opacity?: number; // 투명도
  curve_direction?: "right" | "left"; // 커브 방향 (C90, C180 등에서 사용)
  start_direction?: number; // 시작 방향 (0, 90, 180, 270도)
  rendering_mode?: "normal" | "preview"; // 렌더링 모드
  source?: "config" | "user" | "system"; // 데이터 소스
  readonly?: boolean; // 읽기 전용 여부

  // 렌더링용 계산된 점들
  renderingPoints?: THREE.Vector3[]; // 호/직선 위의 점들 (렌더링용)
}

// ============================================================================
// RAIL TYPES
// ============================================================================

/**
 * Standard rail types
 */
export type RailType =
  | "S" // Straight
  | "C90" // 90-degree curve
  | "C180" // 180-degree curve
  | "CS" // S-curve
  | "H" // H-junction
  | "R" // R-shape
  | "J" // Junction
  | "B" // Bridge
  | "CUSTOM"; // Custom

/**
 * Rail direction types
 */
export type RailDirection =
  | "F" // Forward
  | "R" // Right
  | "L" // Left
  | "B" // Backward
  | "U" // Up
  | "D"; // Down

// ============================================================================
// MENU TYPES
// ============================================================================

/**
 * Main menu types
 */
export type MainMenuType =
  | "MapLoader"
  | "Statistics"
  | "Vehicle"
  | "Operation"
  | "MapBuilder"
  | "LayoutBuilder"
  | "DataPanel"
  | "Test";

/**
 * Menu item interface
 */
export interface MenuItem {
  id: string;
  label: string;
  iconFn: (isActive: boolean) => React.ReactNode;
}

// ============================================================================
// 3D RENDERING TYPES
// ============================================================================

/**
 * 3D position
 */
export interface Position3D {
  x: number;
  y: number;
  z: number;
}

/**
 * Color and material properties
 */
export interface MaterialProps {
  color?: string;
  opacity?: number;
  size?: number;
}

// ============================================================================
// CURVE TYPES
// ============================================================================

/**
 * Curve direction for 90-degree curves
 */
export type CurveDirection = "right" | "left";

/**
 * Curve parameters for 90-degree curves
 */
export interface Curve90Params {
  centerX: number;
  centerY: number;
  radius: number;
  startAngle: number;
  endAngle: number;
  endDirection: number; // End direction in degrees
}

// ============================================================================
// DATA SOURCE TYPES
// ============================================================================

/**
 * Data source types
 */
export type DataSource = "config" | "user" | "system";

/**
 * Rendering mode types
 */
export type RenderMode = "normal" | "preview";

// ============================================================================
// UTILITY TYPES
// ============================================================================

/**
 * Generic callback function type
 */
export type CallbackFunction<T = void> = () => T;

/**
 * Generic event handler type
 */
export type EventHandler<T = any> = (event: T) => void;

/**
 * Optional properties helper
 */
export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

/**
 * Required properties helper
 */
export type RequiredProps<T, K extends keyof T> = T & Required<Pick<T, K>>;

// ============================================================================
// VEHICLE TYPES
// ============================================================================

/**
 * Vehicle interface - represents a vehicle in the system
 */
export interface Vehicle {
  // Required data
  vehicle_id: string; // Unique vehicle identifier
  x: number; // X position
  y: number; // Y position
  z: number; // Z position

  // Optional data
  rotation?: number; // Rotation angle in degrees
  velocity?: number; // Current velocity
  status?: "idle" | "moving" | "charging" | "error"; // Vehicle status
  battery_level?: number; // Battery level (0-100)
  current_node?: string; // Current node name
  target_node?: string; // Target node name
  color?: string; // Vehicle color
  size?: number; // Vehicle size
  model_url?: string; // URL to 3D model (for future use)
  source?: "config" | "mqtt" | "system"; // Data source
}

/**
 * VehicleConfig interface - matches vehicles.cfg format
 * Used for initial vehicle placement
 */
export interface VehicleConfig {
  vehId: string; // Vehicle ID
  edgeName: string; // Edge name where vehicle is placed
  ratio: number; // Position ratio on edge (0.0 ~ 1.0)
}

// ============================================================================
// LEGACY TYPE ALIASES (for backward compatibility)
// ============================================================================

/**
 * @deprecated Use Node instead
 */
export type NodeData = Node;

/**
 * @deprecated Use Edge instead
 */
export type EdgeData = Edge;
