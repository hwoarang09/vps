// components/react/menu/shared/panelStyles.ts
import { cva, type VariantProps } from "class-variance-authority";

/**
 * Panel container variants
 * - Dark theme panel with glassmorphism effect
 */
export const panelContainerVariants = cva(
  [
    "bg-panel-bg",
    "border border-panel-border",
    "rounded-xl",
    "shadow-lg",
    "backdrop-blur-sm",
  ],
  {
    variants: {
      position: {
        right: "h-full flex flex-col",
        top: "fixed top-2.5 left-1/2 -translate-x-1/2 z-[1001]",
        floating: "absolute",
      },
      padding: {
        none: "",
        sm: "p-2",
        md: "p-4",
        lg: "p-6",
      },
    },
    defaultVariants: {
      position: "right",
      padding: "none",
    },
  }
);

export type PanelContainerVariants = VariantProps<typeof panelContainerVariants>;

/**
 * Panel header variants
 */
export const panelHeaderVariants = cva(
  [
    "flex items-center justify-between",
    "border-b border-panel-border",
  ],
  {
    variants: {
      size: {
        sm: "p-2",
        md: "p-3",
        lg: "p-4",
      },
    },
    defaultVariants: {
      size: "md",
    },
  }
);

/**
 * Panel title variants
 */
export const panelTitleVariants = cva(
  "font-semibold",
  {
    variants: {
      size: {
        sm: "text-sm",
        md: "text-base",
        lg: "text-lg",
      },
      color: {
        white: "text-white",
        orange: "text-accent-orange",
        muted: "text-gray-300",
      },
    },
    defaultVariants: {
      size: "md",
      color: "white",
    },
  }
);

/**
 * Panel content area
 */
export const panelContentVariants = cva(
  "flex-1 overflow-y-auto",
  {
    variants: {
      padding: {
        none: "",
        sm: "p-2",
        md: "p-3",
        lg: "p-4",
      },
    },
    defaultVariants: {
      padding: "md",
    },
  }
);

/**
 * Panel close button
 */
export const panelCloseButtonClass =
  "text-gray-400 hover:text-white text-xl transition-colors";

/**
 * Panel input variants
 */
export const panelInputVariants = cva(
  [
    "bg-panel-bg-solid",
    "text-white",
    "border border-panel-border",
    "rounded",
    "font-mono text-sm",
    "focus:outline-none focus:border-accent-cyan",
    "transition-colors",
  ],
  {
    variants: {
      size: {
        sm: "px-2 py-1 text-xs",
        md: "px-3 py-1.5 text-sm",
        lg: "px-4 py-2 text-base",
      },
      width: {
        auto: "",
        full: "w-full",
        fixed: "w-[70px]",
      },
    },
    defaultVariants: {
      size: "md",
      width: "auto",
    },
  }
);

export type PanelInputVariants = VariantProps<typeof panelInputVariants>;

/**
 * Panel select/dropdown variants
 */
export const panelSelectVariants = cva(
  [
    "bg-panel-bg-solid",
    "text-white",
    "border rounded",
    "font-mono text-sm",
    "cursor-pointer",
    "focus:outline-none",
    "transition-colors",
  ],
  {
    variants: {
      accent: {
        cyan: "border-accent-cyan focus:border-accent-cyan",
        orange: "border-accent-yellow focus:border-accent-orange",
        purple: "border-accent-purple focus:border-accent-purple",
        default: "border-panel-border focus:border-accent-cyan",
      },
      size: {
        sm: "px-2 py-1 text-xs",
        md: "px-3 py-1.5 text-sm",
      },
    },
    defaultVariants: {
      accent: "default",
      size: "md",
    },
  }
);

export type PanelSelectVariants = VariantProps<typeof panelSelectVariants>;

/**
 * Panel button variants
 */
