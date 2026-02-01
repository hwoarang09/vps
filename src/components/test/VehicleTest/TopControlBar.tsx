// components/test/VehicleTest/TopControlBar.tsx
// Top control bar with MenuLevel1/2 style buttons and dropdowns

import React, { useState } from "react";
import { twMerge } from "tailwind-merge";
import {
  Map,
  Route,
  Car,
  Trash2,
  Grid3X3,
  X,
  Settings,
  Play,
  Pause,
  ChevronDown,
} from "lucide-react";
import { useMenuStore } from "@/store/ui/menuStore";
import {
  menuContainerVariants,
  menuButtonVariants,
  menuDividerClass,
} from "@/components/react/menu/shared/menuStyles";
import { TransferMode } from "@store/vehicle/arrayMode/vehicleStore";
import { TestSetting } from "@/config/testSettingConfig";

// Dropdown menu item style
const dropdownItemClass = twMerge(
  "w-full px-2 py-2 text-left text-xs font-mono",
  "text-gray-200 hover:text-white hover:bg-white/10 transition-colors"
);

const dropdownActiveClass = "bg-accent-cyan/20 text-accent-cyan font-bold";

interface DropdownButtonProps {
  icon: React.ReactNode;
  label: string;
  tooltip: string;
  isOpen: boolean;
  onToggle: () => void;
  menuId: string;
  accentColor?: string;
}

const DropdownButton: React.FC<DropdownButtonProps> = ({
  icon,
  label,
  tooltip,
  isOpen,
  onToggle,
  menuId,
  accentColor = "text-accent-cyan",
}) => {
  const { showTooltip, hideTooltip } = useMenuStore();

  const handleMouseEnter = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    showTooltip(menuId, tooltip, { x: rect.left + rect.width / 2, y: rect.bottom - 40 }, 2);
  };

  return (
    <button
      onClick={onToggle}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={hideTooltip}
      className={twMerge(
        menuButtonVariants({ active: isOpen, size: "small" }),
        "w-auto px-2 min-w-[48px] gap-1"
      )}
    >
      <div className={twMerge("flex items-center gap-1", isOpen ? "text-white" : accentColor)}>
        {icon}
        <span className="text-[10px] font-bold max-w-[80px] truncate">{label}</span>
        <ChevronDown size={10} className={twMerge("transition-transform", isOpen && "rotate-180")} />
      </div>
    </button>
  );
};

interface ActionButtonProps {
  icon: React.ReactNode;
  label?: string;
  tooltip: string;
  onClick: () => void;
  menuId: string;
  disabled?: boolean;
  variant?: "default" | "success" | "danger" | "warning" | "active";
  isActive?: boolean;
}

const ActionButton: React.FC<ActionButtonProps> = ({
  icon,
  label,
  tooltip,
  onClick,
  menuId,
  disabled = false,
  variant = "default",
  isActive = false,
}) => {
  const { showTooltip, hideTooltip } = useMenuStore();

  const handleMouseEnter = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    showTooltip(menuId, tooltip, { x: rect.left + rect.width / 2, y: rect.bottom - 40 }, 2);
  };

  const getIconColor = () => {
    if (disabled) return "text-gray-500";
    if (isActive) return "text-white";
    switch (variant) {
      case "success": return "text-accent-green";
      case "danger": return "text-accent-red";
      case "warning": return "text-accent-yellow";
      default: return "text-gray-300";
    }
  };

  return (
    <button
      onClick={onClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={hideTooltip}
      disabled={disabled}
      className={twMerge(
        menuButtonVariants({ active: isActive, size: "small" }),
        "w-auto px-2 min-w-[40px]",
        disabled && "opacity-50 cursor-not-allowed"
      )}
    >
      <div className={twMerge("flex items-center gap-1", getIconColor())}>
        {icon}
        {label && <span className="text-[10px] font-bold">{label}</span>}
      </div>
    </button>
  );
};

interface NumberInputProps {
  value: string;
  onChange: (value: string) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
  width?: string;
}

