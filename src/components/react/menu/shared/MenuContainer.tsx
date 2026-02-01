// components/react/menu/shared/MenuContainer.tsx
import React from "react";
import { menuContainerVariants } from "./menuStyles";
import { twMerge } from "tailwind-merge";

interface MenuContainerProps {
  children: React.ReactNode;
  className?: string;
  position?: "bottom" | "floating";
  floatingPosition?: { x: number; y: number };
  level?: 1 | 2;
}

export const MenuContainer: React.FC<MenuContainerProps> = ({
  children,
  className = "",
  position = "bottom",
  floatingPosition,
  level = 1,
}) => {
  const positionClass =
    position === "bottom"
      ? "fixed bottom-2 left-0 right-0 z-50 flex justify-center"
      : "fixed z-50";

  const floatingStyle =
    position === "floating" && floatingPosition
      ? {
          left: floatingPosition.x,
          bottom: `calc(100vh - ${floatingPosition.y}px)`,
          transform: "translateX(-50%)",
        }
      : {};

  return (
    <div className={positionClass} style={floatingStyle}>
      <div
        className={twMerge(
          menuContainerVariants({ level }),
          className
        )}
      >
        {children}
      </div>
    </div>
  );
};