export const panelButtonVariants = cva(
  [
    "text-white",
    "border-none rounded",
    "font-bold text-xs",
    "cursor-pointer",
    "transition-all duration-200",
    "flex items-center justify-center gap-1",
  ],
  {
    variants: {
      variant: {
        primary: "bg-accent-cyan hover:bg-accent-cyan/80 hover:shadow-glow-cyan",
        success: "bg-accent-green hover:bg-accent-green/80 hover:shadow-glow-green",
        danger: "bg-accent-red hover:bg-accent-red/80 hover:shadow-glow-red",
        warning: "bg-accent-yellow hover:bg-accent-yellow/80 hover:shadow-glow-orange",
        purple: "bg-accent-purple hover:bg-accent-purple/80 hover:shadow-glow-purple",
        ghost: "bg-transparent border border-panel-border hover:bg-panel-bg-light",
        // Glow variants - for active/selected states
        "glow-cyan": "bg-accent-cyan shadow-glow-cyan-strong border border-accent-cyan/50",
        "glow-orange": "bg-accent-orange shadow-glow-orange-strong border border-accent-orange/50",
        "glow-blue": "bg-blue-500 shadow-glow-blue-strong border border-blue-400/50",
      },
      size: {
        sm: "px-2 py-1 text-[11px]",
        md: "px-3 py-1.5 text-xs",
        lg: "px-4 py-2 text-sm",
      },
      disabled: {
        true: "opacity-50 cursor-not-allowed",
        false: "",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
      disabled: false,
    },
  }
);

export type PanelButtonVariants = VariantProps<typeof panelButtonVariants>;

/**
 * Panel label variants
 */
export const panelLabelVariants = cva(
  "font-bold",
  {
    variants: {
      color: {
        white: "text-white",
        orange: "text-accent-orange",
        muted: "text-gray-400",
        cyan: "text-accent-cyan",
      },
      size: {
        xs: "text-[10px]",
        sm: "text-xs",
        md: "text-sm",
      },
    },
    defaultVariants: {
      color: "white",
      size: "sm",
    },
  }
);

/**
 * Panel divider (vertical separator)
 */
export const panelDividerClass =
  "h-full w-px bg-gray-600 mx-3";

/**
 * Panel badge/tag variants
 */
export const panelBadgeVariants = cva(
  "px-2 py-0.5 rounded text-xs font-medium",
  {
    variants: {
      variant: {
        default: "bg-panel-bg-light text-gray-300",
        success: "bg-accent-green/20 text-accent-green",
        warning: "bg-accent-yellow/20 text-accent-yellow",
        info: "bg-accent-cyan/20 text-accent-cyan",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

/**
 * Panel card variants (for list items, info boxes)
 */
export const panelCardVariants = cva(
  [
    "rounded-lg",
    "border border-panel-border",
    "transition-all duration-200",
  ],
  {
    variants: {
      variant: {
        default: "bg-panel-bg-light",
        interactive: "bg-panel-bg-light hover:bg-panel-bg-light/80 cursor-pointer",
        highlight: "bg-accent-orange/10 border-accent-orange/30",
        // Glow variants - selected/active states
        "glow-orange": "bg-accent-orange/10 border-accent-orange/50 shadow-glow-orange",
        "glow-cyan": "bg-accent-cyan/10 border-accent-cyan/50 shadow-glow-cyan",
        "glow-blue": "bg-blue-500/10 border-blue-400/50 shadow-glow-blue",
        "glow-green": "bg-accent-green/10 border-accent-green/50 shadow-glow-green",
        "glow-purple": "bg-accent-purple/10 border-accent-purple/50 shadow-glow-purple",
      },
      padding: {
        sm: "p-2",
        md: "p-3",
        lg: "p-4",
      },
    },
    defaultVariants: {
      variant: "default",
      padding: "md",
    },
  }
);

export type PanelCardVariants = VariantProps<typeof panelCardVariants>;

/**
 * Panel text variants
 */
export const panelTextVariants = cva(
  "",
  {
    variants: {
      variant: {
        body: "text-gray-300",
        muted: "text-gray-500",
        accent: "text-accent-orange",
        white: "text-white",
      },
      size: {
        xs: "text-[10px]",
        sm: "text-xs",
        md: "text-sm",
        lg: "text-base",
      },
    },
    defaultVariants: {
      variant: "body",
      size: "sm",
    },
  }
);

/**
 * Panel row for horizontal flex layouts
 */
export const panelRowClass = "flex items-center gap-2";

/**
 * Panel section with spacing
 */
export const panelSectionClass = "space-y-3";
