// components/react/menu/shared/menuStyles.ts
import { cva, type VariantProps } from "class-variance-authority";
import { twMerge } from "tailwind-merge";

/**
 * MenuButton variants
 * - active: 버튼 활성화 상태
 * - size: small (Level 1), large (Level 2)
 */
export const menuButtonVariants = cva(
  // base styles
  [
    "flex flex-col items-center justify-center",
    "rounded-xl border-2",
    "text-xs font-medium",
    "transition-all duration-100",
    "hover:animate-bump",
  ],
  {
    variants: {
      active: {
        true: [
          "bg-menu-active-bg",
          "border-menu-border-active",
          "shadow-menu-glow",
        ],
        false: [
          "bg-menu-inactive-bg",
          "border-transparent",
          "hover:border-white/40",
          "hover:shadow-menu-hover",
        ],
      },
      size: {
        small: "w-12 h-10 mx-1",
        large: "w-12 h-12",
      },
    },
    defaultVariants: {
      active: false,
      size: "large",
    },
  }
);

export type MenuButtonVariants = VariantProps<typeof menuButtonVariants>;

/**
 * MenuContainer variants
 * - level: 1 (bottom menu), 2 (sub menu)
 * - position: bottom (fixed), floating (absolute positioned)
 */
export const menuContainerVariants = cva(
  // base styles
  ["flex", "rounded-xl", "border-2"],
  {
    variants: {
      level: {
        1: [
          "py-2 px-1",
          "bg-menu-container-bg",
          "border-menu-border-container",
          "opacity-[0.98]",
          "shadow-menu-container-glow",
        ],
        2: [
          "space-x-2 p-2",
          "bg-menu-container-bg-lv2",
          "border-menu-border-container-lv2",
          "opacity-95",
          "shadow-menu-container-glow",
        ],
      },
    },
    defaultVariants: {
      level: 1,
    },
  }
);

export type MenuContainerVariants = VariantProps<typeof menuContainerVariants>;

/**
 * MenuDivider styles (simple class string)
 */
export const menuDividerClass = twMerge(
  "h-8 w-px",
  "bg-gradient-to-b from-transparent via-white to-transparent",
  "opacity-30"
);

/**
 * Bottom label text variants
 */
export const bottomLabelVariants = cva(
  "text-xs font-mono leading-none tracking-tight",
  {
    variants: {
      active: {
        true: "text-gray-400",
        false: "text-gray-200",
      },
    },
    defaultVariants: {
      active: false,
    },
  }
);

export type BottomLabelVariants = VariantProps<typeof bottomLabelVariants>;
