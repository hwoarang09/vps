// components/react/system/LogIndicator.tsx
// HUD Status Indicator - Shows SimLog file management button in top-right corner

import React, { useState } from "react";
import { Binary } from "lucide-react";
import { useMenuStore } from "@/store/ui/menuStore";
import { menuButtonVariants } from "@/components/react/menu/shared/menuStyles";
import { twMerge } from "tailwind-merge";
import SimLogFileManager from "@/components/test/VehicleTest/SimLogFileManager";

const LogIndicator: React.FC = () => {
  const { showTooltip, hideTooltip } = useMenuStore();
  const [isOpen, setIsOpen] = useState(false);

  const handleMouseEnter = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    showTooltip("simlogs", "SimLogger Files", { x: rect.left + rect.width / 2, y: rect.bottom }, 2);
  };

  return (
    <div className="fixed top-4 right-4 z-50 flex items-center gap-2">
      <div
        className={twMerge(
          "flex items-center gap-1 p-1 rounded-xl border-2",
          "bg-menu-container-bg border-menu-border-container",
          "shadow-menu-container-glow opacity-[0.98]"
        )}
      >
        <div className="relative">
          <button
            onClick={() => setIsOpen(!isOpen)}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={hideTooltip}
            className={twMerge(
              menuButtonVariants({ active: isOpen, size: "small" }),
              "w-9 h-9"
            )}
          >
            <Binary size={18} className={isOpen ? "text-white" : "text-purple-400"} />
          </button>
          {isOpen && (
            <div className="absolute top-12" style={{ right: "calc(100% + 8px)" }}>
              <SimLogFileManager isOpen={true} onToggle={() => setIsOpen(false)} hideButton={true} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default LogIndicator;
