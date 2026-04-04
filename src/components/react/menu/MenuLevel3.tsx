// components/react/menu/MenuLevel3.tsx
import React from "react";
import { useMenuStore } from "@store/ui/menuStore";
import { MenuButton } from "./shared";
import { menuLevel3Config } from "./data/menuLevel3Config";
import { tooltipsByLevel } from "./data/tooltipConfig";
import { menuContainerVariants } from "./shared/menuStyles";

const MenuLevel3: React.FC = () => {
  const { activeSubMenu, activeMainMenuCenterX, activeThirdMenu, setActiveThirdMenu, setRightPanelOpen } = useMenuStore();

  if (!activeSubMenu) return null;

  const menuItems = menuLevel3Config[activeSubMenu];
  if (!menuItems || menuItems.length === 0) return null;

  const handleClick = (item: (typeof menuItems)[number]) => {
    setActiveThirdMenu(item.id);
    setRightPanelOpen(true);
  };

  // Compute left position: same as LV2
  const positionStyle: React.CSSProperties = activeMainMenuCenterX != null
    ? {
        left: `clamp(120px, ${activeMainMenuCenterX}px, calc(100vw - 120px))`,
        transform: "translateX(-50%)",
      }
    : {
        left: "50%",
        transform: "translateX(-50%)",
      };

  return (
    <div className="fixed bottom-[170px] z-50" style={positionStyle}>
      <div className={menuContainerVariants({ level: 2 })}>
        {menuItems.map((item) => {
          const isActive = activeThirdMenu === item.id;

          return (
            <MenuButton
              key={item.id}
              isActive={isActive}
              onClick={() => handleClick(item)}
              size="large"
              buttonLevel={3}
              bottomLabel={item.shortcutLabel}
              tooltip={tooltipsByLevel[3][item.id] || item.label}
            >
              <span className="text-xs font-bold text-white">{item.label}</span>
            </MenuButton>
          );
        })}
      </div>
    </div>
  );
};

export default MenuLevel3;
