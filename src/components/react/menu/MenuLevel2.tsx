// components/react/menu/MenuLevel2.tsx
import React from "react";
import { useMenuStore } from "@store/ui/menuStore";
import { useVisualizationStore } from "@store/ui/visualizationStore";
import { MenuButton } from "./shared";
import { menuLevel2Config } from "./data/menuLevel2Config";
import { tooltipsByLevel } from "./data/tooltipConfig";
import { menuContainerVariants } from "./shared/menuStyles";

const MenuLevel2: React.FC = () => {
  const {
    activeMainMenu, // Level 1 menu state
    activeSubMenu, // Level 2 menu state
    activeMainMenuCenterX, // Lv1 button center X
    setActiveSubMenu, // Level 2 menu setter
    setActiveThirdMenu, // Level 3 menu setter
    setRightPanelOpen,
  } = useMenuStore();

  // Don't show Level 2 menu if Level 1 menu is not active
  if (!activeMainMenu) return null;

  const menuItems = menuLevel2Config[activeMainMenu] || [];

  const { togglePerfLeft, togglePerfRight, showPerfLeft } = useVisualizationStore();

  const handleLevel2MenuClick = (menuId: string) => {
    // vis-performance: 직접 토글 (RightPanel 사용 안 함)
    if (menuId === "vis-performance") {
      togglePerfLeft();
      togglePerfRight();
      return;
    }

    // Toggle menu if same menu is clicked, otherwise activate the clicked menu
    const newActiveSubMenu = activeSubMenu === menuId ? null : menuId;
    setActiveSubMenu(newActiveSubMenu);

    // Handle Level 3 menu only when Level 2 menu is selected
    if (newActiveSubMenu) {
      // Check if this menu has Level 3 submenu
      // Example: Only some MapBuilder menus have Level 3
      const hasThirdLevelMenu =
        activeMainMenu === "MapBuilder" &&
        // ["map-menu-1", "map-menu-2"].includes(menuId);
        ["temporary"].includes(menuId);

      // Check if this menu should NOT open RightPanel (e.g., CFGLoader, Test menus)
      const shouldNotOpenRightPanel =
        menuId === "maploader-menu-1" || // Load CFG
        menuId.startsWith("test-"); // All test menus

      if (hasThirdLevelMenu) {
        // Has Level 3 menu - auto-select first Level 3 menu item
        setActiveThirdMenu(`${menuId}-sub-1`);
      } else if (!shouldNotOpenRightPanel) {
        // No Level 3 menu and should open RightPanel
        setRightPanelOpen(true);
      }
      // If shouldNotOpenRightPanel is true, don't open RightPanel
    } else {
      // Level 2 menu deactivated - close Level 3 menu and right panel
      setActiveThirdMenu(null);
      setRightPanelOpen(false);
    }
  };

  // Compute left position: center on Lv1 button, clamped to viewport
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
    <div className="fixed bottom-[90px] z-50" style={positionStyle}>
      <div className={menuContainerVariants({ level: 2 })}>
        {menuItems.map((item, index) => (
          <MenuButton
            key={item.id}
            isActive={item.id === "vis-performance" ? showPerfLeft : activeSubMenu === item.id}
            onClick={() => handleLevel2MenuClick(item.id)}
            size="large"
            buttonLevel={2}
            bottomLabel={item.shortcutLabel || (index + 1).toString()}
            tooltip={tooltipsByLevel[2][item.id]}
            bgColor={item.bgColor}
          >
            {item.iconFn(activeSubMenu === item.id)}
          </MenuButton>
        ))}
      </div>
    </div>
  );
};

export default MenuLevel2;
