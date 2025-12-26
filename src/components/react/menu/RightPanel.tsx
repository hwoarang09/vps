// components/react/menu/RightPanel.tsx
import React from "react";
import { useMenuStore } from "@/store/ui/menuStore";
import IndividualControlPanel from "./panels/IndividualControlPanel";

const RightPanel: React.FC = () => {
  const { activeMainMenu, activeSubMenu, setRightPanelOpen } = useMenuStore();

  const handleClose = () => {
    setRightPanelOpen(false);
  };

  const renderContent = () => {
    if (!activeMainMenu || !activeSubMenu) {
      return <div className="text-gray-500">Select a menu to view details</div>;
    }

    // MapBuilder의 경우 부품 목록 표시
    if (activeMainMenu === "MapBuilder") {
      return (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-gray-800">
            {getMenuLabel(activeSubMenu)} Components
          </h3>

          {activeSubMenu === "map-menu-1" && (
            <div className="space-y-3">
              <div className="border border-gray-300 rounded p-3 hover:bg-gray-50 cursor-pointer">
                <div className="font-medium">Straight Rail 1m</div>
                <div className="text-sm text-gray-500">
                  Standard straight track piece
                </div>
              </div>
              <div className="border border-gray-300 rounded p-3 hover:bg-gray-50 cursor-pointer">
                <div className="font-medium">Straight Rail 5m</div>
                <div className="text-sm text-gray-500">
                  Medium straight track piece
                </div>
              </div>
              <div className="border border-gray-300 rounded p-3 hover:bg-gray-50 cursor-pointer">
                <div className="font-medium">Straight Rail 10m</div>
                <div className="text-sm text-gray-500">
                  Long straight track piece
                </div>
              </div>
            </div>
          )}

          {activeSubMenu === "map-menu-2" && (
            <div className="space-y-3">
              <div className="border border-gray-300 rounded p-3 hover:bg-gray-50 cursor-pointer">
                <div className="font-medium">Curved Rail 15°</div>
                <div className="text-sm text-gray-500">Radius: 50m</div>
              </div>
              <div className="border border-gray-300 rounded p-3 hover:bg-gray-50 cursor-pointer">
                <div className="font-medium">Curved Rail 30°</div>
                <div className="text-sm text-gray-500">Radius: 25m</div>
              </div>
              <div className="border border-gray-300 rounded p-3 hover:bg-gray-50 cursor-pointer">
                <div className="font-medium">Curved Rail 45°</div>
                <div className="text-sm text-gray-500">Radius: 20m</div>
              </div>
            </div>
          )}

          {activeSubMenu === "map-menu-3" && (
            <div className="space-y-3">
              <div className="border border-gray-300 rounded p-3 hover:bg-gray-50 cursor-pointer">
                <div className="font-medium">Y-Junction</div>
                <div className="text-sm text-gray-500">
                  Left/Right 15° branching
                </div>
              </div>
              <div className="border border-gray-300 rounded p-3 hover:bg-gray-50 cursor-pointer">
                <div className="font-medium">T-Junction</div>
                <div className="text-sm text-gray-500">
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
              <div className="border border-gray-300 rounded p-3 hover:bg-gray-50 cursor-pointer">
                <div className="font-medium">Component 1</div>
                <div className="text-sm text-gray-500">
                  Sample component for {getMenuLabel(activeSubMenu)}
                </div>
              </div>
              <div className="border border-gray-300 rounded p-3 hover:bg-gray-50 cursor-pointer">
                <div className="font-medium">Component 2</div>
                <div className="text-sm text-gray-500">
                  Another component option
                </div>
              </div>
            </div>
          )}
        </div>
      );
    }

    // Vehicle Individual Control
    if (activeSubMenu === "vehicle-menu-individual") {
      return (
        <div className="h-full flex flex-col">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">
            Individual Control
          </h3>
          <IndividualControlPanel />
        </div>
      );
    }

    // 다른 메뉴들의 경우
    return (
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-gray-800">
          {getMenuLabel(activeSubMenu)}
        </h3>
        <div className="text-gray-600">
          Current selection: {activeMainMenu} → {activeSubMenu}
        </div>
        <div className="space-y-2 text-sm text-gray-500">
          <p>
            This panel will show detailed content for{" "}
            {getMenuLabel(activeSubMenu)}.
          </p>
          <p>Charts, settings, and data will be displayed here.</p>
        </div>

        {/* 샘플 콘텐츠 */}
        <div className="border border-gray-200 rounded p-4 bg-gray-50">
          <h4 className="font-medium mb-2">Sample Content</h4>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span>Item 1:</span>
              <span className="font-mono">Value 1</span>
            </div>
            <div className="flex justify-between">
              <span>Item 2:</span>
              <span className="font-mono">Value 2</span>
            </div>
            <div className="flex justify-between">
              <span>Item 3:</span>
              <span className="font-mono">Value 3</span>
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
      "vehicle-menu-individual": "Individual Control",
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
    };
    return labels[menuId] || menuId;
  };

  return (
    <div className="bg-white border-l border-gray-300 h-full flex flex-col shadow-lg">
      {/* 헤더 */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-800">Detail Panel</h2>
        <button
          onClick={handleClose}
          className="text-gray-500 hover:text-gray-700 text-xl"
        >
          ×
        </button>
      </div>

      {/* 내용 */}
      <div className="flex-1 p-4 overflow-y-auto">{renderContent()}</div>

      {/* 푸터 */}
      <div className="p-4 border-t border-gray-200 bg-gray-50">
        <div className="flex space-x-2">
          <button className="flex-1 bg-blue-600 text-white py-2 px-4 rounded hover:bg-blue-700">
            Apply
          </button>
          <button className="flex-1 bg-gray-300 text-gray-700 py-2 px-4 rounded hover:bg-gray-400">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

export default RightPanel;
