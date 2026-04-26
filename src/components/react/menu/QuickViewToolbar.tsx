// components/react/menu/QuickViewToolbar.tsx
// TODO: vis-heatmap, vis-traffic-flow, vis-deadlock-zone are not yet wired in
// visualizationStore. When implemented, add corresponding toggle buttons here.

import React, { useState } from "react";
import { Activity, Radar, Tag, Binary } from "lucide-react";
import { useVisualizationStore } from "@store/ui/visualizationStore";
import { useMenuStore } from "@/store/ui/menuStore";
import { menuButtonVariants, menuContainerVariants } from "./shared/menuStyles";
import { twMerge } from "tailwind-merge";
import SimLogFileManager from "@/components/test/VehicleTest/SimLogFileManager";

interface ToggleItem {
  id: string;
  icon: React.ReactNode;
  tooltip: string;
  getActive: () => boolean;
  action: () => void;
}

const QuickViewToolbar: React.FC = () => {
  const {
    showPerfLeft, showSensorBox, showFabLabels,
    togglePerfLeft, togglePerfRight, toggleSensorBox, toggleFabLabels,
  } = useVisualizationStore();
  const { showTooltip, hideTooltip } = useMenuStore();
  const [logOpen, setLogOpen] = useState(false);

  const items: ToggleItem[] = [
    {
      id: "quick-perf",
      icon: <Activity size={16} />,
      tooltip: "Performance",
      getActive: () => showPerfLeft,
      action: () => { togglePerfLeft(); togglePerfRight(); },
    },
    {
      id: "quick-sensor",
      icon: <Radar size={16} />,
      tooltip: "Sensor Box",
      getActive: () => showSensorBox,
      action: () => { toggleSensorBox(); },
    },
    {
      id: "quick-fab-labels",
      icon: <Tag size={16} />,
      tooltip: "Fab Labels",
      getActive: () => showFabLabels,
      action: () => { toggleFabLabels(); },
    },
  ];

  const handleMouseEnter = (e: React.MouseEvent, id: string, tooltip: string) => {
    const rect = e.currentTarget.getBoundingClientRect();
    showTooltip(id, tooltip, { x: rect.left + rect.width / 2, y: rect.bottom + 4 }, 2);
  };

  return (
    <div
      className={twMerge(
        menuContainerVariants({ level: 2 }),
        "fixed top-4 right-4 z-50 flex-row items-center gap-1.5 p-1.5 space-x-0",
      )}
    >
      {/* Visualization toggles */}
      {items.map((item) => {
        const isActive = item.getActive();
        return (
          <button
            key={item.id}
            className={twMerge(
              menuButtonVariants({ active: isActive }),
              "w-9 h-9 mx-0",
            )}
            onClick={item.action}
            onMouseEnter={(e) => handleMouseEnter(e, item.id, item.tooltip)}
            onMouseLeave={hideTooltip}
          >
            {item.icon}
          </button>
        );
      })}

      {/* Divider */}
      <div className="w-px h-6 bg-gray-600/50" />

      {/* SimLog button (was LogIndicator) */}
      <div className="relative">
        <button
          onClick={() => setLogOpen(!logOpen)}
          onMouseEnter={(e) => handleMouseEnter(e, "simlogs", "SimLogger Files")}
          onMouseLeave={hideTooltip}
          className={twMerge(
            menuButtonVariants({ active: logOpen }),
            "w-9 h-9 mx-0",
          )}
        >
          <Binary size={16} className={logOpen ? "text-white" : "text-purple-400"} />
        </button>
        {logOpen && (
          <div className="absolute top-12" style={{ right: 0 }}>
            <SimLogFileManager isOpen={true} onToggle={() => setLogOpen(false)} hideButton={true} />
          </div>
        )}
      </div>
    </div>
  );
};

export default QuickViewToolbar;
