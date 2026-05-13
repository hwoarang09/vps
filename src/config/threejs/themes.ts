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

  railColor: "#0066ff",
  railBorderColor: "#0066ff",
  railBorderWidth: 0,

  stationEqColor: "#7a7a7a",
  stationOhbColor: "#6ab8e8",
  stationStkColor: "#ff2211",

  vehicleColor: "#1a85ff",
  vehicleMetalness: 0,
  vehicleRoughness: 1,
  vehicleBracket: false,

  textNode: "#00ff00",
  textEdge: "#0066ff",
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

export const WHITE_THEME: Theme = {
  name: "white",
  label: "White (Cleanroom)",

  background: "#3a3a3a",
  floorColor: "#b0b0b0",
  envPreset: "warehouse",
  ambientIntensity: 0.15,
  directionalIntensity: 0.6,
  fillIntensity: 0.25,

  railColor: "#e8e8e8",
  railBorderColor: "#1a1a1a",
  railBorderWidth: 0.12,

  stationEqColor: "#4a4a4a",
  stationOhbColor: "#3a78a8",
  stationStkColor: "#ff2211",

  vehicleColor: "#1a85ff",
  vehicleMetalness: 0.4,
  vehicleRoughness: 0.45,
  vehicleBracket: true,

  textNode: "#0d4f1a",
  textEdge: "#0a2966",
  textStation: "#664400",
  textBay: "#1a1a1a",
  textBayOpacity: 0.7,
  textFabLabel: "#0a3a4a",
  textFabSublabel: "#5a3a0a",
  textVehicleColor: "#ffffff",
  textVehicleStrokeColor: "#000000",
  textVehicleStrokeWidth: 10,
  textVehicleSpacing: 0.24,

  hudMode: "light",
};

export const THEMES: Record<string, Theme> = {
  default: DEFAULT_THEME,
  white: WHITE_THEME,
};
