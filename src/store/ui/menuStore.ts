// store/menuStore.ts (최종 버전)
import { create } from "zustand";
import { MainMenuType } from "@/types";

export interface MenuState {
  // Menu hierarchy state
  activeMainMenu: MainMenuType | null; // Level 1 menu (bottom)
  activeSubMenu: string | null; // Level 2 menu (appears when lv1 is clicked)
  activeThirdMenu: string | null; // Level 3 menu (if needed)
  rightPanelOpen: boolean;

  // Remember last selected lv2 menu for each lv1 menu
  lastSubMenuByMainMenu: Partial<Record<MainMenuType, string>>;

  // Tooltip state
  hoveredMenuId: string | null;
  tooltipMessage: string | null;
  tooltipPosition: { x: number; y: number } | null;
  tooltipLevel: number | null;

  // Methods
  getCurrentTopLevel: () => number;
  setActiveMainMenu: (menu: MainMenuType | null) => void;
  setActiveSubMenu: (menu: string | null) => void;
  setActiveThirdMenu: (menu: string | null) => void;
  setRightPanelOpen: (open: boolean) => void;
  // Switch to lv1 menu with restoring last lv2 selection (for Shift+key)
  switchToMainMenuWithMemory: (menu: MainMenuType) => void;
  showTooltip: (
    menuId: string,
    message: string,
    position: { x: number; y: number },
    buttonLevel: number
  ) => void;
  hideTooltip: () => void;
}

export const useMenuStore = create<MenuState>((set, get) => ({
  // Initial state
  activeMainMenu: null,
  activeSubMenu: null,
  activeThirdMenu: null,
  rightPanelOpen: false,

  // Remember last selected lv2 menu for each lv1 menu
  lastSubMenuByMainMenu: {},

  // Tooltip state
  hoveredMenuId: null,
  tooltipMessage: null,
  tooltipPosition: null,
  tooltipLevel: null,

  // Calculate current top level
  getCurrentTopLevel: () => {
    const { activeSubMenu, activeThirdMenu } = get();

    if (activeThirdMenu) return 3;
    if (activeSubMenu) return 2;
    return 1;
  },

  // Set main menu (bottom menu)
  setActiveMainMenu: (menu: MainMenuType | null) => {
    const { activeMainMenu, activeSubMenu, lastSubMenuByMainMenu } = get();

    // Save current lv2 selection before switching
    const newLastSubMenuByMainMenu = { ...lastSubMenuByMainMenu };
    if (activeMainMenu && activeSubMenu) {
      newLastSubMenuByMainMenu[activeMainMenu] = activeSubMenu;
    }

    set({
      activeMainMenu: menu,
      // Reset sub menus when main menu changes
      activeSubMenu: null,
      activeThirdMenu: null,
      lastSubMenuByMainMenu: newLastSubMenuByMainMenu,
      // Hide tooltip
      hoveredMenuId: null,
      tooltipMessage: null,
      tooltipPosition: null,
      tooltipLevel: null,
    });
  },

  // Set sub menu (appears when main menu is clicked)
  setActiveSubMenu: (menu: string | null) => {
    const { activeMainMenu, lastSubMenuByMainMenu } = get();

    // Save lv2 selection for current lv1 menu
    const newLastSubMenuByMainMenu = { ...lastSubMenuByMainMenu };
    if (activeMainMenu && menu) {
      newLastSubMenuByMainMenu[activeMainMenu] = menu;
    }

    set({
      activeSubMenu: menu,
      // Reset third level menu when sub menu changes
      activeThirdMenu: null,
      lastSubMenuByMainMenu: newLastSubMenuByMainMenu,
      // Hide tooltip
      hoveredMenuId: null,
      tooltipMessage: null,
      tooltipPosition: null,
      tooltipLevel: null,
    });
  },

  // Switch to main menu and restore last lv2 selection (for Shift+key)
  switchToMainMenuWithMemory: (menu: MainMenuType) => {
    const { activeMainMenu, activeSubMenu, lastSubMenuByMainMenu } = get();

    // Save current lv2 selection before switching
    const newLastSubMenuByMainMenu = { ...lastSubMenuByMainMenu };
    if (activeMainMenu && activeSubMenu) {
      newLastSubMenuByMainMenu[activeMainMenu] = activeSubMenu;
    }

    // Get last lv2 selection for target menu
    const lastSubMenu = newLastSubMenuByMainMenu[menu] || null;

    set({
      activeMainMenu: menu,
      activeSubMenu: lastSubMenu,
      activeThirdMenu: null,
      lastSubMenuByMainMenu: newLastSubMenuByMainMenu,
      // Hide tooltip
      hoveredMenuId: null,
      tooltipMessage: null,
      tooltipPosition: null,
      tooltipLevel: null,
    });
  },

  // 3단계 메뉴 설정
  setActiveThirdMenu: (menu: string | null) => {
    set({
      activeThirdMenu: menu,
      // 툴팁 숨김
      hoveredMenuId: null,
      tooltipMessage: null,
      tooltipPosition: null,
      tooltipLevel: null,
    });
  },

  setRightPanelOpen: (open: boolean) => {
    set({ rightPanelOpen: open });
  },

  // 툴팁 관련
  showTooltip: (
    menuId: string,
    message: string,
    position: { x: number; y: number },
    buttonLevel: number
  ) => {
    // 항상 툴팁 표시
    set({
      hoveredMenuId: menuId,
      tooltipMessage: message,
      tooltipPosition: position,
      tooltipLevel: buttonLevel,
    });
  },

  hideTooltip: () => {
    set({
      hoveredMenuId: null,
      tooltipMessage: null,
      tooltipPosition: null,
      tooltipLevel: null,
    });
  },
}));
