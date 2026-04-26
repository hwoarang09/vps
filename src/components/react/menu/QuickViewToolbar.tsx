// components/react/menu/QuickViewToolbar.tsx
// TODO: vis-heatmap, vis-traffic-flow, vis-deadlock-zone are not yet wired in
// visualizationStore. When implemented, add corresponding toggle buttons here.

import React from "react";
import { Activity, Radar, Tag } from "lucide-react";
import { useVisualizationStore } from "@store/ui/visualizationStore";
import { useMenuStore } from "@/store/ui/menuStore";
import { menuButtonVariants, menuContainerVariants } from "./shared/menuStyles";
import { twMerge } from "tailwind-merge";

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

  const handleMouseEnter = (e: React.MouseEvent, item: ToggleItem) => {
    const rect = e.currentTarget.getBoundingClientRect();
    showTooltip(item.id, item.tooltip, { x: rect.left - 8, y: rect.top + rect.height / 2 }, 2);
  };

  return (
    <div
      className={twMerge(
        menuContainerVariants({ level: 2 }),
        "fixed top-[4.5rem] right-4 z-50 flex-col items-center gap-2 p-2 space-x-0",
      )}
    >
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
            onMouseEnter={(e) => handleMouseEnter(e, item)}
            onMouseLeave={hideTooltip}
          >
            {item.icon}
          </button>
        );
      })}
    </div>
  );
};

export default QuickViewToolbar;
