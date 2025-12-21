import { useEffect } from "react";
import { useMenuStore } from "@/store/ui/menuStore";
import { menuLevel2Config } from "../menu/data/menuLevel2Config";
import { menuLevel1Groups } from "../menu/data/MenuLevel1Config";

const KeyboardShortcutHandler = () => {
  const { activeMainMenu, activeSubMenu, setActiveSubMenu, setActiveMainMenu, setRightPanelOpen } =
    useMenuStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore keyboard shortcuts when input/textarea is focused
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        return;
      }

      // Handle ESC key - cancel Level 2 menu or Level 1 menu
      if (e.key === "Escape") {
        if (activeSubMenu) {
          // If Level 2 menu is active, close Level 2 menu but keep Level 1 menu
          e.preventDefault();
          setActiveSubMenu(null);
          setRightPanelOpen(false); // Close RightPanel when closing Level 2 menu
        } else if (activeMainMenu) {
          // If only Level 1 menu is active, close Level 1 menu
          e.preventDefault();
          setActiveMainMenu(null);
          setRightPanelOpen(false); // Close RightPanel when closing Level 1 menu
        }
        return;
      }

      // Handle 't' key for Test menu (only when no Level 1 menu is active)
      if (e.key.toLowerCase() === 't' && !activeMainMenu) {
        e.preventDefault();
        setActiveMainMenu('Test');
        return;
      }

      // Handle 'v' key for Vehicle Management
      if (e.key.toLowerCase() === 'v' && !activeMainMenu) {
        e.preventDefault();
        setActiveMainMenu('Vehicle');
        return;
      }

      // Handle 'i' key for Individual Control
      // Works even if menu is already open, just switches focus
      if (e.key.toLowerCase() === 'i') {
        e.preventDefault();
        setActiveMainMenu('Vehicle');
        setActiveSubMenu('vehicle-menu-individual');
        setRightPanelOpen(true);
        return;
      }

      // Handle number keys
      if (!/^[1-9]$/.test(e.key)) return;

      const keyNumber = Number.parseInt(e.key, 10);

      // If Level 1 menu is active, handle Level 2 menu shortcuts
      if (activeMainMenu) {
        const index = keyNumber - 1;
        const level2Menus = menuLevel2Config[activeMainMenu];

        if (level2Menus && index < level2Menus.length) {
          e.preventDefault();
          const targetLevel2Menu = level2Menus[index];
          setActiveSubMenu(targetLevel2Menu.id);

          // Check if this menu should NOT open RightPanel (e.g., CFGLoader)
          const shouldNotOpenRightPanel = targetLevel2Menu.id === "maploader-menu-1"; // Load CFG

          if (!shouldNotOpenRightPanel) {
            setRightPanelOpen(true); // Open RightPanel when Level 2 menu is selected
          }

          return;
        }
      }

      // If no Level 1 menu is active, handle Level 1 menu shortcuts
      if (!activeMainMenu) {
        // Flatten Level 1 menu groups to get all menu items in order
        const allLevel1MenuItems = menuLevel1Groups.flat();
        const index = keyNumber - 1;

        if (index < allLevel1MenuItems.length) {
          e.preventDefault();
          const targetLevel1Menu = allLevel1MenuItems[index];
          setActiveMainMenu(targetLevel1Menu.id);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    activeMainMenu,
    activeSubMenu,
    setActiveSubMenu,
    setActiveMainMenu,
    setRightPanelOpen,
  ]);

  return null;
};

export default KeyboardShortcutHandler;
