// components/test/VehicleTest/TopControlBar.tsx
// Top control bar with compact style buttons and dropdowns

import React from "react";
import { twMerge } from "tailwind-merge";
import {
  X,
  Play,
  Pause,
} from "lucide-react";
import { useMenuStore } from "@/store/ui/menuStore";
import {
  menuContainerVariants,
  menuButtonVariants,
  menuDividerClass,
} from "@/components/react/menu/shared/menuStyles";

// Shapez2-style PNG icons for TopControlBar
import imgTrains from "@/assets/icons/game/menu-trains.png";
import imgTrash from "@/assets/icons/game/shape-trash.png";
import imgSpace from "@/assets/icons/game/menu-space.png";

const TPS = 18; // TopBar PNG icon size (compact)

const tpngIcon = (src: string, size = TPS) => (
  <img src={src} alt="" width={size} height={size} style={{ imageRendering: "auto" }} draggable={false} />
);

// Compact button style overrides for top bar
const compactButtonClass = "h-9 w-auto px-2 min-w-[36px]";

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
        compactButtonClass,
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
        "px-1 py-0.5 h-7",
        "[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none",
        width,
        disabled && "opacity-50 cursor-not-allowed"
      )}
    />
  );
};

interface TopControlBarProps {
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
  // Play/Pause
  isPaused: boolean;
  onPlay: () => void;
  onPause: () => void;
}

const TopControlBar: React.FC<TopControlBarProps> = ({
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
  isPaused,
  onPlay,
  onPause,
}) => {
  return (
    <div className="fixed top-2.5 left-1/2 -translate-x-1/2 z-[1001]">
      <div
        className={twMerge(
          menuContainerVariants({ level: 1 }),
          "flex items-center gap-1 px-2 py-1"
        )}
      >
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
          icon={tpngIcon(imgTrains)}
          tooltip="Create Vehicles"
          onClick={onCreateVehicles}
          menuId="create-vehicles"
          variant="success"
        />

        <ActionButton
          icon={tpngIcon(imgTrash)}
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
          icon={tpngIcon(imgSpace)}
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