const NumberInput: React.FC<NumberInputProps> = ({
  value,
  onChange,
  min = 1,
  max = 10000,
  disabled = false,
  width = "w-[60px]",
}) => {
  return (
    <input
      type="number"
      min={min}
      max={max}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className={twMerge(
        "bg-black/50 text-white text-center",
        "border border-white/20 rounded-xl",
        "font-mono text-xs",
        "focus:outline-none focus:border-accent-cyan",
        "transition-colors",
        "px-1 py-1",
        "[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none",
        width,
        disabled && "opacity-50 cursor-not-allowed"
      )}
    />
  );
};

interface TopControlBarProps {
  // Map Selection
  testSettings: TestSetting[];
  selectedSettingId: string;
  onSettingChange: (settingId: string) => void;
  // Transfer Mode
  transferMode: TransferMode;
  onTransferModeChange: (mode: TransferMode) => void;
  // Vehicles
  vehicleCount: string;
  onVehicleCountChange: (count: string) => void;
  maxVehicleCapacity: number;
  onCreateVehicles: () => void;
  onDeleteVehicles: () => void;
  // FAB
  fabCountX: number;
  fabCountY: number;
  onFabCountXChange: (count: number) => void;
  onFabCountYChange: (count: number) => void;
  isFabApplied: boolean;
  onFabCreate: () => void;
  onFabClear: () => void;
  onOpenParams: () => void;
  // Play/Pause
  isPaused: boolean;
  onPlay: () => void;
  onPause: () => void;
}

