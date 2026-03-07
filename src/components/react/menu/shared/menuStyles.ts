// components/react/menu/shared/menuStyles.ts
import { cva, type VariantProps } from "class-variance-authority";
import { twMerge } from "tailwind-merge";

/**
 * MenuButton variants
 * - active: 버튼 활성화 상태
 * - size: small (Level 1), large (Level 2)
 */
export const menuButtonVariants = cva(
  // base: border-2 유지 (active 토글 시 레이아웃 점프 방지)
  [
    "flex flex-col items-center justify-center",
    "rounded-xl border-[3px]",
    "transition-all duration-100",
    "hover:animate-bump",
    "relative",
  ],
  {
    variants: {
      active: {
        // 비활성: 기존 남색 배경 + 투명 테두리 + 미세 빛반사
        false: [
          "bg-[#262C3F]",
          "border-transparent",
          "shadow-btn-inactive",
          "opacity-90",
          "hover:opacity-100",
          "hover:shadow-menu-hover",
        ],
        // 활성: 하늘색 배경 + 네온 테두리 + 외부 glow
        true: [
          "bg-[radial-gradient(circle,rgba(60,150,220,0.75)_0%,rgba(94,197,255,0.9)_100%)]",
          "border-menu-border-neon",
          "shadow-btn-active",
          "opacity-100",
        ],
      },
      size: {
        small: "w-14 h-14 mx-1",
        large: "w-14 h-14",
      },
    },
    defaultVariants: {
      active: false,
      size: "small",
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
          "space-x-2 px-2 py-1",
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
  "h-8 w-px mx-2",
  "bg-gradient-to-b from-transparent via-white to-transparent",
  "opacity-30"
);

/**
 * Bottom label text variants
 */
export const bottomLabelVariants = cva(
  "text-[11px] font-mono leading-none tracking-tight",
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
