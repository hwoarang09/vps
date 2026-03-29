import { useEffect } from "react";
import { useMenuStore } from "@/store/ui/menuStore";
import { useVehicleArrayStore } from "@/store/vehicle/arrayMode/vehicleStore";
import { useFabConfigStore } from "@/store/simulation/fabConfigStore";
import { menuLevel2Config } from "../menu/data/menuLevel2Config";
import { menuLevel3Config } from "../menu/data/menuLevel3Config";
import { menuLevel1Groups } from "../menu/data/MenuLevel1Config";
import { MainMenuType } from "@/types";

// Shortcut key to lv1 menu mapping
const LV1_SHORTCUT_MAP: Record<string, MainMenuType> = {
  m: "MQTT",
  t: "DevTools",
  f: "Search",
  o: "Operation",
  s: "Statistics",
  d: "DataPanel",
};

// Shortcut key to lv2 menu mapping (within currently active lv1 menu)
const LV2_SHORTCUT_MAP: Record<string, Record<string, string>> = {
  MQTT: {
    c: "mqtt-connection",
  },
  DevTools: {
    l: "devtools-lock",
  },
  Search: {
    v: "search-vehicle",
    n: "search-node",
    e: "search-edge",
    s: "search-station",
  },
  Operation: {
    l: "operation-menu-6",
    m: "operation-menu-7",
    p: "operation-menu-8",
  },
};

/** Lv1 버튼의 center X 좌표를 DOM에서 계산 */
const getMenuCenterX = (menuId: string): number | undefined => {
  const btn = document.querySelector(`[data-menu-id="${menuId}"]`);
  if (!btn) return undefined;
  const rect = btn.getBoundingClientRect();
  return rect.left + rect.width / 2;
};

const KeyboardShortcutHandler = () => {
  const {
    activeMainMenu,
    activeSubMenu,
    setActiveSubMenu,
    setActiveMainMenu,
    setRightPanelOpen,
    switchToMainMenuWithMemory,
  } = useMenuStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore keyboard shortcuts when input/textarea is focused
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
        return;
      }

      const key = e.key.toLowerCase();

      // Handle ESC key - cancel Level 2 menu or Level 1 menu
      if (e.key === "Escape") {
        if (activeSubMenu) {
          // If Level 2 menu is active, close Level 2 menu but keep Level 1 menu
          e.preventDefault();
          setActiveSubMenu(null);
          setRightPanelOpen(false);
        } else if (activeMainMenu) {
          // If only Level 1 menu is active, close Level 1 menu
          e.preventDefault();
          setActiveMainMenu(null);
          setRightPanelOpen(false);
        }
        return;
      }

      // Handle Shift + letter key: Switch to lv1 menu with memory (restore last lv2)
      if (e.shiftKey && LV1_SHORTCUT_MAP[key]) {
        e.preventDefault();
        switchToMainMenuWithMemory(LV1_SHORTCUT_MAP[key], getMenuCenterX(LV1_SHORTCUT_MAP[key]));
        return;
      }

      // Handle lv1 menu shortcuts (only when no lv1 menu is active)
      if (!activeMainMenu && LV1_SHORTCUT_MAP[key]) {
        e.preventDefault();
        setActiveMainMenu(LV1_SHORTCUT_MAP[key], getMenuCenterX(LV1_SHORTCUT_MAP[key]));
        return;
      }

      // Handle lv2 menu shortcuts (when lv1 menu is active)
      if (activeMainMenu && LV2_SHORTCUT_MAP[activeMainMenu]?.[key]) {
        e.preventDefault();
        const targetSubMenu = LV2_SHORTCUT_MAP[activeMainMenu][key];

        // operation-menu-8 (Params, 'p'): SimulationParamsModal 열기
        if (targetSubMenu === "operation-menu-8") {
          useFabConfigStore.getState().setModalOpen(true);
          return;
        }

        setActiveSubMenu(targetSubMenu);

        // Check if this menu should NOT open RightPanel
        const hasLv3 = targetSubMenu in menuLevel3Config;
        const shouldNotOpenRightPanel =
          hasLv3 ||
          targetSubMenu === "operation-menu-2" ||
          targetSubMenu.startsWith("test-");

        if (!shouldNotOpenRightPanel) {
          setRightPanelOpen(true);
        }
        return;
      }

      // Handle number keys
      if (!/^[1-9]$/.test(e.key)) return;

      const keyNumber = Number.parseInt(e.key, 10);

      // If Level 3 menu is open (LV2 has LV3 config), handle Level 3 shortcuts first
      if (activeMainMenu && activeSubMenu && activeSubMenu in menuLevel3Config) {
        const lv3Items = menuLevel3Config[activeSubMenu];
        const index = keyNumber - 1;
        if (lv3Items && index < lv3Items.length) {
          e.preventDefault();
          const item = lv3Items[index];
          // Transfer mode selection
          if (item.transferMode !== undefined) {
            useVehicleArrayStore.getState().setTransferMode(item.transferMode);
          }
          return;
        }
      }

      // If Level 1 menu is active, handle Level 2 menu shortcuts
      if (activeMainMenu) {
        const index = keyNumber - 1;
        const level2Menus = menuLevel2Config[activeMainMenu];

        if (level2Menus && index < level2Menus.length) {
          e.preventDefault();
          const targetLevel2Menu = level2Menus[index];
          setActiveSubMenu(targetLevel2Menu.id);

          // Check if this menu should NOT open RightPanel
          const hasLv3 = targetLevel2Menu.id in menuLevel3Config;
          const shouldNotOpenRightPanel =
            hasLv3 ||
            targetLevel2Menu.id === "operation-menu-2" ||
            targetLevel2Menu.id.startsWith("test-");

          if (!shouldNotOpenRightPanel) {
            setRightPanelOpen(true);
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
          setActiveMainMenu(targetLevel1Menu.id, getMenuCenterX(targetLevel1Menu.id));
        }
      }
    };

    globalThis.addEventListener("keydown", handleKeyDown);
    return () => globalThis.removeEventListener("keydown", handleKeyDown);
  }, [
    activeMainMenu,
    activeSubMenu,
    setActiveSubMenu,
    setActiveMainMenu,
    setRightPanelOpen,
    switchToMainMenuWithMemory,
  ]);

  return null;
};

export default KeyboardShortcutHandler;