const TopControlBar: React.FC<TopControlBarProps> = ({
  testSettings,
  selectedSettingId,
  onSettingChange,
  transferMode,
  onTransferModeChange,
  vehicleCount,
  onVehicleCountChange,
  maxVehicleCapacity,
  onCreateVehicles,
  onDeleteVehicles,
  fabCountX,
  fabCountY,
  onFabCountXChange,
  onFabCountYChange,
  isFabApplied,
  onFabCreate,
  onFabClear,
  onOpenParams,
  isPaused,
  onPlay,
  onPause,
}) => {
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);

  const selectedSetting = testSettings.find((s) => s.id === selectedSettingId);
  const selectedMapName = selectedSetting?.name || "Select Map";

  const transferModeLabels: Record<TransferMode, string> = {
    [TransferMode.LOOP]: "LOOP",
    [TransferMode.RANDOM]: "RANDOM",
    [TransferMode.MQTT_CONTROL]: "MQTT",
    [TransferMode.AUTO_ROUTE]: "AUTO",
  };

  const handleDropdownToggle = (dropdownId: string) => {
    setActiveDropdown(activeDropdown === dropdownId ? null : dropdownId);
  };

  const handleMapSelect = (settingId: string) => {
    onSettingChange(settingId);
    setActiveDropdown(null);
  };

  const handleModeSelect = (mode: TransferMode) => {
    onTransferModeChange(mode);
    setActiveDropdown(null);
  };

  return (
    <div className="fixed top-2.5 left-1/2 -translate-x-1/2 z-[1001]">
      <div
        className={twMerge(
          menuContainerVariants({ level: 1 }),
          "flex items-center gap-1 px-2"
        )}
      >
        {/* Map Selection Dropdown */}
        <div className="relative">
          <DropdownButton
            icon={<Map size={14} />}
            label={selectedMapName}
            tooltip="Select Map"
            isOpen={activeDropdown === "map"}
            onToggle={() => handleDropdownToggle("map")}
            menuId="map-select"
            accentColor="text-accent-cyan"
          />
          {activeDropdown === "map" && (
            <div
              className={twMerge(
                menuContainerVariants({ level: 2 }),
                "absolute top-16 left-0 min-w-[200px] flex-col z-50 overflow-hidden p-0 space-x-0"
              )}
            >
              {testSettings.map((setting) => (
                <button
                  key={setting.id}
                  onClick={() => handleMapSelect(setting.id)}
                  className={twMerge(
                    dropdownItemClass,
                    selectedSettingId === setting.id && dropdownActiveClass
                  )}
                >
                  {setting.name} ({setting.mapName})
                </button>
              ))}
            </div>
          )}
        </div>

        <div className={menuDividerClass} />

        {/* Transfer Mode Dropdown */}
        <div className="relative">
          <DropdownButton
            icon={<Route size={14} />}
            label={transferModeLabels[transferMode]}
            tooltip="Transfer Mode"
            isOpen={activeDropdown === "mode"}
            onToggle={() => handleDropdownToggle("mode")}
            menuId="mode-select"
            accentColor="text-accent-purple"
          />
          {activeDropdown === "mode" && (
            <div
              className={twMerge(
                menuContainerVariants({ level: 2 }),
                "absolute top-16 left-0 min-w-[120px] flex-col z-50 overflow-hidden p-0 space-x-0"
              )}
            >
              {Object.entries(transferModeLabels).map(([mode, label]) => (
                <button
                  key={mode}
                  onClick={() => handleModeSelect(mode as TransferMode)}
                  className={twMerge(
                    dropdownItemClass,
                    transferMode === mode && dropdownActiveClass
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className={menuDividerClass} />

        {/* Vehicles Section */}
        <div className="flex items-center gap-1">
          <NumberInput
            value={vehicleCount}
            onChange={onVehicleCountChange}
            max={10000}
          />
          <span className="text-gray-500 text-[10px] font-mono">/{maxVehicleCapacity || "---"}</span>
        </div>

        <ActionButton
          icon={<Car size={14} />}
          tooltip="Create Vehicles"
          onClick={onCreateVehicles}
          menuId="create-vehicles"
          variant="success"
        />

        <ActionButton
          icon={<Trash2 size={14} />}
          tooltip="Delete All Vehicles"
          onClick={onDeleteVehicles}
          menuId="delete-vehicles"
          variant="danger"
        />

        <div className={menuDividerClass} />

        {/* FAB Section */}
        <div className="flex items-center gap-1">
          <NumberInput
            value={fabCountX.toString()}
            onChange={(v) => onFabCountXChange(Math.max(1, Math.min(100, Number.parseInt(v) || 1)))}
            min={1}
            max={100}
            disabled={isFabApplied}
            width="w-[40px]"
          />
          <span className="text-accent-yellow text-[10px] font-bold">x</span>
          <NumberInput
            value={fabCountY.toString()}
            onChange={(v) => onFabCountYChange(Math.max(1, Math.min(100, Number.parseInt(v) || 1)))}
            min={1}
            max={100}
            disabled={isFabApplied}
            width="w-[40px]"
          />
          <span className="text-gray-500 text-[10px] font-mono">={fabCountX * fabCountY}</span>
        </div>

        <ActionButton
          icon={<Grid3X3 size={14} />}
          tooltip="Create FAB Grid"
          onClick={onFabCreate}
          menuId="fab-create"
          disabled={isFabApplied}
          variant="warning"
        />

        <ActionButton
          icon={<X size={14} />}
          tooltip="Clear FAB Grid"
          onClick={onFabClear}
          menuId="fab-clear"
          disabled={!isFabApplied}
          variant="warning"
        />

        <ActionButton
          icon={<Settings size={14} />}
          tooltip="Simulation Parameters"
          onClick={onOpenParams}
          menuId="sim-params"
        />

        <div className={menuDividerClass} />

        {/* Play/Pause Section */}
        <ActionButton
          icon={<Play size={14} />}
          tooltip="Play Simulation"
          onClick={onPlay}
          menuId="play"
          disabled={!isPaused}
          variant="success"
          isActive={!isPaused}
        />

        <ActionButton
          icon={<Pause size={14} />}
          tooltip="Pause Simulation"
          onClick={onPause}
          menuId="pause"
          disabled={isPaused}
          variant="warning"
          isActive={isPaused}
        />
      </div>
    </div>
  );
};

export default TopControlBar;
