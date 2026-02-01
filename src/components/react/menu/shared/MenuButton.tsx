// components/react/menu/shared/MenuButton.tsx
import React from "react";
import { useMenuStore } from "@store/ui/menuStore";
import { menuButtonVariants, bottomLabelVariants } from "./menuStyles";
import { twMerge } from "tailwind-merge";

interface MenuButtonProps {
  isActive: boolean;
  onClick: () => void;
  size?: "small" | "large";
  children: React.ReactNode;
  dataMenuId?: string;
  className?: string;
  tooltip?: string;
  bottomLabel?: string;
  buttonLevel?: number;
}

export const MenuButton: React.FC<MenuButtonProps> = ({
  isActive,
  onClick,
  size = "large",
  children,
  dataMenuId,
  className = "",
  tooltip,
  bottomLabel,
  buttonLevel = 1,
}) => {
  const { showTooltip, hideTooltip } = useMenuStore();

  const handleMouseEnter = (e: React.MouseEvent) => {
    if (tooltip) {
      const rect = e.currentTarget.getBoundingClientRect();
      showTooltip(
        dataMenuId || "",
        tooltip,
        {
          x: rect.left + rect.width / 2,
          y: rect.top,
        },
        buttonLevel
      );
    }
  };

  const handleMouseLeave = () => {
    hideTooltip();
  };

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    hideTooltip();
    onClick();
    e.currentTarget.blur();
  };

  return (
    <div className="relative flex flex-col items-center justify-center">
      <button
        type="button"
        data-menu-id={dataMenuId}
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className={twMerge(
          menuButtonVariants({ active: isActive, size }),
          className
        )}
      >
        {children}
        {bottomLabel && (
          <span className={bottomLabelVariants({ active: isActive })}>
            {bottomLabel}
          </span>
        )}
      </button>
    </div>
  );
};
