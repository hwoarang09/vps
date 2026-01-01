import { MainMenuType } from "@/types";

export type MenuLevel1Item = {
  id: MainMenuType;
  label: string;
  iconFn: (isActive: boolean) => JSX.Element;
  shortcutLabel?: string;
};

export type MenuLevel2Item = {
  id: string;
  label: string;
  iconFn: (isActive: boolean) => JSX.Element;
  shortcutLabel?: string;
};

// Common color constants
export const ACTIVE_STROKE_COLOR = "rgb(250,250,250)";
export const INACTIVE_STROKE_COLOR = "rgb(200,200,200)";
export const ACTIVE_FILL_COLOR = "rgba(255,255,255,0.9)";
export const INACTIVE_FILL_COLOR = "rgba(255,255,255,0.8)";

// Tooltip color constants
export const TOOLTIP_BACKGROUND_COLOR = "rgba(0, 0, 0, 0.95)";
export const TOOLTIP_TEXT_COLOR = "rgba(255, 140, 0, 1)"; // Deep orange (high saturation)
export const TOOLTIP_BORDER_COLOR = "rgba(255,255,255,0.4)";
export const TOOLTIP_ARROW_BACKGROUND_COLOR = "rgba(85,90,98,0.99)";
export const TOOLTIP_ARROW_BORDER_COLOR = "rgba(230,230,230, 0.99)";

// Tooltip style constants


// Menu size constants
export const MENU_BUTTON_LARGE_SIZE = { width: "w-12", height: "h-12" }; // 64px x 64px
export const MENU_BUTTON_SMALL_SIZE = { width: "w-12", height: "h-10" }; // 48px x 40px

// Icon size constants
export const ICON_SIZE_LARGE = 30; // Large icon for Level 2 menu
export const ICON_SIZE_MEDIUM = 24; // Medium icon for Level 1 menu
export const ICON_SIZE_SMALL = 20; // Small icon


// MenuButton color constants
export const MENU_BUTTON_ACTIVE_BACKGROUND = "rgba(94, 197, 255, 0.85)";
export const MENU_BUTTON_INACTIVE_BACKGROUND = "#262C3F";
export const MENU_BUTTON_ACTIVE_BORDER = "rgba(156,237,255, 1.0)";
export const MENU_BUTTON_INACTIVE_BORDER = "transparent";
export const MENU_BUTTON_HOVER_BORDER = "rgba(255,255,255,0.4)"; // Same as tooltip text color
export const MENU_BUTTON_ACTIVE_SHADOW =
  "0 0 8px rgba(156,237,255, 0.4), 0 0 7px rgba(156,237,255, 0.4), inset 0 0 15px rgba(156,237,255, 0.8)";
export const MENU_BUTTON_HOVER_SHADOW =
  "0 0 6px rgba(255,255,255, 0.3), 0 0 4px rgba(255,255,255, 0.2)"; // Soft white glow
export const MENU_BUTTON_INACTIVE_SHADOW = "none";
