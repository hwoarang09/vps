// components/react/menu/shared/MenuButton.tsx (완전히 새로운 버전)
import React, { useState } from "react";
import { useMenuStore } from "@store/ui/menuStore";
import {
  MENU_BUTTON_ACTIVE_BACKGROUND,
  MENU_BUTTON_INACTIVE_BACKGROUND,
  MENU_BUTTON_ACTIVE_BORDER,
  MENU_BUTTON_INACTIVE_BORDER,
  MENU_BUTTON_HOVER_BORDER,
  MENU_BUTTON_ACTIVE_SHADOW,
  MENU_BUTTON_HOVER_SHADOW,
  MENU_BUTTON_INACTIVE_SHADOW,
  MENU_BUTTON_LARGE_SIZE,
  MENU_BUTTON_SMALL_SIZE,
} from "./types";

interface MenuButtonProps {
  isActive: boolean;
  onClick: () => void;
  size?: "small" | "large";
  children: React.ReactNode;
  dataMenuId?: string;
  className?: string;
  tooltip?: string;
  bottomLabel?: string;
  buttonLevel?: number; // 기본값 1
  // 커스터마이징 가능한 색상 props
  activeBackgroundColor?: string;
  inactiveBackgroundColor?: string;
  activeBorderColor?: string;
  inactiveBorderColor?: string;
  activeBoxShadow?: string;
  inactiveBoxShadow?: string;
  borderWidth?: string;
  borderRadius?: string;
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
  // 기본값들 - 공통 상수 사용
  activeBackgroundColor = MENU_BUTTON_ACTIVE_BACKGROUND,
  inactiveBackgroundColor = MENU_BUTTON_INACTIVE_BACKGROUND,
  activeBorderColor = MENU_BUTTON_ACTIVE_BORDER,
  inactiveBorderColor = MENU_BUTTON_INACTIVE_BORDER,
  activeBoxShadow = MENU_BUTTON_ACTIVE_SHADOW,
  inactiveBoxShadow = MENU_BUTTON_INACTIVE_SHADOW,
  borderWidth = "2px",
  borderRadius = "rounded-xl",
}) => {
  const { showTooltip, hideTooltip } = useMenuStore();
  const [isHovered, setIsHovered] = useState(false);

  const sizeConfig =
    size === "large" ? MENU_BUTTON_LARGE_SIZE : MENU_BUTTON_SMALL_SIZE;
  const sizeClass = `${sizeConfig.width} ${sizeConfig.height}`;
  const marginClass = size === "small" ? "mx-1" : "";

  const handleMouseEnter = (e: React.MouseEvent) => {
    setIsHovered(true);

    // 툴팁이 있으면 항상 표시
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
    setIsHovered(false);
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
        className={`
        ${sizeClass} ${marginClass} flex flex-col items-center justify-center ${borderRadius} text-xs font-medium
        transition-all duration-100
        hover:animate-bump
        ${className}
      `}
        style={{
          backgroundColor: isActive
            ? activeBackgroundColor
            : inactiveBackgroundColor,
          border: `${borderWidth} solid`,
          borderColor: isActive
            ? activeBorderColor
            : isHovered
            ? MENU_BUTTON_HOVER_BORDER
            : inactiveBorderColor,
          boxShadow: isActive
            ? activeBoxShadow
            : isHovered
            ? MENU_BUTTON_HOVER_SHADOW
            : inactiveBoxShadow,
        }}
      >
        {children}
        {bottomLabel && (
          // <span
          //   className={`text-xs font-mono ${
          //     isActive ? "text-gray-400" : "text-gray-400"
          //   }`}
          // >
          <span className={`text-xs font-mono leading-none tracking-tight ${
               isActive ? "text-gray-400" : "text-gray-200"
             }`}> 
            {bottomLabel}
          </span>
        )}
      </button>
    </div>
  );
};
