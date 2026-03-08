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
    // Calculate button center X for Lv2 positioning
    const btn = document.querySelector(`[data-menu-id="${menuId}"]`);
    const centerX = btn ? btn.getBoundingClientRect().left + btn.getBoundingClientRect().width / 2 : undefined;
    // Toggle menu if same menu is clicked, otherwise activate the clicked menu
    setActiveMainMenu(activeMainMenu === menuId ? null : menuId, centerX);
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

            const shortcutLabel = item.shortcutLabel || shortcutNumber.toString();

            return (
              <MenuButton
                key={item.id}
                isActive={isActive}
                onClick={() => handleMenuClick(item.id)}
                dataMenuId={item.id}
                size="small"
                buttonLevel={1}
                tooltip={tooltipsByLevel[1][item.id as MainMenuType]}
                bottomLabel={shortcutLabel}
                bgColor={item.bgColor}
              >
                {item.iconFn(isActive)}
              </MenuButton>
            );
          })}

          {/* Add divider between groups */}
          {groupIndex < menuLevel1Groups.length - 1 && <MenuDivider />}
        </React.Fragment>
      ))}
    </MenuContainer>
  );
};

export default MenuLevel1;
