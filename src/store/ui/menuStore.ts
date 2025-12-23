// store/menuStore.ts (최종 버전)
import { create } from "zustand";
import { MainMenuType } from "@/types";

export interface MenuState {
  // 메뉴 계층 구조에 맞는 명확한 네이밍
  activeMainMenu: MainMenuType | null; // 화면 하단의 메인 메뉴
  activeSubMenu: string | null; // 메인 메뉴 클릭시 나타나는 서브 메뉴
  activeThirdMenu: string | null; // 3단계 메뉴 (필요시)
  rightPanelOpen: boolean;

  // 툴팁 관련 상태
  hoveredMenuId: string | null;
  tooltipMessage: string | null;
  tooltipPosition: { x: number; y: number } | null;
  tooltipLevel: number | null;

  // 메소드들
  getCurrentTopLevel: () => number;
  setActiveMainMenu: (menu: MainMenuType | null) => void;
  setActiveSubMenu: (menu: string | null) => void;
  setActiveThirdMenu: (menu: string | null) => void;
  setRightPanelOpen: (open: boolean) => void;
  showTooltip: (
    menuId: string,
    message: string,
    position: { x: number; y: number },
    buttonLevel: number
  ) => void;
  hideTooltip: () => void;
}

export const useMenuStore = create<MenuState>((set, get) => ({
  // 상태 초기값
  activeMainMenu: "Test",
  activeSubMenu: "test-rapier-dict",
  activeThirdMenu: null,
  rightPanelOpen: false,

  // 툴팁 상태
  hoveredMenuId: null,
  tooltipMessage: null,
  tooltipPosition: null,
  tooltipLevel: null,

  // 현재 최상단 레벨 계산
  getCurrentTopLevel: () => {
    const { activeSubMenu, activeThirdMenu } = get();

    if (activeThirdMenu) return 3; // 3단계 메뉴가 활성화된 경우
    if (activeSubMenu) return 2; // 서브 메뉴가 활성화된 경우
    return 1; // 기본 상태 (메인 메뉴 레벨)
  },

  // 메인 메뉴 설정 (화면 하단의 메뉴)
  setActiveMainMenu: (menu: MainMenuType | null) => {
    set({
      activeMainMenu: menu,
      // 메인 메뉴 변경시 하위 메뉴들 초기화
      activeSubMenu: null,
      activeThirdMenu: null,
      // 툴팁 숨김
      hoveredMenuId: null,
      tooltipMessage: null,
      tooltipPosition: null,
      tooltipLevel: null,
    });
  },

  // 서브 메뉴 설정 (메인 메뉴 클릭시 나타나는 메뉴)
  setActiveSubMenu: (menu: string | null) => {
    set({
      activeSubMenu: menu,
      // 서브 메뉴 변경시 3단계 메뉴 초기화
      activeThirdMenu: null,
      // 툴팁 숨김
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
