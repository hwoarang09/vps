// components/react/menu/MenuContainer.tsx
import React, { useEffect } from "react";
import MenuLevel1 from "./MenuLevel1";
import RightPanel from "./RightPanel";
import MenuLevel2 from "./MenuLevel2";
import MapLoader from "../MapLoader/MapLoader";
import ConfigDataPanel from "../DataPanel/DataPanel";
import VehicleTest from "../../test/VehicleTest/VehicleTest";
import { useMenuStore } from "@/store/ui/menuStore";
import { useMqttStore } from "@/store/system/mqttStore";
import { MenuTooltip } from "./MenuTooltip";
import MqttStatusIndicator from "../system/MqttStatusIndicator";

const MenuContainer: React.FC = () => {
  const { activeMainMenu, rightPanelOpen } = useMenuStore();
  const { loadConfig } = useMqttStore();

  // Load MQTT config on mount (no auto-connect)
  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  return (
    <>
      {/* MQTT Status Indicator - Top Left */}
      <MqttStatusIndicator />

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

      {/* Right Panel - Consider top/bottom menu heights */}
      {rightPanelOpen && (
        <div
          style={{
            position: "fixed",
            top: 80,
            right: 0,
            bottom: 140, // Extra space for bottom menu
            width: 320,
            zIndex: 20,
          }}
        >
          <RightPanel />
        </div>
      )}

      {/* Config Data Panel - Show only when DataPanel menu is active */}
      {activeMainMenu === "DataPanel" && <ConfigDataPanel />}

      {/* Menu Tooltip - Always rendered */}
      <MenuTooltip />

      {/* Map Loader - Map loading functionality */}
      <MapLoader />

      {/* Vehicle Test - Performance testing functionality */}
      <VehicleTest />
    </>
  );
};

export default MenuContainer;
