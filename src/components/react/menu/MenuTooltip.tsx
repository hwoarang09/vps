// components/react/menu/MenuTooltip.tsx
import React from "react";
import { useMenuStore } from "@store/ui/menuStore";
import {
  TOOLTIP_BACKGROUND_COLOR,
  TOOLTIP_TEXT_COLOR,
  TOOLTIP_BORDER_COLOR,
  TOOLTIP_ARROW_BACKGROUND_COLOR,
  TOOLTIP_ARROW_BORDER_COLOR,
} from "./shared/types";

export const MenuTooltip: React.FC = () => {
  const { tooltipMessage, tooltipPosition, tooltipLevel, tooltipPlacement } = useMenuStore();

  if (!tooltipMessage || !tooltipPosition || !tooltipLevel) return null;

  // anchor placement: 호출자가 준 좌표 그대로 (보정 없음) — quick-view toolbar 등 작은 버튼용
  // default placement: bottom 메뉴 컨벤션 (level 1 = 위, level 2+ = 아래로 ±54 보정)
  const isAnchorMode = tooltipPlacement === "anchor";
  const isSubMenu = tooltipLevel >= 2;
  const topOffset = isAnchorMode ? 0 : isSubMenu ? 54 : -54;

  return (
    <div
      className="fixed pointer-events-none whitespace-nowrap"
      style={{
        left: tooltipPosition.x,
        top: tooltipPosition.y + topOffset,
        transform: "translateX(-50%)",
        zIndex: 9999, // 매우 높은 z-index
        backgroundColor: TOOLTIP_BACKGROUND_COLOR,
        color: TOOLTIP_TEXT_COLOR,
        border: `1px solid ${TOOLTIP_BORDER_COLOR}`,
        borderRadius: "8px",
        padding: "10px 14px",
        fontSize: "14px",
        fontWeight: "bold",
        boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)",
      }}
    >
      {tooltipMessage}

      {/* SVG 화살표 */}
      <svg
        className="absolute left-1/2 transform -translate-x-1/2"
        style={{
          [isSubMenu ? "top" : "bottom"]: [isSubMenu ? "-6px" : "-8px"], // 높이 커졌으니 위치 보정
          filter: "drop-shadow(0 2px 42px TOOLTIP_ARROW_BORDER_COLOR)", // 그림자 추가
        }}
        width="12"
        height="11"
        viewBox="0 0 12 10"
      >
        {isSubMenu ? (
          <path
            d="M6 0 L0 8 L12 8 Z" // 위쪽 삼각형
            fill={TOOLTIP_ARROW_BACKGROUND_COLOR}
            stroke={TOOLTIP_ARROW_BORDER_COLOR}
            strokeWidth="1"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ) : (
          <path
            d="M6 8 L0 0 L12 0 Z" // 아래쪽 삼각형
            fill={TOOLTIP_ARROW_BACKGROUND_COLOR}
            stroke={TOOLTIP_ARROW_BORDER_COLOR}
            strokeWidth="1"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}
      </svg>
    </div>
  );
};
