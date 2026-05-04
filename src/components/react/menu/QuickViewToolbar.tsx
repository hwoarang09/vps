// components/react/menu/QuickViewToolbar.tsx
// TODO: vis-heatmap, vis-traffic-flow, vis-deadlock-zone are not yet wired in
// visualizationStore. When implemented, add corresponding toggle buttons here.

import React, { useEffect, useState } from "react";
import { Activity, Radar, Tag, Binary, Palette } from "lucide-react";
import { useVisualizationStore } from "@store/ui/visualizationStore";
import { useMenuStore } from "@/store/ui/menuStore";
import { useThemeStore } from "@store/ui/themeStore";
import { THEMES } from "@/config/threejs/themes";
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
  const activeMainMenu = useMenuStore((s) => s.activeMainMenu);
  const activeSubMenu = useMenuStore((s) => s.activeSubMenu);
  const [logOpen, setLogOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const themeName = useThemeStore((s) => s.themeName);
  const setTheme = useThemeStore((s) => s.setTheme);

  // 하단/서브 메뉴 상태가 바뀌면 드롭다운 강제 닫기
  useEffect(() => {
    setLogOpen(false);
    setThemeOpen(false);
  }, [activeMainMenu, activeSubMenu]);

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

      {/* Theme picker */}
      <div className="relative">
        <button
          onClick={() => setThemeOpen(!themeOpen)}
          onMouseEnter={(e) => handleMouseEnter(e, "theme", `Theme: ${THEMES[themeName]?.label ?? ""}`)}
          onMouseLeave={hideTooltip}
          className={twMerge(
            menuButtonVariants({ active: themeOpen }),
            "w-9 h-9 mx-0",
          )}
        >
          <Palette size={16} />
        </button>
        {themeOpen && (
          <div
            className="absolute top-12 right-0 min-w-[160px] rounded-md bg-zinc-800/95 border border-zinc-600 shadow-lg backdrop-blur overflow-hidden"
          >
            {Object.values(THEMES).map((t) => (
              <button
                key={t.name}
                onClick={() => {
                  setTheme(t.name);
                  setThemeOpen(false);
                }}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-zinc-700 ${
                  t.name === themeName ? "bg-zinc-700 text-white" : "text-zinc-200"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
      </div>

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
