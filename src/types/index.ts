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
export interface Edge {
  // CFG 필수 데이터 (무조건 있어야 함)
  edge_name: string; // 엣지 이름 (고유 식별자)
  from_node: string; // 시작 노드 이름 (waypoints[0]과 같음)
  to_node: string; // 끝 노드 이름 (waypoints[-1]과 같음)
  waypoints: string[]; // 전체 경로 노드들 (from_node부터 to_node까지)
  vos_rail_type: EdgeType; // 레일 타입 (S, C90, C180 등)
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
  | "MQTT"
  | "DevTools";











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

