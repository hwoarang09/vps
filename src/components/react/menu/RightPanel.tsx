// components/react/menu/RightPanel.tsx
import React, { useEffect } from "react";
import { twMerge } from "tailwind-merge";
import { Radio } from "lucide-react";
import { useMenuStore } from "@/store/ui/menuStore";
import { useShmSimulatorStore } from "@/store/vehicle/shmMode/shmSimulatorStore";
import { useVehicleArrayStore } from "@/store/vehicle/arrayMode/vehicleStore";
import { useCameraStore } from "@/store/ui/cameraStore";
import { useVehicleControlStore } from "@/store/ui/vehicleControlStore";
import { useVisualizationStore } from "@/store/ui/visualizationStore";
import LockInfoPanel from "./panels/LockInfoPanel";
import EdgeControlPanel from "./panels/EdgeControlPanel";
import IndividualControlPanel from "./panels/IndividualControlPanel";
import OperationMapPanel from "./panels/OperationMapPanel";
import MovementParamsPanel from "./panels/params/MovementParamsPanel";
import LockParamsPanel from "./panels/params/LockParamsPanel";
import RoutingParamsPanel from "./panels/params/RoutingParamsPanel";
import ModeParamsPanel from "./panels/params/ModeParamsPanel";
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
  const { activeMainMenu, activeSubMenu, activeThirdMenu, setRightPanelOpen } = useMenuStore();
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

    // Visualization Performance Panel
    if (activeSubMenu === "vis-performance") {
      return <PerformanceTogglePanel />;
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

    // Params panels (lv3)
    if (activeThirdMenu === "params-movement") return <MovementParamsPanel />;
    if (activeThirdMenu === "params-lock") return <LockParamsPanel />;
    if (activeThirdMenu === "params-routing") return <RoutingParamsPanel />;
    if (activeThirdMenu === "params-mode") return <ModeParamsPanel />;

    // Operation Map/CFG Panel
    if (activeSubMenu === "operation-menu-6") {
      return <OperationMapPanel />;
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
      "stats-menu-2": "Statistics Report",
      "stats-menu-5": "Performance Analysis",
      // Operation
      "operation-menu-1": "Route Management",
      "operation-menu-2": "Schedule Control",
      "operation-menu-3": "Live Monitoring",
      "operation-menu-4": "Alert System",
      "operation-menu-5": "Operation Logs",
      "operation-menu-6": "Layout Load",
      "operation-menu-7": "Transfer Mode",
      "operation-menu-8": "Sim Parameters",
      // MapBuilder
      "map-menu-1": "Straight Rails",
      "map-menu-2": "Curved Rails",
      "map-menu-3": "Junction Parts",
      "map-menu-4": "Special Components",
      "map-menu-5": "Connection Tools",
      // Visualization
      "vis-performance": "Performance Monitor",
      "vis-bay-label": "Bay Label",
      "vis-heatmap": "Heatmap",
      "vis-traffic-flow": "Traffic Flow",
      "vis-deadlock-zone": "Deadlock Zone",
      // Statistics
      "stats-realtime": "Fab Stats",
      "stats-db": "DB History",
      // DevTools
      "devtools-lock": "Lock Info",
      // Search
      "search-vehicle": "Vehicle Search",
      "search-node": "Node Search",
      "search-edge": "Edge Search",
      "search-station": "Station Search",
      // Params (lv3)
      "params-movement": "Movement",
      "params-lock": "Lock",
      "params-routing": "Routing",
      "params-mode": "Mode",
    };
    return labels[menuId] || menuId;
  };

  // Get panel title based on active menu
  const getPanelTitle = () => {
    if (activeThirdMenu) return getMenuLabel(activeThirdMenu);
    if (activeSubMenu === "vis-performance") return "Performance Monitor";
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
      <div className={twMerge(
        panelContentVariants({ padding: "md" }),
        activeSubMenu === "search-vehicle" && "overflow-hidden"
      )}>
        {renderContent()}
      </div>
    </div>
  );
};

/**
 * Performance Monitor 토글 패널
 */
const PerformanceTogglePanel: React.FC = () => {
  const { showPerfLeft, showPerfRight, togglePerfLeft, togglePerfRight } =
    useVisualizationStore();

  const toggleStyle: React.CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "10px 12px",
    borderRadius: "6px",
    backgroundColor: "rgba(255,255,255,0.05)",
    cursor: "pointer",
    userSelect: "none",
  };

  const dotStyle = (on: boolean): React.CSSProperties => ({
    width: 10,
    height: 10,
    borderRadius: "50%",
    backgroundColor: on ? "#4ecdc4" : "#555",
    transition: "background-color 0.15s",
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <div style={toggleStyle} onClick={togglePerfLeft}>
        <span className="text-sm text-gray-200">Main / Worker Stats (좌측 상단)</span>
        <div style={dotStyle(showPerfLeft)} />
      </div>
      <div style={toggleStyle} onClick={togglePerfRight}>
        <span className="text-sm text-gray-200">r3f-perf GPU Stats (좌측 상단)</span>
        <div style={dotStyle(showPerfRight)} />
      </div>
    </div>
  );
};

export default RightPanel;
