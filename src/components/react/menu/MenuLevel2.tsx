// components/react/menu/MenuLevel2.tsx
import React from "react";
import { useMenuStore } from "@store/ui/menuStore";
import { MenuButton } from "./shared";
import { menuLevel2Config } from "./data/menuLevel2Config";
import { tooltipsByLevel } from "./data/tooltipConfig";
import { menuContainerVariants } from "./shared/menuStyles";

const MenuLevel2: React.FC = () => {
  const {
    activeMainMenu, // Level 1 menu state
    activeSubMenu, // Level 2 menu state
    setActiveSubMenu, // Level 2 menu setter
    setActiveThirdMenu, // Level 3 menu setter
    setRightPanelOpen,
  } = useMenuStore();

  // Don't show Level 2 menu if Level 1 menu is not active
  if (!activeMainMenu) return null;

  const menuItems = menuLevel2Config[activeMainMenu] || [];

  const handleLevel2MenuClick = (menuId: string) => {
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

  return (
    <div className="fixed bottom-[80px] left-0 right-0 z-50 flex justify-center">
      <div className={menuContainerVariants({ level: 2 })}>
        {menuItems.map((item, index) => (
          <MenuButton
            key={item.id}
            isActive={activeSubMenu === item.id}
            onClick={() => handleLevel2MenuClick(item.id)}
            size="large" // Level 2 menu uses large size
            buttonLevel={2} // Level 2 menu
            bottomLabel={item.shortcutLabel || (index + 1).toString()}
            tooltip={tooltipsByLevel[2][item.id]} // Level 2 menu tooltip
          >
            {item.iconFn(activeSubMenu === item.id)}
          </MenuButton>
        ))}
      </div>
    </div>
  );
};

export default MenuLevel2;
