// components/react/menu/MenuContainer.tsx
import React, { useEffect } from "react";
import MenuLevel1 from "./MenuLevel1";
import RightPanel from "./RightPanel";
import MenuLevel2 from "./MenuLevel2";
import MenuLevel3 from "./MenuLevel3";

import VehicleTest from "../../test/VehicleTest/VehicleTest";
import TransportScheduleModal from "./panels/TransportScheduleModal";
import { useMenuStore } from "@/store/ui/menuStore";
import { useMqttStore } from "@/store/system/mqttStore";
import { MenuTooltip } from "./MenuTooltip";
import MqttStatusIndicator from "../system/MqttStatusIndicator";
import LogIndicator from "../system/LogIndicator";

const MenuContainer: React.FC = () => {
  const { activeMainMenu, activeSubMenu, rightPanelOpen, setActiveSubMenu } = useMenuStore();
  const { loadConfig } = useMqttStore();

  // Load MQTT config on mount and auto-connect
  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  return (
    <>
      {/* MQTT Status Indicator - Top Left */}
      <MqttStatusIndicator />

      {/* Log Indicator - Top Right */}
      <LogIndicator />

      {/* Top area - empty for now */}
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 30,
          height: 80,
        }}
      >
        {/* Add other components here if needed */}
      </div>

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
            top: 110,
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
    </>
  );
};

export default MenuContainer;
