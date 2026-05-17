// components/react/menu/MenuTooltip.tsx
import React, { useLayoutEffect, useRef, useState } from "react";
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

  const tooltipRef = useRef<HTMLDivElement>(null);
  const [shift, setShift] = useState(0);

  // 툴팁 박스가 오른쪽 화면 밖으로 나가면, 나간 만큼 왼쪽으로 밀기
  useLayoutEffect(() => {
    if (!tooltipRef.current || !tooltipPosition) {
      setShift(0);
      return;
    }
    const width = tooltipRef.current.offsetWidth;
    const overflow = tooltipPosition.x + width / 2 - (window.innerWidth - 8);
    setShift(overflow > 0 ? overflow : 0);
  }, [tooltipMessage, tooltipPosition]);

  if (!tooltipMessage || !tooltipPosition || !tooltipLevel) return null;

  const isAnchorMode = tooltipPlacement === "anchor";
  const isSubMenu = tooltipLevel >= 2;
  const topOffset = isAnchorMode ? 0 : isSubMenu ? 54 : -54;

  return (
    <div
      ref={tooltipRef}
      className="fixed pointer-events-none whitespace-nowrap"
      style={{
        left: tooltipPosition.x - shift,
        top: tooltipPosition.y + topOffset,
        transform: "translateX(-50%)",
        zIndex: 9999,
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

      {/* SVG 화살표 — shift만큼 오른쪽으로 보정해 버튼 중심을 가리킴 */}
      <svg
        className="absolute transform -translate-x-1/2"
        style={{
          left: `calc(50% + ${shift}px)`,
          [isSubMenu ? "top" : "bottom"]: [isSubMenu ? "-6px" : "-8px"],
          filter: "drop-shadow(0 2px 42px TOOLTIP_ARROW_BORDER_COLOR)",
        }}
        width="12"
        height="11"
        viewBox="0 0 12 10"
      >
        {isSubMenu ? (
          <path
            d="M6 0 L0 8 L12 8 Z"
            fill={TOOLTIP_ARROW_BACKGROUND_COLOR}
            stroke={TOOLTIP_ARROW_BORDER_COLOR}
            strokeWidth="1"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ) : (
          <path
            d="M6 8 L0 0 L12 0 Z"
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
