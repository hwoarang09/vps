// components/react/menu/MenuLevel1.tsx
import React from "react";
import { useMenuStore } from "@store/ui/menuStore";
import { MainMenuType } from "@/types";
import { MenuContainer, MenuButton, MenuDivider } from "./shared";
import { tooltipsByLevel } from "./data/tooltipConfig";
import { menuLevel1Groups } from "./data/MenuLevel1Config";

const MenuLevel1: React.FC = () => {
  const { activeMainMenu, setActiveMainMenu } = useMenuStore();

  const handleMenuClick = (menuId: MainMenuType) => {
    // Toggle menu if same menu is clicked, otherwise activate the clicked menu
    setActiveMainMenu(activeMainMenu === menuId ? null : menuId);
  };

  // Calculate shortcut numbers for all menu items across groups
  const allMenuItems = menuLevel1Groups.flat();

  return (
    <MenuContainer position="bottom">
      {menuLevel1Groups.map((group, groupIndex) => (
        <React.Fragment key={`group-${groupIndex}`}>
          {group.map((item) => {
            const isActive = activeMainMenu === item.id;
            // Find the index of this item in the flattened array to get the shortcut number
            const shortcutNumber =
              allMenuItems.findIndex((menuItem) => menuItem.id === item.id) + 1;

            // Use 't' for Test menu, otherwise use number
            const shortcutLabel = item.shortcutLabel || (item.id === 'Test' ? 't' : shortcutNumber.toString());

            return (
              <MenuButton
                key={item.id}
                isActive={isActive}
                onClick={() => handleMenuClick(item.id)}
                dataMenuId={item.id}
                size="small" // Level 1 menu uses small size
                buttonLevel={1} // Level 1 menu
                tooltip={tooltipsByLevel[1][item.id as MainMenuType]} // Tooltip
                bottomLabel={shortcutLabel} // Shortcut label display
              >
                {item.iconFn(isActive)}
              </MenuButton>
            );
          })}

          {/* Add divider between groups */}
          {groupIndex < menuLevel1Groups.length - 1 && (
            <div className="w-2 flex items-center justify-center mx-1">
              <MenuDivider />
            </div>
          )}
        </React.Fragment>
      ))}
    </MenuContainer>
  );
};

export default MenuLevel1;
