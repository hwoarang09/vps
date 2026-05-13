// 프로젝트 전역 색상 팔레트
// Three.js 차량 렌더링과 React UI(통계, 도넛차트, brace 등)에서 공통 사용.
// "같은 의미는 같은 hex" — 화면 어디서 보든 pickup은 파란색, drop은 보라색.

/**
 * Vehicle JobState 색상 — Three.js 차량 색 + UI에서 같은 단계를 표시할 때 동일하게 사용
 *
 * - MOVE_TO_LOAD : pickup 위치로 접근 중
 * - LOADING      : pickup 중
 * - MOVE_TO_UNLOAD : drop 위치로 접근 중
 * - UNLOADING    : drop 중
 * - IDLE         : 대기
 * - ERROR        : 에러 상태
 */
export const VEHICLE_JOB_STATE_COLORS = {
  MOVE_TO_LOAD: "#ec4899", // 분홍 — pickup 접근
  LOADING: "#06b6d4", // 청록 — pickup 중
  MOVE_TO_UNLOAD: "#3b82f6", // 파랑 — drop 접근
  UNLOADING: "#f97316", // 주황 — drop 중
  IDLE: "#ffffff",
  ERROR: "#ef4444",
  INIT: "#374151",
} as const;

/**
 * Order Lifecycle 단계 색상 — JobState 색의 alias (의미 명확화용)
 * pickup approach = vehicle이 pickup으로 가는 동안 = MOVE_TO_LOAD
 */
export const ORDER_SEGMENT_COLORS = {
  pickupApproach: VEHICLE_JOB_STATE_COLORS.MOVE_TO_LOAD,
  loading: VEHICLE_JOB_STATE_COLORS.LOADING,
  dropApproach: VEHICLE_JOB_STATE_COLORS.MOVE_TO_UNLOAD,
  unloading: VEHICLE_JOB_STATE_COLORS.UNLOADING,
} as const;

/**
 * Order Timing 그룹 색상 — Order Lifecycle의 묶음 단위
 * - lead     : 전체 lead time (green)
 * - waiting  : pickupApproach + loading (그 묶음의 끝 단계 색 = LOADING cyan)
 * - delivery : dropApproach + unloading (묶음의 시작 단계 색 = MOVE_TO_UNLOAD purple)
 */
export const TIMING_COLORS = {
  lead: "#22c55e", // 초록
  waiting: VEHICLE_JOB_STATE_COLORS.LOADING, // 청록 (cyan)
  delivery: VEHICLE_JOB_STATE_COLORS.MOVE_TO_UNLOAD, // 보라
} as const;

/**
 * Movement Status 색상 (FabDetailCard 도넛)
 */
export const MOVEMENT_STATUS_COLORS = {
  moving: "#22c55e",
  stopped: "#f59e0b",
  paused: "#6b7280",
} as const;

/**
 * Percentile 마커 색상 (TimingHistogram의 p50/p95 라인)
 */
export const PERCENTILE_COLORS = {
  p50: "#06b6d4",
  p95: "#f59e0b",
} as const;

/**
 * Routing Parameter 색상 (RoutingParamsPanel — cost function 선택)
 */
export const ROUTING_PARAM_COLORS = {
  DISTANCE: "#3b82f6", // blue-500
  BPR: "#f59e0b", // amber-500
  EWMA: "#22c55e", // green-500
  REROUTE_INTERVAL: "#a78bfa", // accent-purple
} as const;

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

/**
 * "#RRGGBB" → [r, g, b] 0-1 normalized (Three.js Color.setRGB용)
 */
export const hexToRgb01 = (hex: string): [number, number, number] => {
  const v = hex.replace("#", "");
  const r = parseInt(v.slice(0, 2), 16) / 255;
  const g = parseInt(v.slice(2, 4), 16) / 255;
  const b = parseInt(v.slice(4, 6), 16) / 255;
  return [r, g, b];
};
