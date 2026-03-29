// panels/OperationMapPanel.tsx
// Operation > Layout — 맵 레이아웃 선택 및 로드

import React from "react";
import { useVehicleTestStore } from "@store/vehicle/vehicleTestStore";
import { getTestSettings } from "@/config/react/testSettingConfig";
import {
  panelTitleVariants,
  panelCardVariants,
  panelTextVariants,
} from "../shared/panelStyles";

const OperationMapPanel: React.FC = () => {
  const { selectedSettingId, requestSettingChange } = useVehicleTestStore();
  const testSettings = getTestSettings();

  return (
    <div className="space-y-4">
      <h3 className={panelTitleVariants({ size: "lg", color: "cyan" })}>
        Layout
      </h3>
      <p className={panelTextVariants({ variant: "muted", size: "sm" })}>
        레이아웃 선택 (맵 + 차량 자동 로드)
      </p>
      <div className="space-y-2">
        {testSettings.map((setting) => (
          <button
            key={setting.id}
            onClick={() => requestSettingChange(setting.id)}
            className={panelCardVariants({
              variant: selectedSettingId === setting.id ? "glow-cyan" : "interactive",
            })}
            style={{ width: "100%", textAlign: "left", cursor: "pointer" }}
          >
            <div className="flex justify-between items-center">
              <div>
                <div className="font-medium text-white text-xs">{setting.name}</div>
                <div className={panelTextVariants({ variant: "muted", size: "sm" })}>
                  {setting.description}
                </div>
              </div>
              <div className="text-right ml-2">
                <div className="text-accent-cyan text-[10px] font-mono">{setting.mapName}</div>
                <div className="text-gray-500 text-[10px]">{setting.numVehicles}V</div>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

export default OperationMapPanel;
