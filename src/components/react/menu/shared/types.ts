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

// Icon size constants
export const ICON_SIZE_LARGE = 30; // Large icon for Level 2 menu
export const ICON_SIZE_MEDIUM = 24; // Medium icon for Level 1 menu
export const ICON_SIZE_SMALL = 20; // Small icon


// MenuButton styles are now defined in menuStyles.ts using CVA
