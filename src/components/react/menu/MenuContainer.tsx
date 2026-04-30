// components/react/menu/MenuContainer.tsx
import React, { useEffect, useState } from "react";
import MenuLevel1 from "./MenuLevel1";
import RightPanel from "./RightPanel";
import MenuLevel2 from "./MenuLevel2";
import MenuLevel3 from "./MenuLevel3";

import VehicleTest from "../../test/VehicleTest/VehicleTest";
import TransportScheduleModal from "./panels/TransportScheduleModal";
import FabStatsPanel from "./panels/FabStatsPanel";
import DataPanel from "../DataPanel/DataPanel";
import { useMenuStore } from "@/store/ui/menuStore";
import { useMqttStore } from "@/store/system/mqttStore";
import { MenuTooltip } from "./MenuTooltip";
import QuickViewToolbar from "./QuickViewToolbar";
import KpiHud from "./KpiHud";
import CommandPalette from "./CommandPalette";

const MenuContainer: React.FC = () => {
  const { activeMainMenu, activeSubMenu, rightPanelOpen, setActiveSubMenu } = useMenuStore();
  const { loadConfig } = useMqttStore();
  const [showDataPanel, setShowDataPanel] = useState(false);
  const [showFabStats, setShowFabStats] = useState(false);

  // Load MQTT config on mount and auto-connect
  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  // stats-realtime 메뉴 클릭 시 FabStats 플로팅 토글
  useEffect(() => {
    if (activeSubMenu === "stats-realtime") {
      setShowFabStats(prev => !prev);
      setActiveSubMenu(null);
    }
  }, [activeSubMenu, setActiveSubMenu]);

  // stats-db 메뉴 클릭 시 DataPanel 토글 (독립 state)
  // DataPanel 열릴 때 RightPanel(Vehicle Search)도 함께 열기
  useEffect(() => {
    if (activeSubMenu === "stats-db") {
      setShowDataPanel(prev => {
        const willOpen = !prev;
        if (willOpen) {
          // Vehicle Search 패널도 함께 열기 — 약간 딜레이 (null 리셋 이후)
          setTimeout(() => {
            const store = useMenuStore.getState();
            store.setActiveMainMenu("Search");
            store.setActiveSubMenu("search-vehicle");
            store.setRightPanelOpen(true);
          }, 0);
        }
        return willOpen;
      });
      setActiveSubMenu(null); // 메뉴 상태는 즉시 해제
    }
  }, [activeSubMenu, setActiveSubMenu]);

  return (
    <>
      {/* Quick View Toolbar + SimLog - Top Right, horizontal */}
      <QuickViewToolbar />

      {/* KPI HUD - Top Left, below MqttStatusIndicator */}
      <KpiHud />

      {/* Level 1 Menu (Bottom) */}
      <MenuLevel1 />

      {/* Level 2 Menu - Show when Level 1 menu is active */}
      {activeMainMenu && <MenuLevel2 />}

      {/* Level 3 Menu - Show when Level 2 has sub-items */}
      {activeMainMenu && <MenuLevel3 />}

      {/* Right Panel - Consider top/bottom menu heights */}
      {rightPanelOpen && (
        <div
          style={{
            position: "fixed",
            top: 70,
            right: 10,
            bottom: 140, // Extra space for bottom menu
            width: 320,
            zIndex: 20,
          }}
        >
          <RightPanel />
        </div>
      )}


      {/* Menu Tooltip - Always rendered */}
      <MenuTooltip />

      {/* Vehicle Test - Performance testing functionality */}
      <VehicleTest />

      {/* Transport Schedule Modal - 중앙 대형 모달 */}
      {activeSubMenu === "operation-menu-2" && (
        <TransportScheduleModal
          onClose={() => setActiveSubMenu(null)}
        />
      )}

      {/* Fab Stats - 중앙 플로팅 패널 (ESC로만 닫힘) */}
      {showFabStats && (
        <FabStatsPanel onClose={() => setShowFabStats(false)} />
      )}

      {/* DB History - 왼쪽 사이드 패널 (ESC로만 닫힘) */}
      {showDataPanel && (
        <DataPanel onClose={() => setShowDataPanel(false)} />
      )}

      {/* Command Palette - Cmd+K / Ctrl+K */}
      <CommandPalette />
    </>
  );
};

export default MenuContainer;
