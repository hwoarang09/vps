// components/react/menu/QuickViewToolbar.tsx
// TODO: vis-heatmap, vis-traffic-flow, vis-deadlock-zone are not yet wired in
// visualizationStore. When implemented, add corresponding toggle buttons here.

import React, { useEffect, useRef, useState } from "react";
import { Activity, Radar, Tag, Binary, Palette, Check } from "lucide-react";
import { useVisualizationStore } from "@store/ui/visualizationStore";
import { useMenuStore } from "@/store/ui/menuStore";
import { useThemeStore } from "@store/ui/themeStore";
import { useSensorColorStore } from "@store/ui/sensorColorStore";
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

interface LabelOption {
  key: string;
  label: string;
  get: () => boolean;
  toggle: () => void;
}

const QuickViewToolbar: React.FC = () => {
  const {
    showPerfLeft, showSensorBox,
    showFabLabels, showNodeText, showEdgeText, showVehicleText, showStationText, showBayText,
    togglePerfLeft, togglePerfRight, toggleSensorBox,
    toggleFabLabels, toggleNodeText, toggleEdgeText, toggleVehicleText, toggleStationText, toggleBayText,
  } = useVisualizationStore();
  const { showTooltip, hideTooltip } = useMenuStore();
  const activeMainMenu = useMenuStore((s) => s.activeMainMenu);
  const activeSubMenu = useMenuStore((s) => s.activeSubMenu);
  // 한 번에 하나의 드롭다운만 열기
  type DropdownName = "log" | "theme" | "labels" | "sensor" | null;
  const [openDropdown, setOpenDropdown] = useState<DropdownName>(null);
  const toggleDropdown = (name: Exclude<DropdownName, null>) =>
    setOpenDropdown((prev) => (prev === name ? null : name));
  const toolbarRef = useRef<HTMLDivElement>(null);

  const logOpen = openDropdown === "log";
  const themeOpen = openDropdown === "theme";
  const labelOpen = openDropdown === "labels";
  const sensorOpen = openDropdown === "sensor";
  const themeName = useThemeStore((s) => s.themeName);
  const setTheme = useThemeStore((s) => s.setTheme);

  const bodyColor = useSensorColorStore((s) => s.bodyColor);
  const zone0Color = useSensorColorStore((s) => s.zone0Color);
  const zone1Color = useSensorColorStore((s) => s.zone1Color);
  const zone2Color = useSensorColorStore((s) => s.zone2Color);
  const setBodyColor = useSensorColorStore((s) => s.setBodyColor);
  const setZone0Color = useSensorColorStore((s) => s.setZone0Color);
  const setZone1Color = useSensorColorStore((s) => s.setZone1Color);
  const setZone2Color = useSensorColorStore((s) => s.setZone2Color);
  const resetSensorColors = useSensorColorStore((s) => s.reset);

  // 하단/서브 메뉴 상태가 바뀌면 드롭다운 강제 닫기
  useEffect(() => {
    setOpenDropdown(null);
  }, [activeMainMenu, activeSubMenu]);

  // 바깥 클릭 시 드롭다운 닫기
  useEffect(() => {
    if (!openDropdown) return;
    const handler = (e: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        setOpenDropdown(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openDropdown]);

  const labelOptions: LabelOption[] = [
    { key: "fab", label: "Fab Labels", get: () => showFabLabels, toggle: toggleFabLabels },
    { key: "node", label: "Node Text", get: () => showNodeText, toggle: toggleNodeText },
    { key: "edge", label: "Edge Text", get: () => showEdgeText, toggle: toggleEdgeText },
    { key: "vehicle", label: "Vehicle Text", get: () => showVehicleText, toggle: toggleVehicleText },
    { key: "bay", label: "Bay Labels", get: () => showBayText, toggle: toggleBayText },
    { key: "station", label: "Station Text", get: () => showStationText, toggle: toggleStationText },
  ];

  const items: ToggleItem[] = [
    {
      id: "quick-perf",
      icon: <Activity size={16} />,
      tooltip: "Performance",
      getActive: () => showPerfLeft,
      action: () => { togglePerfLeft(); togglePerfRight(); },
    },
  ];

  const sensorZones: Array<{ key: string; label: string; color: string; set: (hex: string) => void }> = [
    { key: "body", label: "Body", color: bodyColor, set: setBodyColor },
    { key: "zone0", label: "Zone 0 (Outer)", color: zone0Color, set: setZone0Color },
    { key: "zone1", label: "Zone 1 (Middle)", color: zone1Color, set: setZone1Color },
    { key: "zone2", label: "Zone 2 (Inner)", color: zone2Color, set: setZone2Color },
  ];

  const handleMouseEnter = (e: React.MouseEvent, id: string, tooltip: string) => {
    const rect = e.currentTarget.getBoundingClientRect();
    showTooltip(id, tooltip, { x: rect.left + rect.width / 2, y: rect.bottom + 4 }, 2, "anchor");
  };

  const buttonExtra = "w-9 h-9 mx-0 text-zinc-100";

  return (
    <div
      ref={toolbarRef}
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
            className={twMerge(menuButtonVariants({ active: isActive }), buttonExtra)}
            onClick={item.action}
            onMouseEnter={(e) => handleMouseEnter(e, item.id, item.tooltip)}
            onMouseLeave={hideTooltip}
          >
            {item.icon}
          </button>
        );
      })}

      {/* Sensor dropdown */}
      <div className="relative">
        <button
          onClick={() => toggleDropdown("sensor")}
          onMouseEnter={(e) => handleMouseEnter(e, "sensor", "Sensor Box")}
          onMouseLeave={hideTooltip}
          className={twMerge(menuButtonVariants({ active: sensorOpen }), buttonExtra)}
        >
          <Radar size={16} />
        </button>
        {sensorOpen && (
          <div className="absolute top-12 right-0 min-w-[220px] rounded-md bg-zinc-800/95 border border-zinc-600 shadow-lg backdrop-blur overflow-hidden">
            <button
              onClick={toggleSensorBox}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-700 text-left border-b border-zinc-700"
            >
              <span
                className={`w-5 h-5 flex items-center justify-center rounded border ${
                  showSensorBox
                    ? "bg-cyan-400/20 border-cyan-300"
                    : "bg-zinc-900 border-zinc-500"
                }`}
              >
                {showSensorBox && <Check size={14} className="text-cyan-300" strokeWidth={3} />}
              </span>
              <span className={showSensorBox ? "text-white" : "text-zinc-300"}>
                Show Sensor Box
              </span>
            </button>
            {sensorZones.map((zone) => (
              <label
                key={zone.key}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-700 cursor-pointer"
              >
                <input
                  type="color"
                  value={zone.color}
                  onChange={(e) => zone.set(e.target.value)}
                  className="w-5 h-5 rounded border border-zinc-600 cursor-pointer bg-transparent p-0"
                />
                <span className="text-zinc-300 flex-1">{zone.label}</span>
                <span className="font-mono text-[11px] text-zinc-400 uppercase">{zone.color}</span>
              </label>
            ))}
            <button
              onClick={resetSensorColors}
              className="w-full px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-700 hover:text-white border-t border-zinc-700 text-center"
            >
              Reset
            </button>
          </div>
        )}
      </div>

      {/* Label dropdown */}
      <div className="relative">
        <button
          onClick={() => toggleDropdown("labels")}
          onMouseEnter={(e) => handleMouseEnter(e, "labels", "Labels")}
          onMouseLeave={hideTooltip}
          className={twMerge(menuButtonVariants({ active: labelOpen }), buttonExtra)}
        >
          <Tag size={16} />
        </button>
        {labelOpen && (
          <div className="absolute top-12 right-0 min-w-[180px] rounded-md bg-zinc-800/95 border border-zinc-600 shadow-lg backdrop-blur overflow-hidden">
            {labelOptions.map((opt) => {
              const on = opt.get();
              return (
                <button
                  key={opt.key}
                  onClick={opt.toggle}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-700 text-left"
                >
                  <span
                    className={`w-4 h-4 flex items-center justify-center rounded-sm border ${
                      on
                        ? "bg-cyan-400/20 border-cyan-300"
                        : "bg-zinc-900 border-zinc-500"
                    }`}
                  >
                    {on && <Check size={12} className="text-cyan-300" strokeWidth={3} />}
                  </span>
                  <span className={on ? "text-white" : "text-zinc-300"}>
                    {opt.label}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Divider */}
      <div className="w-px h-6 bg-gray-600/50" />

      {/* Theme picker */}
      <div className="relative">
        <button
          onClick={() => toggleDropdown("theme")}
          onMouseEnter={(e) => handleMouseEnter(e, "theme", `Theme: ${THEMES[themeName]?.label ?? ""}`)}
          onMouseLeave={hideTooltip}
          className={twMerge(menuButtonVariants({ active: themeOpen }), buttonExtra)}
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
                  setOpenDropdown(null);
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
          onClick={() => toggleDropdown("log")}
          onMouseEnter={(e) => handleMouseEnter(e, "simlogs", "SimLogger Files")}
          onMouseLeave={hideTooltip}
          className={twMerge(menuButtonVariants({ active: logOpen }), buttonExtra)}
        >
          <Binary size={16} className={logOpen ? "text-white" : "text-purple-400"} />
        </button>
        {logOpen && (
          <div className="absolute top-12" style={{ right: 0 }}>
            <SimLogFileManager isOpen={true} onToggle={() => setOpenDropdown(null)} hideButton={true} />
          </div>
        )}
      </div>
    </div>
  );
};

export default QuickViewToolbar;
