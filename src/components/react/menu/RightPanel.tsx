// components/react/menu/RightPanel.tsx
import React, { useEffect } from "react";
import { Radio } from "lucide-react";
import { useMenuStore } from "@/store/ui/menuStore";
import { useShmSimulatorStore } from "@/store/vehicle/shmMode/shmSimulatorStore";
import { useVehicleArrayStore } from "@/store/vehicle/arrayMode/vehicleStore";
import { useCameraStore } from "@/store/ui/cameraStore";
import { useVehicleControlStore } from "@/store/ui/vehicleControlStore";
import LockInfoPanel from "./panels/LockInfoPanel";
import EdgeControlPanel from "./panels/EdgeControlPanel";
import IndividualControlPanel from "./panels/IndividualControlPanel";
import {
  panelContainerVariants,
  panelHeaderVariants,
  panelTitleVariants,
  panelContentVariants,
  panelCloseButtonClass,
  panelBadgeVariants,
  panelCardVariants,
  panelTextVariants,
} from "./shared/panelStyles";

const RightPanel: React.FC = () => {
  const { activeMainMenu, activeSubMenu, setRightPanelOpen } = useMenuStore();
  const stopFollowingVehicle = useCameraStore((s) => s.stopFollowingVehicle);
  const closeVehiclePanel = useVehicleControlStore((s) => s.closePanel);

  // Mode detection for Lock Info panel
  const shmIsInitialized = useShmSimulatorStore((s) => s.isInitialized);
  const shmController = useShmSimulatorStore((s) => s.controller);
  const arrayNumVehicles = useVehicleArrayStore((s) => s.actualNumVehicles);

  const getSimMode = () => {
    if (shmIsInitialized && shmController) return "SHM";
    if (arrayNumVehicles > 0) return "ARRAY";
    return null;
  };
  const simMode = getSimMode();

  // Stop camera following when leaving Vehicle Search menu
  useEffect(() => {
    if (activeSubMenu !== "search-vehicle") {
      stopFollowingVehicle();
      closeVehiclePanel();
    }
  }, [activeSubMenu, stopFollowingVehicle, closeVehiclePanel]);

  const handleClose = () => {
    setRightPanelOpen(false);
  };

  const renderContent = () => {
    if (!activeMainMenu || !activeSubMenu) {
      return (
        <div className={panelTextVariants({ variant: "muted" })}>
          Select a menu to view details
        </div>
      );
    }

    // MapBuilder의 경우 부품 목록 표시
    if (activeMainMenu === "MapBuilder") {
      return (
        <div className="space-y-4">
          <h3 className={panelTitleVariants({ size: "lg", color: "orange" })}>
            {getMenuLabel(activeSubMenu)} Components
          </h3>

          {activeSubMenu === "map-menu-1" && (
            <div className="space-y-3">
              <div className={panelCardVariants({ variant: "interactive" })}>
                <div className="font-medium text-white">Straight Rail 1m</div>
                <div className={panelTextVariants({ variant: "muted", size: "sm" })}>
                  Standard straight track piece
                </div>
              </div>
              <div className={panelCardVariants({ variant: "interactive" })}>
                <div className="font-medium text-white">Straight Rail 5m</div>
                <div className={panelTextVariants({ variant: "muted", size: "sm" })}>
                  Medium straight track piece
                </div>
              </div>
              <div className={panelCardVariants({ variant: "interactive" })}>
                <div className="font-medium text-white">Straight Rail 10m</div>
                <div className={panelTextVariants({ variant: "muted", size: "sm" })}>
                  Long straight track piece
                </div>
              </div>
            </div>
          )}

          {activeSubMenu === "map-menu-2" && (
            <div className="space-y-3">
              <div className={panelCardVariants({ variant: "interactive" })}>
                <div className="font-medium text-white">Curved Rail 15°</div>
                <div className={panelTextVariants({ variant: "muted", size: "sm" })}>
                  Radius: 50m
                </div>
              </div>
              <div className={panelCardVariants({ variant: "interactive" })}>
                <div className="font-medium text-white">Curved Rail 30°</div>
                <div className={panelTextVariants({ variant: "muted", size: "sm" })}>
                  Radius: 25m
                </div>
              </div>
              <div className={panelCardVariants({ variant: "interactive" })}>
                <div className="font-medium text-white">Curved Rail 45°</div>
                <div className={panelTextVariants({ variant: "muted", size: "sm" })}>
                  Radius: 20m
                </div>
              </div>
            </div>
          )}

          {activeSubMenu === "map-menu-3" && (
            <div className="space-y-3">
              <div className={panelCardVariants({ variant: "interactive" })}>
                <div className="font-medium text-white">Y-Junction</div>
                <div className={panelTextVariants({ variant: "muted", size: "sm" })}>
                  Left/Right 15° branching
                </div>
              </div>
              <div className={panelCardVariants({ variant: "interactive" })}>
                <div className="font-medium text-white">T-Junction</div>
                <div className={panelTextVariants({ variant: "muted", size: "sm" })}>
                  Right angle branching
                </div>
              </div>
            </div>
          )}

          {/* 다른 MapBuilder 메뉴들 */}
          {!["map-menu-1", "map-menu-2", "map-menu-3"].includes(
            activeSubMenu
          ) && (
            <div className="space-y-3">
              <div className={panelCardVariants({ variant: "interactive" })}>
                <div className="font-medium text-white">Component 1</div>
                <div className={panelTextVariants({ variant: "muted", size: "sm" })}>
                  Sample component for {getMenuLabel(activeSubMenu)}
                </div>
              </div>
              <div className={panelCardVariants({ variant: "interactive" })}>
                <div className="font-medium text-white">Component 2</div>
                <div className={panelTextVariants({ variant: "muted", size: "sm" })}>
                  Another component option
                </div>
              </div>
            </div>
          )}
        </div>
      );
    }

    // DevTools Lock Panel
    if (activeSubMenu === "devtools-lock") {
      return <LockInfoPanel />;
    }

    // Search Vehicle Panel
    if (activeSubMenu === "search-vehicle") {
      return <IndividualControlPanel />;
    }

    // Search Edge Panel
    if (activeSubMenu === "search-edge") {
      return <EdgeControlPanel />;
    }

    // 다른 메뉴들의 경우
    return (
      <div className="space-y-4">
        <h3 className={panelTitleVariants({ size: "lg", color: "orange" })}>
          {getMenuLabel(activeSubMenu)}
        </h3>
        <div className={panelTextVariants({ variant: "body" })}>
          Current selection: {activeMainMenu} → {activeSubMenu}
        </div>
        <div className="space-y-2">
          <p className={panelTextVariants({ variant: "muted", size: "sm" })}>
            This panel will show detailed content for{" "}
            {getMenuLabel(activeSubMenu)}.
          </p>
          <p className={panelTextVariants({ variant: "muted", size: "sm" })}>
            Charts, settings, and data will be displayed here.
          </p>
        </div>

        {/* 샘플 콘텐츠 */}
        <div className={panelCardVariants({ variant: "default", padding: "md" })}>
          <h4 className="font-medium text-white mb-2">Sample Content</h4>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className={panelTextVariants({ variant: "body" })}>Item 1:</span>
              <span className="font-mono text-accent-orange">Value 1</span>
            </div>
            <div className="flex justify-between">
              <span className={panelTextVariants({ variant: "body" })}>Item 2:</span>
              <span className="font-mono text-accent-orange">Value 2</span>
            </div>
            <div className="flex justify-between">
              <span className={panelTextVariants({ variant: "body" })}>Item 3:</span>
              <span className="font-mono text-accent-orange">Value 3</span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const getMenuLabel = (menuId: string): string => {
    const labels: Record<string, string> = {
      // Statistics
      "stats-menu-1": "Realtime Stats",
      "stats-menu-2": "Daily Report",
      "stats-menu-3": "Weekly Report",
      "stats-menu-4": "Monthly Report",
      "stats-menu-5": "Performance Analysis",
      // Vehicle
      "vehicle-menu-overall": "Overall Status",
      "vehicle-menu-history": "Vehicle History",
      // Operation
      "operation-menu-1": "Route Management",
      "operation-menu-2": "Schedule Control",
      "operation-menu-3": "Live Monitoring",
      "operation-menu-4": "Alert System",
      "operation-menu-5": "Operation Logs",
      // MapBuilder
      "map-menu-1": "Straight Rails",
      "map-menu-2": "Curved Rails",
      "map-menu-3": "Junction Parts",
      "map-menu-4": "Special Components",
      "map-menu-5": "Connection Tools",
      // DevTools
      "devtools-lock": "Lock Info",
      // Search
      "search-vehicle": "Vehicle Search",
      "search-node": "Node Search",
      "search-edge": "Edge Search",
      "search-station": "Station Search",
    };
    return labels[menuId] || menuId;
  };

  // Get panel title based on active menu
  const getPanelTitle = () => {
    if (activeSubMenu === "devtools-lock") return "Lock Info";
    if (activeSubMenu === "search-vehicle") return "Vehicle Search";
    if (activeSubMenu === "search-edge") return "Edge Search";
    if (activeSubMenu) return getMenuLabel(activeSubMenu);
    return "Detail Panel";
  };

  return (
    <div className={panelContainerVariants({ position: "right" })}>
      {/* 헤더 */}
      <div className={panelHeaderVariants({ size: "md" })}>
        <div className="flex items-center space-x-3">
          <h2 className={panelTitleVariants({ size: "md", color: "white" })}>
            {getPanelTitle()}
          </h2>
          {activeSubMenu === "devtools-lock" && simMode && (
            <div className="flex items-center space-x-2">
              <span className={panelBadgeVariants({ variant: "default" })}>
                {simMode}
              </span>
              <span className={`flex items-center ${panelBadgeVariants({ variant: "success" })}`}>
                <Radio size={12} className="mr-1 animate-pulse" />
                Live
              </span>
            </div>
          )}
        </div>
        <button
          onClick={handleClose}
          className={panelCloseButtonClass}
        >
          ×
        </button>
      </div>

      {/* 내용 */}
      <div className={panelContentVariants({ padding: "md" })}>
        {renderContent()}
      </div>
    </div>
  );
};

export default RightPanel;
