import * as THREE from "three";

/**
 * Edge Interface
 * - Core Data: Defined in edges.cfg
 * - Geometry: Physics & path calculation
 * - Topology: Connection info for navigation
 */
export interface Edge {
  // ============================================================================
  // [1] CORE DATA (From Config)
  // ============================================================================
  edge_name: string;      // Unique Identifier
  from_node: string;      // Start Node Name
  to_node: string;        // End Node Name
  vos_rail_type: string;  // Rail Type (S, C90, etc.)
  distance: number;       // Length in meters
  waypoints: string[];    // Full path nodes

  // ============================================================================
  // [2] GEOMETRY & PHYSICS
  // ============================================================================
  radius?: number;           // Curve radius
  rotation?: number;         // Rotation angle
  curve_direction?: "right" | "left";
  start_direction?: number;  // 0, 90, 180, 270
  vos_rail_trpy?: string;    // Logic type for collision (e.g. "C90", "S", etc)

  /*
   * Edge direction axis
   * 'x': East/West
   * 'y': North/South
   */
  axis?: 'x' | 'y';

  // ============================================================================
  // [3] UI & RENDERING (Optional)
  // ============================================================================
  color?: string;
  opacity?: number;
  rendering_mode?: "normal" | "preview";
  source?: "config" | "user" | "system";
  readonly?: boolean;

  /** 렌더링 및 차량 이동 보간을 위한 미리 계산된 점들 */
  renderingPoints?: THREE.Vector3[];

  // ============================================================================
  // [4] TOPOLOGY FLAGS (4-Way State)
  // ============================================================================
  
  // --- [START NODE STATE] ---
  /**
   * 시작 노드(from_node)가 합류점이었는가? (Incoming Edges > 1)
   * True: 나는 여러 엣지가 합쳐진 결과물(단일 통로)일 가능성이 큼.
   */
  fromNodeIsMerge?: boolean;

  /**
   * 시작 노드(from_node)가 분기점이었는가? (Outgoing Edges > 1)
   * True: 나는 갈라져 나온 여러 가지(Branch) 중 하나임.
   */
  fromNodeIsDiverge?: boolean;

  // --- [END NODE STATE] ---
  /**
   * 끝 노드(to_node)가 합류점인가? (Incoming Edges > 1)
   * True: 도착 시 다른 엣지에서 오는 차량과 충돌 체크 필수 (Merge Logic).
   */
  toNodeIsMerge?: boolean;

  /**
   * 끝 노드(to_node)가 분기점인가? (Outgoing Edges > 1)
   * True: 도착 시 다음 경로를 선택해야 함 (Selection Logic).
   */
  toNodeIsDiverge?: boolean;

  // ============================================================================
  // [5] TOPOLOGY INDICES (O(1) Access)
  // ============================================================================
  /**
   * 이 엣지 다음에 갈 수 있는 엣지들의 인덱스 (Candidate Edges)
   * (toNodeIsDiverge가 True면 length > 1)
   */
  nextEdgeIndices?: number[];

  /**
   * 이 엣지와 도착지(to_node)를 공유하는 엣지들의 인덱스 (Competitor Edges)
   * (toNodeIsMerge가 True면 length > 1, 자기 자신 포함)
   */
  prevEdgeIndices?: number[];
}