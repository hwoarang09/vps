// All theme-tunable visual values. Components subscribe to themeStore and
// read the fields they need, so switching theme triggers re-renders everywhere.

export interface Theme {
  name: string;
  label: string;

  // Scene
  background: string;
  floorColor: string;
  envPreset: "warehouse" | "city" | "studio" | "apartment" | "park" | null;
  ambientIntensity: number;
  directionalIntensity: number;
  fillIntensity: number;

  // Rail
  railColor: string;
  railBorderColor: string;
  railBorderWidth: number;

  // Stations
  stationEqColor: string;
  stationOhbColor: string;
  stationStkColor: string;

  // Vehicles
  vehicleColor: string;
  vehicleMetalness: number;
  vehicleRoughness: number;
  vehicleBracket: boolean;

  // Text
  textNode: string;
  textEdge: string;
  textStation: string;
  textBay: string;
  textBayOpacity: number;
  textFabLabel: string;
  textFabSublabel: string;
  textVehicleColor: string;
  textVehicleStrokeColor: string;
  textVehicleStrokeWidth: number;
  textVehicleSpacing: number;

  // HUD (좌측 fixed overlay) — 'dark' 면 어두운 그라데이션 + 흰글자, 'light' 면 밝은 그라데이션 + 검은글자
  hudMode: "dark" | "light";

  // Grid (선택) — Floor 위에 격자 shader 활성화 시 사용
  // gridEnabled가 false면 기존 단일 색 floor 그대로
  gridEnabled?: boolean;
  gridMinorColor?: string;
  gridMajorColor?: string;
  /** World unit 기준 minor line 간격 (예: 5) */
  gridMinorSpacing?: number;
  /** Minor N개마다 major line (예: 5 → 5 단위마다 major) */
  gridMajorEvery?: number;
  /** 카메라로부터 fade out 시작 거리 (world unit). 격자가 시야 끝에서 자연스럽게 사라짐 */
  gridFadeDistance?: number;
}

export const DEFAULT_THEME: Theme = {
  name: "default",
  label: "Default",

  background: "#1a1a1a",
  floorColor: "#404040",
  envPreset: null,
  ambientIntensity: 0.4,
  directionalIntensity: 0.8,
  fillIntensity: 0,

  railColor: "#94a3b8",
  railBorderColor: "#94a3b8",
  railBorderWidth: 0,

  stationEqColor: "#7a7a7a",
  stationOhbColor: "#6ab8e8",
  stationStkColor: "#ff2211",

  vehicleColor: "#1a85ff",
  vehicleMetalness: 0,
  vehicleRoughness: 1,
  vehicleBracket: false,

  textNode: "#00ff00",
  textEdge: "#1f2937",
  textStation: "#FFD700",
  textBay: "#ffffff",
  textBayOpacity: 0.7,
  textFabLabel: "#00e5ff",
  textFabSublabel: "#ffaa44",
  textVehicleColor: "#ffffff",
  textVehicleStrokeColor: "",
  textVehicleStrokeWidth: 0,
  textVehicleSpacing: 0.15,

  hudMode: "dark",
};

// export const WHITE_THEME: Theme = {
//   name: "white",
//   label: "White (Cleanroom)",
//
//   background: "#3a3a3a",
//   floorColor: "#b0b0b0",
//   envPreset: "warehouse",
//   ambientIntensity: 0.15,
//   directionalIntensity: 0.6,
//   fillIntensity: 0.25,
//
//   railColor: "#e8e8e8",
//   railBorderColor: "#1a1a1a",
//   railBorderWidth: 0.12,
//
//   stationEqColor: "#4a4a4a",
//   stationOhbColor: "#3a78a8",
//   stationStkColor: "#ff2211",
//
//   vehicleColor: "#1a85ff",
//   vehicleMetalness: 0.4,
//   vehicleRoughness: 0.45,
//   vehicleBracket: true,
//
//   textNode: "#0d4f1a",
//   textEdge: "#0a2966",
//   textStation: "#664400",
//   textBay: "#1a1a1a",
//   textBayOpacity: 0.7,
//   textFabLabel: "#0a3a4a",
//   textFabSublabel: "#5a3a0a",
//   textVehicleColor: "#ffffff",
//   textVehicleStrokeColor: "#000000",
//   textVehicleStrokeWidth: 10,
//   textVehicleSpacing: 0.24,
//
//   hudMode: "light",
// };
//
// export const SHAPEZ_THEME: Theme = {
//   name: "shapez",
//   label: "Shapez (Grid)",
//
//   background: "#1a1f28",
//   floorColor: "#c4c8d0",
//   envPreset: "warehouse",
//   ambientIntensity: 0.2,
//   directionalIntensity: 0.55,
//   fillIntensity: 0.2,
//
//   railColor: "#2a2e36",
//   railBorderColor: "#1a1e26",
//   railBorderWidth: 0.12,
//
//   stationEqColor: "#4a4f58",
//   stationOhbColor: "#3a78a8",
//   stationStkColor: "#ff2211",
//
//   vehicleColor: "#f97316",
//   vehicleMetalness: 0.3,
//   vehicleRoughness: 0.5,
//   vehicleBracket: true,
//
//   textNode: "#0d4f1a",
//   textEdge: "#0a2966",
//   textStation: "#5a3a0a",
//   textBay: "#1a1e26",
//   textBayOpacity: 0.7,
//   textFabLabel: "#0a3a4a",
//   textFabSublabel: "#5a3a0a",
//   textVehicleColor: "#ffffff",
//   textVehicleStrokeColor: "#000000",
//   textVehicleStrokeWidth: 10,
//   textVehicleSpacing: 0.24,
//
//   hudMode: "light",
//
//   // 격자: minor 5 단위, major 매 5번째 (= 25 단위)
//   gridEnabled: true,
//   gridMinorColor: "#b0b4bc",
//   gridMajorColor: "#878b94",
//   gridMinorSpacing: 5,
//   gridMajorEvery: 5,
//   gridFadeDistance: 400,
// };

export const THEMES: Record<string, Theme> = {
  default: DEFAULT_THEME,
  // white: WHITE_THEME,
  // shapez: SHAPEZ_THEME,
};
